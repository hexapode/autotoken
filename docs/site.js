const examples = {
  sort: { request: '“Sort these numbers ascending.”', label: 'DETERMINISTIC OUTPUT', output: '[1, 2, 9]', note: 'New input. Same procedure.', code: true },
  format: { request: '“Trim whitespace from these strings.”', label: 'DETERMINISTIC OUTPUT', output: '["hello", "world"]', note: 'An explicit contract. A repeatable transformation.', code: true },
  reason: { request: '“Why does this unfamiliar test fail?”', label: 'FALL BACK TO THE MODEL', output: 'Reason. Inspect. Investigate.', note: 'No validated program fits. Let the model work.', code: false }
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
const copy = document.getElementById('copy-command');
copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('npm test\nnpm run demo\nnpm run eval'); copy.textContent = 'Copied ✓'; }
  catch { copy.textContent = 'Select commands below'; }
  setTimeout(() => { copy.textContent = 'Copy commands ⧉'; }, 2200);
});
