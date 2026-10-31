import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { runContainerCommand } from '../../src/container-tool.js';

export default function (pi: ExtensionAPI) {
  const container = process.env.M2C_TASK_CONTAINER;
  if (!container) throw new Error('M2C_TASK_CONTAINER is required');
  pi.registerTool(defineTool({
    name: 'container_bash', label: 'Task container shell',
    description: 'Run a shell command in the isolated task container at /testbed with the project Python environment activated. Use this for all reading, searching, edits and tests. Commands have a maximum 120-second timeout. No network access is available.',
    parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (not milliseconds), at most 120.', minimum: 1, maximum: 120 })) }),
    async execute(_id, params, signal) {
      const result = await runContainerCommand(container, params.command, params.timeout, signal);
      return { content: [{ type: 'text', text: `Exit code: ${result.code}\n${result.output}` }], details: { exitCode: result.code } };
    }
  }));
  // Explicitly remove every built-in host tool, even if CLI defaults change.
  pi.on('session_start', async () => { pi.setActiveTools(['container_bash']); });
}
