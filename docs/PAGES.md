# Project page

`index.html` is a self-contained project explainer. It has no build step, JavaScript, external fonts, analytics, or runtime dependencies. Local navigation uses page anchors; source and experiment links point to the public repository. The page works under a GitHub Pages repository subpath and when opened directly from disk.

Preview from the repository root:

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`.

The GitHub Actions workflow in `.github/workflows/pages.yml` uploads only `docs/` and deploys it to GitHub Pages on pushes to `main` or manual dispatch. Configure the repository’s Pages source as GitHub Actions. The expected public address is `https://hexapode.github.io/autotoken/`. The empty `.nojekyll` file marks the contents as plain static files.

The current results snapshot comes from `eval/swebench/WORKFLOW_EXPERIMENT.md`: two independent development issues, three arms, and six completed runs. Baseline used 16 model calls and 87,389 reported tokens; singleton used 13 and 77,905; workflow used 13 and 64,983. Every patch passed repository tests and an independent public-issue regression in a fresh checkout. These are not official SWE-bench scores, and the small sample does not establish general savings or a workflow advantage over singleton on call count.

The page distinguishes the fixed experimental tool-executor rule from the proposed learned router. Ordinary collection remains record-only. The expanded six-issue, two-rollout, three-arm experiment is running (36 planned runs); execution was confirmed locally. Publish its results separately when complete. The expanded issues currently have repository-suite checks, not independent issue regressions. Avoid undated live collection counters that immediately become stale.

Keep the architecture, implementation status, and evidence limitations aligned when updating results. Raw traces, private ledgers, and credentials must not be copied into the public site. Only `docs/` is uploaded by the Pages workflow.
