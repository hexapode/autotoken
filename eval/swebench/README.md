# SWE-bench baseline pilot

This runner collects real Pi trajectories for one issue, exports the resulting patch, and invokes the official SWE-bench evaluator. It uses `gpt-6.1-sol` with medium reasoning through our Responses recording proxy. It is a **record-only baseline**, not learned action substitution.

## Setup

Requires Node.js 22.19+, `uv`, Docker with a running engine, and `LLM_API_KEY` or `OPENAI_API_KEY`. The pinned Python evaluator is SWE-bench 5.0.2; Pi is 1.4.0.

```sh
npm ci --ignore-scripts
uv venv --python 3.12 .venv
uv pip sync --python .venv/bin/python eval/swebench/requirements.lock.txt
docker info
```

The runner uses official x86_64 task images. On Apple Silicon, Docker must support `linux/amd64` emulation. Pulls can be large and retained images consume disk space. No existing containers or images are deleted by our runner; it removes only the uniquely named inference container it creates. The official evaluator manages its own evaluation containers.

## Local mode without Docker

Local dependency profiles cover Marshmallow, pydicom and Astroid. Each issue must pass its baseline suite before inference; the original Marshmallow #1343 and #1359 pilots also have independent public-issue regressions. Each run uses a fresh shallow checkout at the dataset base commit and a dedicated Python 3.9 environment (3.10 for Astroid). Unknown issues fail explicitly until a tested dependency profile is added.

```sh
npm run swe:run -- --execution local \
  --instance marshmallow-code__marshmallow-1343 \
  --max-requests 20 --timeout-seconds 900
```

Local mode does **not** require Docker and never invokes the official evaluator. It checks that the original repository suite passes and a regression derived from the public issue fails before spending model calls. After inference, it applies the exported patch to a separate clean checkout at the base commit and reruns the suite and the same independent regression there. Read `manifest.evaluation.passed`; there is no official `resolved` score in this mode.

The only agent tool is `local_bash`. It starts commands in the checkout with the task virtual environment, a fresh HOME, no shell startup files, and a minimal environment that excludes upstream credentials and the local proxy token. Commands time out after at most 120 seconds, killing their process group. **This is not a filesystem or network sandbox**: shell commands have the host user's permissions. Project scope and avoiding network access are instructions, not enforced boundaries.

The preparer writes only public task metadata in local mode; it does not save SWE-bench evaluation scripts, test patches, hints, or gold patches. Local regression checks are authored from the public issue. Artifacts additionally include `before-tests.log`, `before-regression.log`, `after-tests.log`, `after-regression.log`, and a dependency snapshot in `task-requirements.txt`. Source checkout, environment, and traces remain available for inspection after the run. Local outcomes are exploratory evidence and are not comparable to official SWE-bench scores.

The first recorded local pilot completed with nine model calls and 74,065 reported total tokens. The original 779 tests passed before inference while the public-issue regression failed. The exported patch passed 786 tests (seven added by Pi) and the independent regression after applying it to a clean checkout. This demonstrates a successful baseline trajectory, not learned-program savings.

## One-issue pilot

```sh
npm run swe:run -- \
  --instance marshmallow-code__marshmallow-1343 \
  --max-requests 20 \
  --timeout-seconds 900
```

The default dataset is `SWE-bench/SWE-bench_Lite`, split `dev`. This keeps the official test split untouched while developing the approach. The runner prepares one instance per invocation; use fresh output directories for independent runs.

Options:

- `--execution docker|local`: defaults to Docker; local mode must be selected explicitly.
- `--instance OWNER__REPO-NUMBER`: required issue ID.
- `--dataset NAME`, `--split NAME`: default Lite/development dataset selection.
- `--out NEW_DIRECTORY`: choose an output location; existing directories are refused.
- `--prepare-only`: download/pin the task and create artifacts without Docker or inference.
- `--no-evaluate`: export predictions but skip scoring.
- `--max-requests N`: at most N provider dispatch attempts (default 30); no retries are added by the proxy or Pi configuration.
- `--timeout-seconds N`: overall Pi process deadline (default 1200).

