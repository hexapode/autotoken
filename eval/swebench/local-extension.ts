import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { runLocalCommand } from '../../src/local-tool.js';

export default function (pi: ExtensionAPI) {
  const paths = { repo: process.env.M2C_LOCAL_REPO, venv: process.env.M2C_LOCAL_VENV, home: process.env.M2C_LOCAL_HOME, temp: process.env.M2C_LOCAL_TEMP };
  if (Object.values(paths).some(value => !value)) throw new Error('Missing local task environment');
  pi.registerTool(defineTool({
    name: 'local_bash', label: 'Local task shell',
    description: 'Execute a shell command in the fresh task checkout with its Python environment. This is local execution, not a sandbox. Work only in the current checkout, do not access files outside it or use the network. Use this tool for reading, edits and tests. Maximum timeout 120 seconds.',
    parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (not milliseconds), at most 120.', minimum: 1, maximum: 120 })) }),
    async execute(_id, params, signal) {
      const result = await runLocalCommand(paths, params.command, params.timeout, signal);
      return { content: [{ type: 'text', text: `Exit code: ${result.code}; timed out: ${result.timedOut}\n${result.output}` }], details: { exitCode: result.code, timedOut: result.timedOut } };
    }
  }));
  pi.on('session_start', async () => { pi.setActiveTools(['local_bash']); });
}
