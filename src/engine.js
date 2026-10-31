import { randomUUID, createHash } from 'node:crypto';
import { execute, checkTests, agrees } from './program.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Engine {
  constructor(store, provider, { threshold = 0.98, minShadow = 3 } = {}) {
    this.store = store; this.provider = provider; this.threshold = threshold; this.minShadow = minShadow;
    this.learning = false;
  }
  async query(request) {
    const start = performance.now();
    const calls = [];
    const programs = this.store.state.programs.filter(p => ['shadow', 'active'].includes(p.status));
    let candidate, output, reason = 'No eligible program', decision = null;
    // Conversation-level instructions are never silently discarded for program execution.
    if (!request.messages && Object.hasOwn(request, 'data') && programs.length) {
      try {
        const route = await this.provider.route(request, programs);
        calls.push({ kind: 'route', model: route.model, usage: route.usage });
        decision = route.value;
        if (decision && Number.isFinite(decision.confidence) && decision.confidence >= this.threshold && decision.confidence <= 1) {
          candidate = programs.find(p => p.id === decision.programId && ['shadow', 'active'].includes(p.status));
        }
        reason = typeof decision?.reason === 'string' ? decision.reason : 'Router abstained';
        if (candidate) output = execute(candidate, request.data);
      } catch (error) { candidate = undefined; reason = `Routing or contract failure: ${error.message}`; }
    }
    let answer, route = 'model', shadow = null;
    if (candidate?.status === 'active') {
      answer = JSON.stringify(output); route = 'program';
    } else {
      const response = await this.provider.answer(request);
      calls.push({ kind: 'answer', model: response.model, usage: response.usage });
      answer = response.value;
      if (candidate) {
        shadow = { programId: candidate.id, output, match: agrees(output, answer), inputHash: hash(request.data) };
        candidate.evidence.push({ requestId: null, ...shadow });
        candidate.evidence = candidate.evidence.slice(-100);
      }
    }
    const event = { id: randomUUID(), at: new Date().toISOString(), request, answer, route, programId: candidate?.id ?? null, decision, reason, shadow, calls, latencyMs: Math.round(performance.now() - start) };
    if (shadow) candidate.evidence[candidate.evidence.length - 1].requestId = event.id;
    this.store.record(event);
    return event;
  }
  async learn() {
    if (this.learning) throw new Error('Discovery already running');
    this.learning = true;
    try {
      const traffic = this.store.state.traffic.filter(t => t.route === 'model' && Object.hasOwn(t.request, 'data')).slice(-60);
      if (traffic.length < 3) return { added: [], rejected: [], reason: 'Need at least 3 requests with explicit data' };
      const response = await this.provider.discover(traffic, this.store.state.programs);
      if (!Array.isArray(response.value?.programs) || response.value.programs.length > 3) throw new Error('Invalid discovery response');
      const added = [], rejected = [];
      for (const proposal of response.value.programs) {
        try {
          const testCount = checkTests(proposal);
          const sourceIds = [...new Set(proposal.sourceIds)];
          const sources = sourceIds.map(id => traffic.find(t => t.id === id));
          if (sources.length < 3 || sources.some(t => !t) || new Set(sources.map(t => t.request.prompt)).size < 3) throw new Error('Need 3 distinct observed prompts');
          // Replay is evidence only; it is never counted as held-out shadow traffic.
          if (!sources.every(t => agrees(execute(proposal, t.request.data), t.answer))) throw new Error('Candidate disagrees with discovery examples');
          const fingerprint = hash({ input: proposal.input, steps: proposal.steps });
          if (this.store.state.programs.some(p => p.fingerprint === fingerprint)) throw new Error('Duplicate implementation');
          const p = {
            id: randomUUID(), name: proposal.name, description: proposal.description,
            input: proposal.input, steps: proposal.steps, tests: proposal.tests,
            sourceIds, sourceHashes: sources.map(t => hash(t.request.data)), fingerprint, testCount, status: 'shadow', evidence: [],
            createdAt: new Date().toISOString()
          };
          this.store.state.programs.push(p); added.push(p.id);
        } catch (error) { rejected.push({ name: proposal?.name ?? 'Invalid proposal', reason: error.message }); }
      }
      const result = { at: new Date().toISOString(), added, rejected, model: response.model, usage: response.usage };
      this.store.state.learning.push(result);
      this.store.state.learning = this.store.state.learning.slice(-100);
      this.store.save();
      return result;
    } finally { this.learning = false; }
  }
  setStatus(id, status) {
    const p = this.store.state.programs.find(p => p.id === id);
    if (!p) throw new Error('Program not found');
    if (!['active', 'shadow', 'disabled'].includes(status)) throw new Error('Invalid status');
    if (status === 'active') {
      checkTests(p);
      const trainingHashes = new Set([...p.sourceHashes, ...p.tests.map(t => hash(t.input))]);
      const heldOut = p.evidence.filter(e => !trainingHashes.has(e.inputHash));
      if (heldOut.some(e => !e.match) || new Set(heldOut.filter(e => e.match).map(e => e.inputHash)).size < this.minShadow) {
        throw new Error(`Promotion needs ${this.minShadow} distinct held-out shadow matches and zero held-out mismatches`);
      }
    }
    p.status = status;
    this.store.save();
    return p;
  }
  stats() {
    const traffic = this.store.state.traffic;
    const served = traffic.filter(t => t.route === 'program').length;
    return {
      totalRequests: this.store.state.totalRequests, retainedRequests: traffic.length,
      programResponses: served, programResponseRate: traffic.length ? served / traffic.length : 0,
      modelCalls: traffic.reduce((n, t) => n + t.calls.length, 0),
      discoveryCalls: this.store.state.learning.length,
      shadowMatches: traffic.filter(t => t.shadow?.match === true).length,
      shadowMismatches: traffic.filter(t => t.shadow?.match === false).length,
      programs: this.store.state.programs.map(p => ({ id: p.id, name: p.name, status: p.status, observations: p.evidence.length }))
    };
  }
}
