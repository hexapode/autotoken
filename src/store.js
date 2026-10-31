import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Single-process prototype: synchronous, atomic snapshot writes avoid lost updates.
export class Store {
  constructor(directory) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.file = join(this.directory, 'state.json');
    try { this.state = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = { programs: [], traffic: [], learning: [], totalRequests: 0 };
    }
  }
  save() {
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  record(event) {
    this.state.totalRequests++;
    this.state.traffic.push(event);
    this.state.traffic = this.state.traffic.slice(-1000);
    this.save();
  }
}
