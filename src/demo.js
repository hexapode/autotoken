import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { DemoProvider } from './provider.js';

const directory = mkdtempSync(join(tmpdir(), 'model-to-code-demo-'));
const engine = new Engine(new Store(directory), new DemoProvider());
console.log('Offline scripted demo — no API calls. State:', directory);
for (const [i, prompt] of ['Sort these numbers ascending', 'Order numbers ascending', 'Sort numbers from smallest to largest'].entries()) {
  const e = await engine.query({ prompt, data: [9 + i, 2, 1] });
  console.log('Observe:', e.route, e.answer);
}
console.log('Discover:', await engine.learn());
const p = engine.store.state.programs[0];
for (const data of [[8, 4, 5], [12, -3, 0], [100, 10, 1]]) {
  const e = await engine.query({ prompt: 'Sort numbers ascending', data });
  console.log('Shadow:', e.shadow.match, 'served:', e.route);
}
engine.setStatus(p.id, 'active');
const result = await engine.query({ prompt: 'Sort numbers ascending', data: [42, 7, 19] });
console.log('Promoted:', result.route, result.answer, 'calls:', result.calls.map(c => c.kind));
const fallback = await engine.query({ prompt: 'Rank these numbers by how beautiful they are', data: [1, 2, 3] });
console.log('Subjective request:', fallback.route);
console.log(JSON.stringify(engine.stats(), null, 2));
