# Project page

`index.html` is a self-contained project explainer. It has no build step, JavaScript, external fonts, analytics, or runtime dependencies. All navigation is within the page, so it works under a GitHub Pages repository subpath and when opened directly from disk.

Preview from the repository root:

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`.

The GitHub Actions workflow in `.github/workflows/pages.yml` uploads only `docs/` and deploys it to GitHub Pages on pushes to `main` or manual dispatch. Configure the repository’s Pages source as GitHub Actions. The expected public address is `https://hexapode.github.io/autotoken/`. The empty `.nojekyll` file marks the contents as plain static files.

The experiment figures are a fixed pilot snapshot from `data/analysis/two-issue-discovery/analysis.json`: two distinct development issues, 17 model calls, and two local validation passes. The page deliberately does not describe them as official SWE-bench scores or evidence of model-call savings. Update the snapshot and implementation status as new evidence becomes available. Raw traces and credentials must not be copied into the public site.
