import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFile } from 'node:fs/promises';
import { runLocalCommand } from '../../src/local-tool.js';
import { runReadRangeTool } from '../../src/read-range-tool.js';

// Both arms advertise exactly these tools, schemas and descriptions. Only the
// implementation's one-retry flag differs; no behavioral reminder is injected.
export default function (pi: ExtensionAPI) {
  const paths = { repo: process.env.M2C_LOCAL_REPO, venv: process.env.M2C_LOCAL_VENV, home: process.env.M2C_LOCAL_HOME, temp: process.env.M2C_LOCAL_TEMP };
  if (Object.values(paths).some(value => !value)) throw new Error('Missing local task environment');
  const arm = process.env.M2C_READ_RANGE_ARM;
  if (!['read-range-baseline', 'read-range-repair'].includes(arm || '')) throw new Error('Invalid read-range arm');
  const log = async (event: object) => {
    if (process.env.M2C_READ_RANGE_LOG) await appendFile(process.env.M2C_READ_RANGE_LOG, JSON.stringify(event) + '\n', { mode: 0o600 });
  };
  pi.registerTool(defineTool({
    name: 'local_bash', label: 'Local task shell',
    description: 'Execute a shell command in the fresh task checkout with its Python environment. This is local execution, not a sandbox. Work only in the current checkout, do not access files outside it or use the network. Use this tool for search, edits and tests. Use str_replace_editor for reading source files. Maximum timeout 120 seconds.',
    parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (not milliseconds), at most 120.', minimum: 1, maximum: 120 })) }),
    async execute(_id, params, signal) {
      const result = await runLocalCommand(paths, params.command, params.timeout, signal);
      return { content: [{ type: 'text', text: `Exit code: ${result.code}; timed out: ${result.timedOut}\n${result.output}` }], details: { exitCode: result.code, timedOut: result.timedOut } };
    }
  }));
  pi.registerTool(defineTool({
    name: 'str_replace_editor', label: 'Read source',
    description: 'Read a UTF-8 source file with original line numbers. Only command=view is supported. Map repository-relative paths to /workspace/<path>. An optional inclusive view_range [start,end] selects at most 250 lines; end=-1 reads toward EOF subject to limits. Without a range, show the first 200 lines. Output is capped at 32 KB and files at 1 MB. Use local_bash for edits and tests.',
    parameters: Type.Object({ command: Type.Literal('view'), path: Type.String(), view_range: Type.Optional(Type.Array(Type.Integer(), { minItems: 2, maxItems: 2 })) }),
    async execute(id, params) {
      const started = performance.now();
      const result = await runReadRangeTool({ root: paths.repo, args: params, repair: arm === 'read-range-repair', onRetry: event => log({ type: 'retry', toolCallId: id, ...event }) });
      await log({ type: 'read', toolCallId: id, args: params, ...result.metadata, elapsedMs: performance.now() - started });
      // Private retry metadata never changes the model-visible text or schema.
      return { content: [{ type: 'text', text: result.text }], details: result.metadata };
    }
  }));
  pi.on('session_start', async () => { pi.setActiveTools(['local_bash', 'str_replace_editor']); });
}
