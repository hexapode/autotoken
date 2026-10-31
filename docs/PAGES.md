# Project page

`index.html`, `styles.css`, and `site.js` form a static project explainer with no build step, external fonts, analytics, or runtime dependencies. A small local script switches illustrative routing examples, explores the six recorded experiment results, and copies setup commands; it makes no network or model calls. Core content and the complete results table remain readable without JavaScript. Relative asset paths work under the GitHub Pages repository subpath and directly from disk.

Preview from the repository root:

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`.

The GitHub Actions workflow in `.github/workflows/pages.yml` uploads only `docs/` and deploys it to GitHub Pages on pushes to `main` or manual dispatch. Configure the repository’s Pages source as GitHub Actions. The expected public address is `https://hexapode.github.io/autotoken/`. The empty `.nojekyll` file marks the contents as plain static files.

The current results snapshot comes from `eval/swebench/WORKFLOW_EXPERIMENT.md`: two independent development issues, three arms, and six completed runs. Baseline used 16 model calls and 87,389 reported tokens; singleton used 13 and 77,905; workflow used 13 and 64,983. Every patch passed repository tests and an independent public-issue regression in a fresh checkout. These are not official SWE-bench scores, and the small sample does not establish general savings or a workflow advantage over singleton on call count.

The page distinguishes the fixed experimental tool-executor rule from the proposed learned router. Ordinary collection remains record-only. The expanded six-issue, two-rollout, three-arm experiment is running (36 planned runs); execution was confirmed locally. Publish its results separately when complete. The expanded issues currently have repository-suite checks, not independent issue regressions. Avoid undated live collection counters that immediately become stale.

Keep the architecture, implementation status, and evidence limitations aligned when updating results. Raw traces, private ledgers, and credentials must not be copied into the public site. Only `docs/` is uploaded by the Pages workflow.

The recorded-run explorer uses the exact per-issue values in `site.js`: Astroid baseline 8 calls / 42,127 tokens, singleton 6 / 30,385, workflow 6 / 26,515; pydicom baseline 8 / 45,262, singleton 7 / 47,520, workflow 7 / 38,468. Differences compare separate recorded runs, not estimated savings or a causal guarantee. In particular, pydicom singleton used 2,258 more tokens than baseline. Keep the no-JavaScript defaults and totals table aligned if updating these observations.

The install guide uses the GitHub package (`npm install -g github:hexapode/autotoken`), not a published npm-registry package. Keep its Node minimum, CLI flags, provider protocols, and `.autotoken.env` instructions synchronized with the CLI. The default proxy is record-only; the guide must not imply that installation enables the experimental workflow.
