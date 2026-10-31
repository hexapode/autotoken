import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFile } from 'node:fs/promises';
import { runLocalCommand } from '../../src/local-tool.js';
import { ValidationWorkflow, patchFingerprint, renderValidation, testCommandObserved, testsSucceeded } from '../../src/validation-workflow.js';

export default function (pi: ExtensionAPI) {
  const paths = { repo: process.env.M2C_LOCAL_REPO, venv: process.env.M2C_LOCAL_VENV, home: process.env.M2C_LOCAL_HOME, temp: process.env.M2C_LOCAL_TEMP };
  if (Object.values(paths).some(value => !value)) throw new Error('Missing local task environment');
  const workflow = new ValidationWorkflow(process.env.M2C_WORKFLOW_ARM, process.env.M2C_WORKFLOW_TEST_PATH);
  pi.registerTool(defineTool({
    name: 'local_bash', label: 'Local task shell',
    // Identical model-visible tool schema/description to baseline.
    description: 'Execute a shell command in the fresh task checkout with its Python environment. This is local execution, not a sandbox. Work only in the current checkout, do not access files outside it or use the network. Use this tool for reading, edits and tests. Maximum timeout 120 seconds.',
    parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ description: 'Timeout in seconds (not milliseconds), at most 120.', minimum: 1, maximum: 120 })) }),
    async execute(_id, params, signal) {
      const result = await runLocalCommand(paths, params.command, params.timeout, signal);
      let report = { triggered: false, steps: [] };
      if (testCommandObserved(params.command) && testsSucceeded(result)) {
        try {
          report = await workflow.afterAction({ command: params.command, result, fingerprint: await patchFingerprint(paths), execute: command => runLocalCommand(paths, command, 120, signal), fingerprintAfter: () => patchFingerprint(paths) });
        } catch (error) { report = { triggered: false, status: 'abstained', reason: String(error.message), steps: [] }; }
      }
      if (process.env.M2C_WORKFLOW_LOG) await appendFile(process.env.M2C_WORKFLOW_LOG, JSON.stringify({ toolCallId: _id, arm: process.env.M2C_WORKFLOW_ARM, ...report }) + '\n', { mode: 0o600 });
      return { content: [{ type: 'text', text: `Exit code: ${result.code}; timed out: ${result.timedOut}\n${result.output}${renderValidation(report)}` }], details: { exitCode: result.code, timedOut: result.timedOut, validation: report } };
    }
  }));
  pi.on('session_start', async () => { pi.setActiveTools(['local_bash']); });
}
