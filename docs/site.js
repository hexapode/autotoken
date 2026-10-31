const examples = {
  sort: { request: '“Sort these numbers ascending.”', label: 'DETERMINISTIC OUTPUT', output: '[1, 2, 9]', note: 'The program sorts a new array.', code: true },
  format: { request: '“Trim whitespace from these strings.”', label: 'DETERMINISTIC OUTPUT', output: '["hello", "world"]', note: 'The program removes whitespace at the ends.', code: true },
  reason: { request: '“Why does this unfamiliar test fail?”', label: 'FALL BACK TO THE MODEL', output: 'Send the request to the model.', note: 'We have no tested program for this request.', code: false }
};
for (const button of document.querySelectorAll('[data-example]')) {
  button.addEventListener('click', () => {
    const example = examples[button.dataset.example];
    for (const tab of document.querySelectorAll('[data-example]')) tab.setAttribute('aria-pressed', String(tab === button));
    document.getElementById('request-text').textContent = example.request;
    document.getElementById('output-label').textContent = example.label;
    document.getElementById('output-value').textContent = example.output;
    document.getElementById('output-note').textContent = example.note;
    document.getElementById('code-branch').classList.toggle('selected', example.code);
    document.getElementById('model-branch').classList.toggle('selected', !example.code);
  });
}
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
      button.textContent = 'Copied ✓';
    } catch { button.textContent = 'Select commands below'; }
    setTimeout(() => { button.textContent = 'Copy commands ⧉'; }, 2200);
  });
}

// Fixed observations from the six-run trial, not predictions or live API results.
const recordedRuns = {
  astroid: { baseline: { calls: 8, tokens: 42127 }, singleton: { calls: 6, tokens: 30385 }, workflow: { calls: 6, tokens: 26515 } },
  pydicom: { baseline: { calls: 8, tokens: 45262 }, singleton: { calls: 7, tokens: 47520 }, workflow: { calls: 7, tokens: 38468 } }
};
const armNames = { baseline: 'Baseline', singleton: 'Single check', workflow: 'Workflow' };
let selectedArm = 'workflow';
const formatNumber = value => value.toLocaleString('en-US');
function differenceText(current, baseline, unit) {
  const difference = current - baseline;
  if (!difference) return `Same ${unit} as baseline`;
  return `${formatNumber(Math.abs(difference))} ${difference < 0 ? 'fewer' : 'more'} ${unit} than baseline (${(Math.abs(difference) / baseline * 100).toFixed(1)}%)`;
}
function updateRecordedRun() {
  const issue = document.getElementById('run-issue').value;
  const issues = issue === 'both' ? ['astroid', 'pydicom'] : [issue];
  for (const card of document.querySelectorAll('[data-task]')) card.hidden = !issues.includes(card.dataset.task);
  const sum = arm => issues.reduce((total, key) => ({ calls: total.calls + recordedRuns[key][arm].calls, tokens: total.tokens + recordedRuns[key][arm].tokens }), { calls: 0, tokens: 0 });
  const baseline = sum('baseline'); const selected = sum(selectedArm);
  document.getElementById('recorded-calls').textContent = formatNumber(selected.calls);
  document.getElementById('recorded-tokens').textContent = formatNumber(selected.tokens);
  for (const [id, key, unit] of [['call-difference', 'calls', 'calls'], ['token-difference', 'tokens', 'tokens']]) {
    const element = document.getElementById(id);
    element.textContent = differenceText(selected[key], baseline[key], unit);
    element.classList.toggle('worse', selected[key] > baseline[key]);
  }
  document.getElementById('baseline-token-count').textContent = formatNumber(baseline.tokens);
  document.getElementById('selected-token-count').textContent = formatNumber(selected.tokens);
  document.getElementById('selected-token-label').textContent = `${armNames[selectedArm]} tokens`;
  const maximum = Math.max(baseline.tokens, selected.tokens);
  document.getElementById('baseline-token-bar').style.width = `${baseline.tokens / maximum * 100}%`;
  document.getElementById('selected-token-bar').style.width = `${selected.tokens / maximum * 100}%`;
  const headings = { baseline: 'No automatic commands added', singleton: 'Command added by the single-check rule', workflow: 'Commands added by the workflow' };
  document.getElementById('command-heading').textContent = headings[selectedArm];
  const suite = issue === 'both' ? 'python -m pytest -q tests  # Astroid\npython -m pytest -q pydicom/tests  # pydicom' : `python -m pytest -q ${issue === 'astroid' ? 'tests' : 'pydicom/tests'}`;
  document.getElementById('run-commands').textContent = selectedArm === 'baseline' ? 'No added commands. The model chose its own tool calls.' : selectedArm === 'singleton' ? 'git diff --check' : `${suite}\ngit diff --check\ngit diff --stat`;
  document.getElementById('command-note').textContent = selectedArm === 'baseline' ? 'This is the ordinary agent run used for comparison. It still ran commands and tests chosen by the model.' : `The fixed rule triggered once ${issue === 'both' ? 'in each task' : 'in this task'} after successful tests on a changed checkout. ${selectedArm === 'workflow' && issue === 'both' ? 'Each task ran only its own test suite, then both diff commands. ' : ''}The results were returned to the model with a reminder not to repeat unchanged checks.`;
}
document.getElementById('run-issue').addEventListener('change', updateRecordedRun);
for (const button of document.querySelectorAll('[data-arm]')) button.addEventListener('click', () => {
  selectedArm = button.dataset.arm;
  for (const other of document.querySelectorAll('[data-arm]')) other.setAttribute('aria-pressed', String(other === button));
  updateRecordedRun();
});
updateRecordedRun();