For Docker mode, the container settings below apply; local mode does not impose CPU, RAM, or process-count isolation. Each call has an 8,192 output-token cap. Tool commands have a maximum 120-second deadline. Inference containers use two CPUs, 4 GiB RAM and a 256-process limit. These limits do not apply to the official evaluator, whose test timeout is 600 seconds and worker count is one. Model calls incur normal provider charges. Request count and output caps are not dollar budgets; input size also contributes to cost.

## Isolation and evaluation protocol

1. Resolve the dataset's revision and load the selected task. Save the issue, repository, base commit, and image in `task.json`. Save evaluation-only metadata separately on the host without the gold patch or hints.
2. Pull the official task image, record its image ID/digests, and create a fresh container. Verify its HEAD matches the base commit and its working tree is clean.
3. Start a loopback recording proxy on an ephemeral port. Run Pi in a separate host working directory with only the explicitly registered `container_bash` tool. All model-requested reads, searches, edits and tests run inside the container through this tool.
4. Disable container networking, drop capabilities, disallow new privileges, and mount no host files or Docker socket. The container receives no API key or proxy token. The model cannot invoke host built-in tools; Pi extensions, MCP, skills, context files and project discovery are disabled except for our explicit container extension.
5. After clean inference completion, stage changes inside the disposable container and export `git diff --cached --binary BASE_COMMIT`, including new nonignored files. Remove the inference container.
6. Score the prediction in a separate clean container using `python -m swebench.harness.run_evaluation`. Evaluator-only patches/scripts are never placed in the inference container or model prompt.

Pi itself runs on the host and the custom tool invokes Docker's CLI there. The isolation boundary for model-generated shell commands is the Docker container, not the Pi process. This is not protection against a Docker/kernel vulnerability. The official evaluation harness has its own container configuration; it is not our inference container. Keep the agent settings, tool interface and environment identical when comparing a future learned proxy against this baseline.

## Artifacts

Each run writes `data/swebench/<issue>-<timestamp>/`:

- `manifest.json`: current stage, pinned versions, dataset revision, image identity, inference exit status, usage, evaluation summary, errors and timestamps.
- `task.json`, `prompt.txt`: public task inputs and exact model prompt.
- `evaluator-dataset.json`: evaluator-only snapshot. Never feed this file into learning or agent prompts.
- `traces/`: full model traffic, grouped by run, issue and session.
- `pi-events.jsonl`: Pi event output (stderr diagnostics may also appear).
- `patch.diff`, `predictions.jsonl`: final working-tree patch and official prediction format.
- `prepare.log`, `image-pull.log`, `evaluation.log`, `logs/`: preparation and evaluator diagnostics.
- Official aggregate report: resolved/unresolved issues, errors and infrastructure classifications.

A run reaching `complete` means the pipeline finished, not that the issue was solved. Read `manifest.evaluation.resolved` and the official report. Failed inference, exhausted budgets, incomplete streams, and infrastructure failures are not silently treated as successful runs. Artifacts remain available after failure. Empty patches are exported and the evaluator classifies them; do not interpret a missing per-issue test report as a pass.

Do not infer correctness from the model's final message. Do not reuse development trajectories as held-out evidence. The next collection should use a predeclared discovery/calibration/held-out split, then freeze learned programs before paired evaluation. This runner currently processes one baseline task; automatic pattern learning and substitution are separate work.

## Verification

```sh
npm test
.venv/bin/python -m unittest discover -s eval/swebench -p 'test_*.py'
npm run swe:run -- --instance marshmallow-code__marshmallow-1343 --prepare-only
```

