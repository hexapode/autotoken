import { writeFileSync, renameSync } from 'node:fs';

// Conservative accounting: no cache discounts. Unknown/unfinished requests retain
// their reservation on resume. These are estimates, not the provider's invoice.
export function requestReservation(body) {
  const request = JSON.parse(body);
  if (request.model !== 'gpt-6.1-sol' || !['default', undefined].includes(request.service_tier)) throw new Error('Collection requires standard gpt-6.1-sol');
  if (!Number.isInteger(request.max_output_tokens) || request.max_output_tokens < 1 || request.max_output_tokens > 8192) throw new Error('Invalid output cap');
  if (body.length > 128000) throw new Error('Collection input exceeds 128 KB cap');
  // UTF-8 byte bound plus protocol overhead; input charged at $5/M (12h write),
  // output at $10/M. Small contexts only; reject images and server-side context.
  if (request.previous_response_id || request.conversation || /"type"\s*:\s*"(?:input_image|input_file|input_audio)"/.test(body.toString())) throw new Error('Only self-contained text requests are budgeted');
  return ((body.length + 8192) * 5 + request.max_output_tokens * 10) / 1e6;
}
export class CollectionBudget {
  constructor(file, state) { this.file = file; this.state = state; }
  save() { writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2), { mode: 0o600 }); renameSync(this.file + '.tmp', this.file); }
  get charged() { return Object.values(this.state.requests).reduce((n, r) => n + r.charged, 0); }
  get attempts() { return Object.keys(this.state.requests).length; }
  reserve({ traceId, body }) {
    if (!traceId || this.state.requests[traceId]) throw new Error('Duplicate request reservation');
    if (this.attempts >= this.state.targetQueries) throw new Error('Collection query limit reached');
    const charged = requestReservation(body);
    if (this.charged + charged > this.state.budgetUsd) throw new Error('Collection dollar budget reached');
    this.state.requests[traceId] = { charged, reservation: charged, state: 'reserved' };
    this.save(); // Durable BEFORE dispatch; failed dispatches remain charged.
  }
  settle(trace) {
    const entry = this.state.requests[trace.id];
    if (!entry) return;
    const usage = trace.response?.usage;
    const input = usage?.input_tokens, output = usage?.output_tokens;
    if (Number.isSafeInteger(input) && input >= 0 && Number.isSafeInteger(output) && output >= 0) {
      entry.charged = (input * 5 + output * 10) / 1e6;
      entry.usage = usage;
      if (entry.charged > entry.reservation) this.state.accountingError = 'Usage exceeded reservation; stop and review';
    }
    entry.state = trace.state === 'complete' && trace.response?.status === 'completed' ? 'completed' : 'failed-or-unknown';
    this.save();
  }
}