Unit checks cover task-data separation, container isolation arguments, shell argument boundaries, and budget validation. A full issue run additionally requires a healthy Docker engine and live model access. The evaluator's official source and behavior are available in the pinned environment at `.venv/lib/python3.12/site-packages/swebench/`; see also the [official evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/).


## Discover recurring agent actions

```sh
npm run swe:analyze -- data/swebench data/analysis/discovery
npm run swe:propose -- data/analysis/discovery/analysis.json data/candidates/discovery
```

The analyzer counts current response actions, links subsequent tool results, and separates repeated rollouts from distinct issues. Command categories are heuristic observations, not a shell parser or execution policy. The proposer uses gpt-6.1-sol to select bounded read-only operation identifiers and cite evidence from at least two passing development issues. A compiler emits pure functions proposing fixed tool calls. Programs remain inactive; this does not modify proxy routing.

The first two local issues passed fresh-checkout suites (786 and 971 tests) plus independent public-issue regressions. Together they used 17 model calls and 154,009 reported total tokens, including 116,641 cached input tokens. Two compiled proposals cover workspace inspection and post-test diff checks. Their guards triggered 2 and 4 times in discovery replay, with **zero exact full-command matches**. They capture common substeps; these results establish neither safe replacement nor token savings. The first synthesis attempt was rejected for invalid operations; the corrected format produced two accepted specifications. Synthesis token usage is recorded separately from baseline usage.

Both baseline runs hit missing `rg`. Future local preparations copy the host search binary into the task's minimal PATH and record its source/version in `search-tool.json`; missing-search recovery is excluded from proposals. The second run clarified timeout units in the tool schema. Freeze these environment/interface changes before any paired comparisons.

Next: collect independent calibration issues, test abstention and semantic equivalence, then freeze candidates and a decision router for paired baseline/substitution runs. Include router and synthesis costs, failures, latency, and downstream patch correctness. Discovery replay is not held-out validation.

## Larger discovery collection

```sh
.venv/bin/python eval/swebench/collection_inventory.py --out data/collection-inventory.json
npm run swe:collect -- data/collection-inventory.json data/collections/discovery-1000 100 1000
```

The last arguments are the dollar accounting ceiling and maximum provider queries. Choose the ceiling before starting paid inference. The pinned full SWE-bench **development** inventory includes 96 distinct Marshmallow/pydicom/astroid issues; it never reads the test split for collection and never repeats an issue to inflate the sample. This inventory may not yield 1,000 useful calls. Expand tested repository profiles if it is exhausted. Keep the official test split untouched for future evaluation.

Collection is sequential, resumable with the same command, and uses fresh checkouts. A baseline suite must pass before any paid inference. Unsupported environments are recorded as failures. Additional profiles have repository-suite checks only; only the original two pilot issues have independent public-issue regression checks. A passing suite alone does **not** establish that the issue was fixed. Raw traces, manifests, dependency snapshots and the collection ledger remain under ignored `data/`.

`collection.json` durably reserves each request before dispatch, using UTF-8 request bytes plus 8,192 overhead tokens and the output cap. Inputs over 128 KB, non-text inputs, server-side conversation references and nonstandard service tiers are rejected. Accounting uses conservative $5/M input and $10/M output with no cache discounts; unknown or interrupted usage retains the reservation. This is a local estimate against published standard small-context pricing, not a provider invoice or account-level billing limit. A usage estimate exceeding its reservation stops collection for review. Completed responses and dispatched queries are reported separately. Failed tasks and partial traces are retained rather than discarded.

Use `collection.json`/`summary.json` for progress. `collector.lock` prevents concurrent collectors in the same directory. After a hard crash, verify the recorded PID has stopped before removing the stale lock. Interrupted issues are retained and skipped on resume; remaining issues continue. Ctrl-C stops the active task and collection. Model retry is disabled; each issue has a 40-query limit and 15-minute inference deadline. Baseline/environment preparation and post-run testing have separate deadlines.
