# Bounded validation workflow experiment

This experiment tests whether a multi-step workflow reduces more model calls than a single deterministic command. It uses a rule in the tool executor, not a learned decision-model router. The ordinary collection proxy remains record-only.

After the model runs a successful pytest command on a dirty checkout, the singleton arm automatically runs `git diff --check`. The workflow arm runs the configured full repository suite, `git diff --check`, and `git diff --stat`. Results are returned with the original tool output, including a reminder not to repeat unchanged checks. The reminder's effect is not separately isolated from execution. Execution occurs once per patch fingerprint, including untracked regular files. Failed or inconclusive tests, timeouts, truncated output, or patch mutation cause fallback. No workflow declares an issue solved.

The baseline, singleton and workflow use identical model, prompt, tool schema and description. The intervention changes execution and the evidence returned to the model. It does not directly synthesize a model response or claim that a repeated command fragment replaces an entire model query.

## Frozen offline test

Ten previously analyzed development issues supplied discovery evidence. The rule was frozen before reading seven further completed issue traces: Marshmallow #2123; Astroid #1351, #1364, #1417, #1614; pydicom #1139 and #1192. Across their 58 calls, nine guard opportunities yielded zero complete next actions covered by the singleton and one covered by the workflow. These are opportunity counts, not measured savings.

Actual workflow execution on fresh held-out final-patch checkouts passed 1,293 Astroid #1417 tests plus both diff steps. The pydicom #1139 suite timed out after 120 seconds; the executor returned fallback and skipped the remaining steps. The timeout's cause was not established.

## Paired live test

The paired trial uses two untouched development issues, Astroid #1866 and pydicom #1694. It runs baseline/singleton/workflow for Astroid and workflow/singleton/baseline for pydicom, using fresh checkouts for every arm. There is one rollout per arm per issue, so this is exploratory evidence with substantial sampling uncertainty. Final patches are tested in separate fresh checkouts, including independent regression scripts derived from the public issue descriptions. Both regressions were confirmed to fail on original base commits. No gold or benchmark test patches are supplied to the agents or learner.

```sh
node --env-file-if-exists=.env src/workflow-trial.js data/experiments/NEW_TRIAL 7
node src/workflow-report.js data/experiments/NEW_TRIAL
```

The first command requires the pinned `data/collection-inventory-v2.json` inventory and creates a new output directory. The second refuses an active trial and evaluates every final patch with the independent regressions. The $7 experimental allowance is part of the existing collection allowance, not additional authorization. Keep the collector stopped during the trial and debit experiment costs in its `externalCosts` ledger before resuming. Separate ledgers do not automatically coordinate budgets.

Reports preserve completed and failed runs, model-query counts, reported tokens, workflow triggers/fallbacks, and test results. Raw traces and private ledgers remain under ignored `data/`. Elapsed times include setup and final evaluation, so they are not pure inference latency. Full-suite passes and these regressions are not official SWE-bench scores.


## Initial live results

| Issue | Baseline calls | Singleton calls | Workflow calls |
| --- | ---: | ---: | ---: |
| Astroid #1866 | 8 | 6 | 6 |
| pydicom #1694 | 8 | 7 | 7 |
| Total | 16 | 13 | 13 |

Every patch passed the repository suite and independent public-issue regression in a fresh checkout. Each treatment triggered once, with no live fallback. Reported tokens totaled 87,389 for baseline, 77,905 for singleton and 64,983 for workflow. Both interventions used 18.75% fewer calls in this small sample; the workflow did not beat singleton on call count. Workflow token usage was 25.6% below baseline, but sampling variation and the returned reminder prevent attributing the difference entirely to bundling. Measured wall times included setup and evaluation: workflow was slower on both issues than singleton. No intervention is enabled in ordinary collection.

The six runs used 42 provider queries and $1.181725 in conservative accounting, debited from the same $25 collection allowance. Raw data is local at `data/experiments/workflow-live-v1/`; `comparison.json` records per-arm outcomes and limitations. Repeat across more independent issues and rollouts before drawing a general conclusion or promoting a workflow.

## Expanded trial

The follow-up freezes six unseen issues (Astroid #1903, #1959, #1978; pydicom #1413, #1633, #1674), two repetitions and three arms: 36 planned runs. Arm order cycles through all six permutations. The workflow remains unchanged. This trial uses an $8 reservation within the same $25 allowance and runs in a separate process alongside ordinary collection. Its holdout issues are excluded from discovery collection.

Pass a version-1 plan JSON with `issues` and `repeats` as the third argument to `workflow-trial.js`. Resuming requires identical plan, budget, pinned dataset and runtime hashes. Interrupted arms remain recorded and are not silently rerun. Report only complete three-arm blocks with passing suites as paired query deltas; preserve failures and unattempted blocks. The new issues do not yet have independent regression scripts, so suite passes alone are not proof of issue resolution.

The collection ledger reserves the full experimental allocation while its separate ledger is running, interrupted, missing or unreadable. It releases unused funds only after terminal completion or budget exhaustion, including unknown-usage reservations in the final charge. This permits two separate processes without multiple writers to the same budget ledger. A full multiworker collector still needs a central reservation service or disjoint budgets.


## Anthropic comparison

The trial runner also accepts `claude-opus-5-5` as its final argument, with `ANTHROPIC_API_KEY` supplied through an ignored local environment file. It uses native Anthropic Messages through the recording proxy and medium adaptive thinking. The issue plan, three arms and two repetitions can be reused for a separate provider comparison. Per-provider tokens are not directly comparable tokenizer units.

```sh
node --env-file=.env.anthropic src/workflow-trial.js data/experiments/opus-v1 BUDGET_USD data/experiments/workflow-expanded-plan.json claude-opus-5-5
```

Set an authorized numeric budget before launching. Opus accounting conservatively charges all input, including cached tokens, at $8/M and output at $20/M, covering the published one-hour cache-write rate. Premium speed/residency options and multimodal input are rejected by the experimental budget gate. The general recording proxy has no model-ID restriction; these limits belong only to the paid experiment runner. Model availability was verified through Anthropic's Models API; a full run requires a separate explicit spending allowance.


## Expanded GPT trial and discovery follow-up (2026-10-30)

The $8 expanded-trial allocation stopped after 27 complete runs and one incomplete attempt out of 36 planned runs. Nine complete baseline/single-check/workflow blocks cover six distinct held-out issues (three issues have a second repetition). Repetitions are not independent issues. All 27 complete runs passed repository suites; independent issue-specific regressions are unavailable for these six issues.

| Approach | Model calls | Reported total tokens | Elapsed seconds |
| --- | ---: | ---: | ---: |
| Baseline | 65 | 447,376 | 679.46 |
| Single check | 65 | 528,316 | 746.07 |
| Workflow | 63 | 482,501 | 797.14 |

These totals include only complete three-arm blocks. Workflow saved two calls (3.1%) but used 7.9% more tokens and 17.3% more elapsed time including preparation/evaluation. The initial two-issue token reduction did not repeat in aggregate. Budget truncation and small samples limit interpretation. Conservative expanded-trial accounting: $7.64556 across 198 requests.

The discovery collection exhausted its inventory with 331 requests: 40 completed runs, 48 failed attempts, and eight held-out issues. Analysis of completed runs covers 322 calls on 40 distinct issues; 39 passed local checks. The other nine requests belong to incomplete attempts and are excluded from the completed-trajectory analysis.

Heuristic tags show initial search in 39/40 runs and initial workspace inspection in 38/40. These are frequently bundled with issue-specific search terms, so replacing only `pwd` or `git status` would not remove the whole call. Manual inspection plus a strict command-only filter finds nine turns on nine distinct issues containing only Git diff/status commands. Several ask for the actual patch, beyond the existing workflow's whitespace check and statistics.

Next candidate: return a bounded patch-review packet (diff, whitespace check, status) once per changed patch, retaining model review and fallback. This is a candidate for an independent paired test, not nine demonstrated saved calls. Do not use the discovery issues to claim held-out performance. No learned router or replacement program was activated by this analysis.


## Parallel collection

`node --env-file=.env.anthropic src/workflow-trial.js OUTPUT 50 PLAN claude-opus-5-5 3` runs up to three independent issue/repetition blocks concurrently. Arms within each block retain the planned sequential order. Each task has its own checkout, home, environment, proxy, and trace directory. One process owns the synchronous reservation/settlement ledger; in-flight reservations count against the same total budget before dispatch. Separate processes must not share a ledger.

Send SIGUSR2 to the PID in `trial.lock` to drain: finish active tasks, then stop scheduling. SIGINT/SIGTERM interrupts active tasks. Resume ordinarily requires identical runtime hashes. An explicit `--migrate-runtime` on a stopped trial records old/new hashes for an intentional migration; plan, model, dataset revision, and budget must still match.

The Opus trial moved from serial to three workers after seven completed runs. One interrupted attempt was archived, with its charges retained, before retrying that task. Existing compressed Anthropic responses were reanalyzed locally to recover usage; original raw bytes and pre-recovery metadata remain available locally. Unknown/interrupted usage retains its reservation. Compression decoding is bounded to 16 MiB and does not alter forwarded bytes.

Parallelism changes machine contention. Do not interpret serial-versus-parallel run times as a treatment effect; report the scheduling transition and analyze model calls/tokens separately. The $50 cap covers both phases and the interrupted attempt.

## Trace-trained router replay

The next experiment implements the proposed loop as a restricted program compiler, a decision API, batch-trained logistic routing, and incremental candidate updates. It replays recorded traffic rather than intervening in a live agent. No new paid model calls were made.

The candidate `patch_review_v1` proposes `git diff --check; git diff --stat; git diff; git status --short`. Discovery selects support from training issues whose entire next action consists of recognized read-only Git diff/status commands. The program is generated from a fixed operation template, not arbitrary model-written source. Program/argument validation prevents the decision API from inventing executable commands.

Protocol:

- Freeze the 39 discovery runs that completed and passed local checks (314 requests). The remaining completed run failed checks; incomplete runs are excluded.
- Deterministically split issue IDs using SHA-256 with the fixed `router-v1:` prefix: 23 training issues / 187 examples, eight calibration / 64, eight test / 63. Positive compatibility labels: four, one, and three respectively.
- Inputs are features extracted only from commands/results preceding the target response. Target commands, final answers, and future outcomes never enter router features. Features describe previous tests, edits, searches, reads, diff/status, whether earlier edits/tests occurred, and turn position.
- Train a logistic classifier for 40 passes. Separately train an incremental classifier with one pass. Both use only training labels; serving weights stay frozen during evaluation.
- Choose a threshold using calibration only, requiring at least two compatible selections and zero incompatible selections. With only one positive calibration example, neither policy qualifies; both use a fallback-only threshold.
- Evaluate on eight internal test issues and separately on the six first-repetition baseline runs from `workflow-expanded-v2` (41 requests, one compatible turn). Treatment runs and second repetitions are excluded.

At the gated threshold both policies select zero programs. The exploratory 0.1 threshold was added as a diagnostic after the fallback-only run; it is not used for selection or promotion:

| Router / evaluation set | Selected | Compatible | Incompatible | Compatible turns missed |
| --- | ---: | ---: | ---: | ---: |
| Batch / eight internal test issues | 2 | 2 | 0 | 1 |
| Batch / six external issues | 1 | 0 | 1 | 1 |
| One-pass online / internal test | 0 | 0 | 0 | 3 |
| One-pass online / external | 0 | 0 | 0 | 1 |

There are zero exact command matches for the generated packet among selected actions. Compatibility is an opportunity label, not semantic output equivalence, task success, or saved calls. These discovery traces were previously inspected by the project, so the internal holdout is algorithm-held-out, not a pristine benchmark. The small positive sample does not establish reliable routing. No policy or program is promoted.

Reproduction:

```sh
node src/trajectory-analysis.js data/collections/discovery-25usd data/analysis/discovery-final
node src/router-experiment.js data/analysis/discovery-final/analysis.json \
  data/experiments/router-replay-v1 data/experiments/workflow-expanded-v2
```

Local artifacts include the split manifest, threshold curves, metrics, program source, and both router snapshots. The decision service is available through `autotoken router ROUTER_JSON` and can use the local classifier or a hosted Anthropic/OpenAI-compatible decision adapter. Hosted adapters have mocked tests, not measured routing accuracy in this replay. Its authenticated outcome endpoint updates a separate candidate, excludes known held-out issues, and records the evidence type. Replay labels cannot activate a policy. A contextual-bandit policy is not implemented.

Next requirement before live replacement: more independently labeled opportunities, meaningful bug-specific outcomes, and a paired comparison that counts decision cost, fallbacks, and program execution. Expanding supported programs may yield more useful training examples than lowering the routing threshold.


## All-trace grouped replay

A subsequent snapshot combines the pilot, discovery collection, both GPT workflow trials, and available completed Opus runs. It audits 830 trace records and scores 806 decisions from 109 finished runs across 48 issues; 24 records from unfinished/failed runs are excluded and retained in the audit. The Opus snapshot contains 240 attempts, 238 complete responses, and 34 finished runs. Collection was still in progress at snapshot time.

Five deterministic issue folds (`all-traces-v1:` SHA-256 ordering, round-robin assignment) rotate test and calibration roles. Every provider, repetition, and arm of the same issue stays together. Each issue appears in the test role exactly once. Baseline data alone trains and calibrates; fixed-workflow interventions are diagnostic only. Feature definitions, program template, learning rates, epoch counts, and threshold grid are unchanged from the first replay. Previously inspected traces make this cross-validation rather than a pristine external benchmark.

There are 499 baseline decisions with 14 compatible Git-review turns, plus 307 treatment decisions with seven compatible turns. Neither batch nor one-pass online routing qualifies in any calibration fold; both gated policies abstain throughout. At the previously defined exploratory 0.1 threshold, the batch router selects 46 baseline turns: 14 compatible and 32 incompatible (30.4% precision, 100% compatibility recall). The one-pass online router selects none. Exact command matches remain zero, and realized savings remain unmeasured.

This validates data plumbing, grouping, and replay behavior; it does not validate live program substitution. Incompatible labels do not establish actual task harm, and compatible labels do not establish identical output or success. The snapshot includes finished runs regardless of local-suite outcome to avoid silently filtering evaluation to successful tasks. Unfinished runs are audited separately. A better routing signal or additional useful programs is needed before live replacement.

```sh
node src/router-corpus.js data/experiments/router-all-traces-v1
# Or specify individual collections explicitly:
autotoken router-corpus .autotoken/replay PATH_TO_COLLECTION PATH_TO_TRIAL
```

The local report includes source counts, issue assignments, per-fold policies, provider-specific metrics, treatment diagnostics, and exclusions. The frozen snapshot permits reproduction even while more traces arrive. No new paid model calls are needed.

## Faster Opus discovery collection

`node --env-file=.env.anthropic src/fast-collect.js NEW_OUTPUT 20 12` starts a separate baseline-only collection using up to 12 workers and a shared synchronous budget ledger. It selects the 40 discovery issues whose earlier local runs completed; these are new Opus trajectories on existing issues, not 40 new independent issues. Keep issue-level train/test grouping across model providers.

The first burst reserves $20 from the original $50 Anthropic envelope after the initial Opus experiment completed at $12.43584 conservative accounting. The allocation is recorded locally in `data/experiments/opus-fast-allocation.json`; a second launch cannot silently allocate the same funds. Unknown or interrupted requests retain reservations. The collector does not increase output lengths or repeat requests to meet a spending target.

Speed changes: public task fields come directly from the pinned inventory, and each task clones local Git objects then checks out and verifies its original base commit. Pydicom fixtures are copied only when their bytes match hashes in that pristine commit. Source patches, home configuration, and virtual environments are not reused. Every task still runs pristine baseline tests and fresh-checkout patch evaluation. Concurrency changes wall-time contention, so this cohort is for discovery, not a direct runtime treatment comparison.

SIGUSR2 drains active tasks without scheduling more. SIGINT/SIGTERM interrupts active tasks. Use a new output directory; this burst runner does not silently resume interrupted work. The normal three-worker paired trial remains separate.

The first accelerated burst finished in 246.974 seconds (4m 7s): 308 completed provider responses, 36 completed coding runs with passing local checks, and four runs cut short by the conservative dollar guard. Known conservative accounting settled to $17.796492 after in-flight reservations cleared; this is not the provider invoice and overestimates cache-discounted charges. The rate was about 75 completed provider responses/minute. The completed trajectories contain 270 calls; the remaining responses belong to interrupted trajectories. Speed comparisons with the earlier paired trial are confounded by issue mix, validation work, and concurrency.

In those 36 completed runs, heuristic tags identify 17 pure search-then-file-read transitions across 13 distinct issues, while the strict standalone Git-review matcher finds zero turns. Inspection shows many edits/tests/diff checks already bundled in the same command. A bounded search-with-source-context program is therefore the next candidate, not an established 17-call saving. Its output relevance, token overhead, and downstream correctness still require independent evaluation.

After adding this cohort and the final initial Opus run, the local corpus contains 1,149 records and 1,083 scored decisions from 146 finished runs over 48 distinct issues. Grouped replay uses 769 baseline decisions and 314 treatment diagnostics. The existing patch-review classifier continues to abstain at its gated thresholds; the additional Opus negatives also make its 0.1 diagnostic policy abstain. Repeated runs increase observations without increasing the number of independent issues.

## Candidate programs for the demo

Three subagents each built a bounded program, with separate tests and frozen issue-level replay. The programs are `search-context.js`, `read-context.js`, and `patch-review.js`. They have no global proxy activation. The public demo runs deterministic search/context code on editable in-memory sample text and a simple text-diff preview; repository-backed variants run through `autotoken demo-programs`. Program buttons are explicit choices, not a learned-router demonstration.

Primary search replay uses the previously specified ±20-line windows, at most five files / 200 lines, and only completed search output to choose ranges. Existing all-traces-v1 fold0 is test, fold1 calibration, and folds2–4 discovery, across all providers/repetitions of an issue. Of 62 search-tagged held-out baseline turns, six support a bounded proposal. Two have a supported pure next-read label; one is fully range-covered and one partially covered. The full coverage occurs on pydicom1375: the proposed window includes the subsequent requested lines138–160. Discovery has four fully covered next-read turns and calibration two. Unsupported mixed shell commands abstain. The six test proposals add806 lines beyond recorded search evidence, so context overhead is material.

An independently implemented exploratory miner used a different ±40 policy and stricter parsing: its held-out search candidate covered zero of eight opportunities. These results are not pooled or treated as interchangeable. Expanded reads (fixed ±40, cap200) cover no follow-up pure-read turns among three held-out opportunities and add240 proposed lines. Patch review is compatible with three Git-only held-out turns across three issues out of156 baseline decisions, with zero exact command matches. None of these replay labels establish downstream task success or saved calls.

### Live development probe

A separate, opt-in Pi extension appends bounded source context after eligible successful searches. Its tool schema and description match baseline, and it adds no behavioral reminder. Both arms ran concurrently from fresh local checkouts on `marshmallow-code__marshmallow-1524` with Opus5.5 medium effort. This issue was previously inspected and belongs to the existing calibration group; this is a deliberately selected development mechanism check, not independent evaluation. One rollout per arm:

| Arm | Calls | Reported total tokens | Repository suite | Public-issue regression |
| --- | ---: | ---: | --- | --- |
| Baseline | 8 | 33,954 | Pass | Pass |
| Search context | 5 | 30,963 | Pass | Pass |

The context program triggered twice, appending10,020 bytes. The probe used $0.563712 in conservative accounting, within a separately reserved $3 portion of the existing Anthropic authorization. Total-token difference is -2,991 (-8.8%); call difference is -3 (-37.5%). Neither percentage is a general estimate of savings.

An independent check ran the identical issue regression on the pristine base commit `7015fc4333a2f32cd58c3465296e834acd4496ff`: it fails on the trailing-newline email. Both final patches reject the three invalid public-issue email examples while accepting the valid email. Full repository suites also pass. Model randomness, the deliberately chosen issue, and a single rollout per arm prevent causal or generalization claims. Repeated independent issues and full routing costs are still required.

### Further candidate mining

A separate subagent mined the frozen baseline corpus for additional candidates, preserving issue partitions and keeping command-level evidence local (`data/analysis/additional-patterns-v1/report.json`):

- Structured test results:108 `pytest ... | tail` observations across42 issues (25 observations /10 issues in heldout). In22 observations, an outer exit0 accompanies failure text. Some are intentional regression failures or compound commands; this is not proof that the agent declared success incorrectly. A program can preserve the test process status and provide bounded failure IDs/excerpts.
- Checked text edits:195 replace/write observations across48 issues. Only46 contain guards recognized by the miner; unrecognized guards may exist. A bounded replacement operation could assert expected occurrence counts and return a diff, while the model still chooses the edit.
- Isolated original-versus-patched checks:18 stash/test/restore observations across11 issues. Ten use whole-tree stash forms, which can also stash new tests. An isolated comparison runner is worth investigating.
- Test discovery followed by execution:33 observations across29 issues, but30 following turns also edit source, weakening whole-call replacement claims.
- Failure output followed by source inspection:36 observations with file/line pointers across27 issues; eight next turns include reads, none are pure read-only next turns.

These are exploratory opportunities and feasibility rankings, not validated programs or measured savings. Structured test evidence and checked edits are the most concrete next implementation candidates.


### Discovery-only candidate expansion

Reproduce with `node scripts/explore-candidates.mjs`. This pass reads only baseline runs in existing discovery folds 2–4: 455 decisions in 60 runs. Calibration and evaluation turns are excluded from candidate selection. Command-level evidence stays in ignored `data/analysis/more-candidates-v1/report.json`.

| Candidate | Observations | Distinct issues | Descriptive follow-up |
| --- | ---: | ---: | --- |
| Missing-path recovery | 26 | 17 | 20 followed by an inspection turn |
| Repository configuration packet | 33 | 24 | 29 in the first three turns |
| Test-and-diff verification packet | 15 | 13 | 12 followed by a final answer |
| Missing-tool recovery | 4 | 4 | Too sparse to prioritize |
| Same-file pure-read continuation | 0 | 0 | No support under the strict parser |
| Exact repeated read/search within conservative read-only epochs | 0 | 0 | No support under the strict parser |

Counts are heuristic observations and overlap across candidates. They are not calls that a program could necessarily replace. Mixed commands are common. Configuration collection and verification may already be batched; earlier collection adds tokens and cannot be assumed to save a turn. A missing path can be intentional or ambiguous, so recovery should suggest bounded matches rather than silently substitute or execute a guessed path. Recorded outputs and later commands are descriptive evidence only, never future inputs to a proposed router.

One agent per candidate completed an offline feasibility check for missing-path recovery, repository orientation, and verification. No new paid model calls or production routing changes were made for this pass. New independent issues are needed to validate any resulting policy.


#### Per-candidate feasibility checks

- **Path recovery:** `scripts/path-recovery.mjs` suggests bounded basename/test-prefix matches from the original base Git tree without executing or rewriting a command. In 33 diagnostics across the 26 discovery turns, it suggests paths for 14 turns across 12 issues; seven suggestions appear in the next command. It has 14 no-match diagnostics and five unsupported wildcard paths. A unique `tests/brain` → `astroid/brain` match is semantically misleading twice. Suggestions must remain informational. Nine checks pass (`node scripts/path-recovery-check.mjs`); replay is `node scripts/path-recovery-replay.mjs`.
- **Repository orientation:** exact parsing confirms 32 turns across 24 issues, versus the heuristic's 33 (one unsupported wildcard read). Of these, 28 occur in the first three turns. `node scripts/repo-orientation-probe.mjs` builds bounded source/test-root and configuration packets from original base Git objects for all 60 discovery runs. It covers 25 of 40 configuration-read substeps and all config reads in 18 turns, but zero whole turns: each also requests issue-specific information. Median config payload is 3,619 bytes, maximum 4,258. All packets pass bounds checks. Token cost and task benefit are unmeasured.
- **Verification:** deeper inspection finds three workspace-changing original-versus-patched comparisons among the 15 no-edit-tagged turns. Of the remaining 12, nine invoke CLI pytest (four full suites, five newly selected subsets) and three use custom Python wrappers. None repeats an exact prior test argv. An explicitly requested verification tool is more defensible than automatic repetition of the previous test. The heuristic tag alone is insufficient to establish a read-only operation.

These findings do not establish new whole-call savings. Path recovery is worth testing as a bounded tool-output helper; orientation and autonomous verification rank lower for call elimination. The earlier structured-test-result and checked-edit candidates remain useful alternatives to investigate.


### Three reliability-program prototypes

A second one-agent-per-candidate pass built three opt-in programs under `scripts/`. Only baseline discovery folds 2–4 were analyzed. No recorded commands were executed, no paid model calls were made, and none of these programs was activated in the proxy.

| Program | Discovery evidence | Implemented behavior | What this establishes |
| --- | --- | --- | --- |
| Structured test results | 66 tail-wrapped turns / 24 issues; 15 outputs show failure evidence with an outer shell exit of zero | Direct pytest subprocess status, bounded failure IDs and excerpts, timeout/output limits | Reliable evidence in fixtures, not historical success labels or saved calls |
| Guarded text edits | 118 opportunities / 28 issues; static extraction supports 56 turns / 24 issues, containing 127 replacements | Exact occurrence count, SHA256 guard, confined paths, atomic replacement | Safe refusal in fixtures; historical guards remain unverified |
| Isolated regression comparison | 10 comparison turns / 6 issues: 8 stash workflows and 2 temporary source swaps | Separate base/patched copies, identical explicit test overlays, hashes and bounded test execution | Synthetic original-fails/patched-passes result; zero certified historical replays |

**Structured test results.** `scripts/structured-test.mjs` offers a parser and a direct subprocess runner. All 66 historical pytest exit statuses remain unknown because the trace's shell exit cannot substitute for the test process exit. Eight turns contain multiple pytest commands; failures can be intentional, so the 15 observations are not false-success accusations. There are 65 recognizable summaries and 12 outputs with failure IDs. Structured JSON is 18,467 characters versus 29,322 original characters in aggregate, but 30 of 66 outputs grow. This is a character comparison, not token savings or evidence that omitted output is irrelevant. The runner uses a trusted interpreter/workspace and explicit targets, inherits plugins by default, and uses fixed reporting flags; it does not reproduce arbitrary historical commands or sandbox test code.

**Guarded edits.** `scripts/guarded-edit-program.py` requires an explicit path, old/new text, count, and content fingerprint. It refuses stale/ambiguous edits, traversal, symlinks, hardlinks, FIFOs, and oversized inputs. The workspace must serialize writes; fingerprint checks are not atomic compare-and-swap against concurrent writers. Of 56 statically supported turns, 53 also contain other commands. Generated operation JSON is 56,883 bytes versus 50,720 bytes of recorded scripts (+12.2%), even with short guard placeholders; actual SHA256 hashes add more. The model still chooses the change, and neither historical counts nor fingerprints were reconstructed. No token or call reduction is established.

**Isolated comparisons.** `scripts/isolated-regression.py` creates bounded temporary snapshots, adds identical explicit regression files to both, and runs explicit argv. Four observed workflows use whole-tree stash forms that can remove tracked test additions. The prototype verifies identical regression hashes and unchanged input worktree/Git metadata in fixtures. Historical regression overlays and pre-edit tests were not reconstructed, so there are zero certified historical automatic-replay cases. Temporary copies protect against ordinary test writes, not hostile code. A nonzero base exit and zero patched exit still require inspecting evidence to distinguish bug reproduction from environment failure.

Checks from a source checkout:

```sh
node scripts/structured-test-check.mjs /path/to/python-with-pytest
python3 scripts/guarded-edit-check.py
python3 scripts/isolated-regression-test.py
```

All fixture checks passed: pytest pass/failure/timeout/output-cap/spawn-error behavior; 13 guarded-edit refusal cases plus successful UTF-8, mode preservation, and cleanup; seven isolated-comparison checks. Replay scripts are `structured-test-replay.mjs`, `guarded-edit-mine.py`, and `isolated-regression-mine.py`; they require the private discovery corpus. Aggregate findings are public; raw evidence remains in ignored `data/analysis/` directories. These prototypes currently support reliability more strongly than autonomous whole-turn replacement.


### Source-inspection candidate round

Three further agents tested separate candidates using baseline discovery folds 2–4 only (455 decisions). No paid model calls, evaluation-fold inspection, or live routing changes were made.

| Candidate | Discovery result | Assessment |
| --- | --- | --- |
| Failure traceback context | 28 plans / 18 issues; zero complete next turns covered | Deprioritize automatic injection; up to 2,720 proposed source lines |
| Relevant-test locator | 61 proposals / 26 issues; 15 proposals match a following explicit test-file operand | Inexpensive filename hints; no demonstrated call elimination |
| Compact multi-file reads | 24 supported turns / 17 issues; argument JSON 2,589 → 1,945 bytes | 24.9% smaller arguments, only 644 bytes across the discovery corpus |

**Failure context.** `scripts/failure-context.mjs` uses only completed failure output: at most four supported relative Python file/line pointers, ±20-line windows, 160 lines total. Among 43 failure-bearing test turns it produces 28 plans. Seven following turns include reads, but none is a supported pure bounded-read turn. Two mixed turns contain parseable requested ranges; one has partial coverage, totaling 24 of 72 parseable requested lines. No full turns are covered. The 2,720 proposed lines are a budget, not reconstructed historical source; unsupported mixed commands leave incomplete labels. Eleven fixture checks pass. This count differs from the earlier failure-context miner because it also accepts quoted Python traceback frames and uses test-run tags.

**Test locator.** `scripts/test-locator-probe.py` compares filename words from up to four previously requested source files with original-base test filenames, returns at most four matches, and excludes already mentioned test paths. All 60 base trees were available. It proposes 80 paths on 61 turns; 36 following turns have supported explicit test-file operands, and 15 proposal turns match at least one (16 matched paths across ten issues). The 64 unmatched suggestions are not proven irrelevant. Seven matching turns also edit code, and four only read/search. A path list does not replace any of those actions. Suggestion text totals 2,343 bytes (~38 per proposal), excluding wrappers, source contents, and tokenizer effects. Thirteen fixtures pass, including search-pattern versus path handling, pytest selectors, heredoc/wildcard abstention, and original-tree/symlink exclusion. Git output is captured from trusted local repositories; the tree-size limit is checked after capture, not a process-memory bound.

**Compact reads.** `scripts/compact-read.mjs` parses a conservative subset of whole read-only shell turns into tuples and executes bounded, numbered multi-file reads. Arguments use `{"r":[["file.py",10,30],[null,50,70]]}`; a null path repeats the preceding path, and a null end reads through EOF subject to caps. All 24 supported turns had successful recorded shell results. Single-range arguments total 707 → 575 bytes over 13 turns; multi-range arguments total 1,882 → 1,370 over 11 turns (-27.2%). Five turns include unbounded historical `cat` reads whose runtime eligibility is unknown. Verbose object arguments would instead total 3,509 bytes (+35.5%), so representation matters. Both sides include argument JSON envelopes; tool names, schemas, and unchanged execution metadata are excluded. No tokenizer, billing, task-quality, or model-call savings were measured. Numbered output may add input tokens, and the model still selects every path/range. Nine fixtures pass, covering output fidelity, truncation, serialized JSON caps, and traversal/symlink/FIFO rejection. The reader assumes a trusted, quiescent workspace and is not a sandbox against concurrent directory changes.

Run checks with:

```sh
node scripts/failure-context-check.mjs
python3 scripts/test-locator-check.py
node scripts/compact-read-test.mjs
```

Replays are `failure-context-replay.mjs`, `test-locator-probe.py`, and `compact-read-mine.mjs`; they need the private corpus. The test locator is worth testing alongside search context on new issues. Compact reads offer modest argument compression; failure-context injection currently has weak coverage and substantial potential overhead.


### Final local discovery pass

A further three-agent pass used the same 455 baseline discovery decisions (60 runs / 28 issues), without paid calls or evaluation-fold inspection:

- **Read-output deduplication:** 55 strictly parsed read/search-only turns and 17 pure bounded-read turns yielded zero same-turn range overlaps, zero cross-turn overlaps within conservative read-only epochs, and zero identical complete read payloads over 80 bytes. `scripts/read-dedup.mjs` supplies a bounded union/reference planner, with ten passing checks. Union requires an immutable snapshot; cross-turn references require matching whole-file fingerprints and confirmation that referenced text remains available after context compaction. Otherwise content must be resent. No observed bytes or calls saved.
- **Reusable Python inspection:** 140 recognized heredoc blocks contained 18 without recognized writes, but only two unrelated inspection examples (runtime `type` and type hints). No recurring signature/source/module-location procedure or safe static equivalent was found. The AST-only audit does not execute recorded code; absence of recognized writes is not proof of purity. Ten checks pass for `scripts/python-inspection-audit.py`. Candidate rejected for insufficient recurrence.
- **Targeted failed-test reruns:** among 40 failure-summary turns, 39 have a single supported tool action. A conservative prior-output planner produces 22 plans across 16 issues, but zero exact next pytest argv matches and zero exact failed-node-set matches. Seventeen following turns run recognizable pytest; thirteen also edit. Plans add 4,200 JSON bytes. Five fixture groups pass for `scripts/targeted-rerun.py`, which never executes commands and would require registered environment and confirmed patch-change metadata before any live use. Automatic routing is not supported by this replay.

Checks: `node scripts/read-dedup-check.mjs`, `python3 scripts/python-inspection-check.py`, and `python3 scripts/targeted-rerun-test.py`. These negative results support broadening the discovery corpus before further local mining.


### Public multi-harness discovery sample

We imported 100 trajectories each from three pinned public datasets, without running model inference or executing recorded code. Downloads and raw/normalized traces live on an external data volume; only importer code and aggregate metadata are published.

| Source and attribution | Harness | Sample trajectories | Assistant turns | Reported outcomes |
| --- | --- | ---: | ---: | --- |
| [Nebius SWE-agent trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) · CC BY 4.0 | SWE-agent | 100 | 2,316 | 8 resolved / 92 unresolved |
| [Nebius SWE-rebench OpenHands trajectories](https://huggingface.co/datasets/nebius/SWE-rebench-openhands-trajectories) · CC BY 4.0 | OpenHands | 100 | 5,929 | 59 resolved / 41 unresolved |
| [Kwai-Klear SWE-smith mini-SWE-agent-plus](https://huggingface.co/datasets/Kwai-Klear/SWE-smith-mini_swe_agent_plus-trajectories-66k) · MIT | mini-SWE-agent-plus | 100 | 3,280 | Outcome label absent in sampled schema |

Total: **300 trajectories, 11,525 assistant turns, 11,516 extracted actions, 298 distinct issue IDs, 268 issue/base-commit groups, and 259 repositories**. Two issue IDs occur across harnesses. Synthetic variants sharing a repository/base commit stay together for splitting. The datasets contain SWE-bench-related GitHub issues and synthetic SWE-smith tasks; this is not a new SWE-bench Verified evaluation. Source-reported outcomes are not independently rechecked or comparable success-rate estimates across harnesses.

Sampling uses a fixed seed, one trajectory per issue within each harness, repository round-robin selection, and only discovery folds 2–4. All 48 known local issue IDs are excluded. Reserved calibration/evaluation groups are excluded before reading selected conversations. Shard selection is purposive: three of twelve SWE-agent shards, the single OpenHands file, and five of 47 mini-SWE shards. This is a broad discovery sample, not an unbiased population estimate. Exact source revisions, shard indexes, licenses, selection rules and aggregate counts are in [`docs/public-traces-summary.json`](../../docs/public-traces-summary.json). Source cards/licenses and checksum manifests are retained locally.

The download is 2,509,741,602 bytes; normalized JSONL is approximately 140 MB. Each record retains original messages, normalized roles, assistant turns, observations and provenance. SWE-agent custom actions remain distinct from bash; OpenHands native tool IDs align observations. There are 95 terminal `finish` calls without observations and five final non-finish calls with missing results. Eight assistant turns with observations have unsupported action encoding; their original content is retained. Missing results are not fabricated. Counts are assistant turns, not measured API request counts; original costs, token usage and timing are unavailable.

OpenHands' sample includes 2,993 `execute_bash` actions and 2,528 `str_replace_editor` actions, plus `think`, `task_tracker` and `finish`. This broadens the previous shell-only discovery evidence and gives future miners structured edits to inspect. No new program savings have been measured on these public trajectories.

Reproduce from a source checkout with `requests` and `pyarrow` installed:

```sh
python3 scripts/sample-public-traces.py --output /path/to/external/autotoken/public-traces/v1
python3 scripts/normalize-public-traces.py --output /path/to/external/autotoken/public-traces/v1 --per-harness 100
python3 scripts/public-traces-check.py
python3 scripts/audit-public-traces.py --output /path/to/external/autotoken/public-traces/v1
```

The normalizer's nine synthetic checks cover message preservation, role conversion, custom actions, tool-ID alignment, terminal completion, missing results, ambiguous commands and grouped variants. The corpus audit confirms unique issues per harness, no known-local issue overlap, consistent discovery folds and preserved message counts. The normalization and audit scripts require the existing local fold manifest to reproduce its exclusions and refuse to run if it is absent.


### Mining the public multi-harness sample

One agent mined each harness, followed by independent reruns of all miners and 37 fixture checks. The source is the 300-record public discovery sample above. No held-out conversations, paid inference, or recorded commands/script bodies were executed. Proposals are computed from prior completed tool output; next actions and their outputs are retrospective labels. Candidate policies were developed on this discovery sample, so these results need frozen-policy testing on separate issue/base groups.

| Candidate | Proposals | Next-action match | Matched issue coverage |
| --- | ---: | --- | --- |
| SWE-agent unique line → `goto` | 23 / 22 issues | 22 exact actions | 21 issues |
| SWE-agent unique file → `open` | 62 / 43 issues | 39 exact actions | 26 issues |
| OpenHands oversized view → bounded retry | 49 / 30 issues | 34 exact + 8 equivalent EOF reads | 28 issues combined |
| mini-SWE write script → run | 584 / 100 issues / 70 base groups | 469 exact actions | 83 issues / 61 base groups |
| mini-SWE edit source → rerun previous script | 167 / 68 issues / 56 base groups | 75 exact actions | 52 issues / 43 base groups |

**SWE-agent navigation.** The typed `open`/`goto` planner in `scripts/mine-public-swe-agent-plan.mjs` respects SWE-agent custom-tool semantics, unique result counts, safe paths, current open-buffer state, and explicit search filenames. All 61 matched next navigation actions display the expected file with no captured explicit error. They span 41 issues combined. Twelve fixture checks pass. One unique-line search leads directly to an edit, so navigation is not universally necessary. Some unmatched file opens include a line argument, deliberately excluded from the exact label.

Failure loops also appear: 216 invalid-command outcomes across four issues, with 213 identical next commands across three issues. These counts are dominated by 210 repetitions of malformed `find. -name '*.html'` on a single issue. Rejected edits produce 247 events across 43 issues, but only 48 repeat the identical edit; semantic repair is usually needed. Of 53 scrolling actions, ten scroll again and 19 edit instead, leaving no reliable automatic stopping rule. The sample is mostly older Llama-based agents (92 70B records, seven 8B, one 405B), so these loops do not establish generality to current models.

**OpenHands view repair.** `repair_view` in `scripts/mine-public-openhands.py` uses the failed request and exact native error-reported line count, preserves the start line, clamps only the oversized end, and allows one retry with a maximum 250-line request. It assumes an unchanged file version and an immediate serialized retry; another error requires fallback. Of 52 range errors, 49 are supported. All 42 matched subsequent reads have the native numbered-output header and every requested line. Five terminal non-finish result gaps are excluded from success labels. Nineteen fixtures check repair behavior, refusal conditions, one-retry policy and native source-read evidence. Equivalent EOF matches require the same start/path and supported argument keys; they are kept separate from exact arguments.

Other OpenHands policies are much weaker: expanding 734 bounded reads covers 66 next ranges (two already covered) but could add 52,939 lines; 21 failed replacements yield nine same-file views; repeating a previous passing pytest command after 815 successful edits matches only four next commands; 76 traceback opportunities cover six next read ranges. Its native editor already implements exact replacement, so another replacement tool is not itself a new optimization.

**mini-SWE write-and-run.** `plan_script_run` in `scripts/mine-public-mini.py` recognizes a strict successful single-file heredoc write and proposes a fixed registered `python <path>` action before inspecting the next turn. The plan binds the script hash, restricts paths/size and requires an explicit run-after-write policy. It is inert: arbitrary script content is not executed by mining or fixtures. Six fixture groups pass, including early heredoc terminators and exclusion of bundled setup from exact matches. Of 584 proposals, 469 (80.3%) exactly match the next whole action; another 67 appear only within larger commands, and six use different interpreters. Automatic execution after every write would therefore be too broad. The 469 matching next outputs show 440 zero exits and 29 nonzero exits; those are script process results, not bug-resolution labels. Replacing an assistant turn could remove useful reasoning, and full-task quality is untested.

A compact wrapper around mini-SWE's existing edit helper reduces argument JSON from 305,580 to 280,242 bytes across 246 edits (25,338 bytes / 8.3%). That excludes schema/tool-name/output-token costs. Of 99 terminal handoffs, 94 use identical commands, but completion intent cannot be inferred from passing tests alone. These remain smaller secondary candidates.

The bounded read-repair and navigation planners are the clearest next live-test candidates. Write-and-run has greater observed coverage but needs an explicit combined operation with interpreter/environment registration and separate evaluation. None of these replay matches is an observed avoided model call, and no learned router has been activated.

Reproduce with the external normalized corpus:

```sh
node scripts/mine-public-swe-agent.mjs /path/to/sample.jsonl /path/to/mining/swe-agent
python3 scripts/mine-public-openhands.py --input /path/to/sample.jsonl --output /path/to/mining/openhands
python3 scripts/mine-public-mini.py --input /path/to/sample.jsonl --output /path/to/mining/mini
node scripts/mine-public-swe-agent-check.mjs
python3 scripts/mine-public-openhands-check.py
python3 scripts/mine-public-mini-test.py
```

Only [aggregate results](../../docs/public-mining-summary.json), fixture code and planners are published. Event-level evidence remains on the external data volume. Dataset attribution and pinned revisions are in the public sample section above.

### Fresh-task live read-repair trial

`src/read-range-tool.js` implements the bounded oversized-read repair with one
retry. Both Pi arms advertise identical `local_bash` and view-only
`str_replace_editor` tools and receive the same prompt. Only the treatment
executor retries the supported native range error. Valid reads have identical
outputs. This is Pi with an OpenHands-style read tool, not a full OpenHands run.
No errors are injected into the live tasks. A fixed rule routes this program;
there is no learned routing-model call to subtract from usage.

`scripts/read-range-integration.mjs` runs real Pi, tools and proxy against a
scripted local provider: baseline makes three requests and treatment two, with
identical retrieved source. That establishes the mechanism, not live savings.
Eight read-tool fixtures and runner checks cover supported errors, abstention,
bounds, paths and identical prompts.

The live protocol fixes Opus 5.5, medium reasoning, 20 requests and 600 seconds
per run, three repeats, balanced arm order and three parallel issue workers.
Each run gets a fresh checkout and environment. The repository suite must pass
before inference. Dataset test patches remain host-only and are applied to
separate original and patched checkouts after inference; gold source patches
are never read. Evaluation is local, not the official SWE-bench evaluator.
Code hashes, task identities and schedule are frozen in the private protocol.
The durable request ledger shares the existing authorized experiment ceiling;
unfinished and failed requests retain conservative charges.

Tasks come from `nebius/SWE-bench-extra`, train revision
`11dcbfb30e19552df2a2f8030bd764adc95c92a5`, excluding known local issues and public
sample issue/base groups. Preflight initially admitted six pyupgrade issues.
A stricter terminal JUnit-message classifier caught an error immediately after
inference began: traceback text containing an assertion had admitted three
exception failures. Issues 146, 143 and 135 are excluded from the strict cohort;
890, 142 and 104 qualify. All runs and spending remain reported. This correction
was made before examining the affected paired outcomes. Trial environments
independently rerun the baseline suite with Python 3.9, pytest 7.4.4,
tokenize-rt 5.2.0, setuptools 69.5.1 and wheel 0.46.3.

`scripts/read-range-report.mjs` reports complete strict pairs separately from
excluded and incomplete runs. Repository-suite and independent bug-test outcomes
are retained beside call/token counts. Conflicting agent test edits reject the
host oracle rather than silently weakening it. In particular, a lower call count
with **no automatic retry** is sampling variation, not evidence of program savings.

```sh
node scripts/read-range-integration.mjs
node --test test/read-range-tool.test.js test/dataset-oracle.test.js test/swe-runner.test.js
# Requires a private, preflighted task catalog and an unused allocation guard:
node --env-file=.env.anthropic src/read-range-trial.js /path/to/preflight
node scripts/read-range-report.mjs data/experiments/read-range-live-v1
```

### Estimating potential savings across the public sample

`scripts/estimate-trace-savings.py` reruns the three native-harness miners and
counts compatible whole assistant turns, not arbitrary tool calls. Four programs
cover unique-file navigation, unique-line navigation, range repair and write/run.
It rejects multiple-action turns, missing results, overlapping target turns and
chains depending on an already removed source turn. Future actions are replay
labels; planners use only prior observations. Seven fixture checks pass.

Across 300 trajectories / 11,525 assistant turns, the strict scenario finds
34 exact action-only matches (0.30%). A broader scenario finds 572 (4.96%):
39 file opens, 22 line navigations, 42 range repairs and 469 write/run actions.
The latter assumes accompanying reasoning is dispensable on 530 turns and
script execution is explicitly enabled. Neither scenario establishes live savings.

No per-call usage fields are present in this normalized sample. Using tiktoken
0.12.0 with `cl100k_base` on visible payloads gives a gross reference-token proxy:

| Scenario | Removed visible output | Skipped-request input | Total |
| --- | ---: | ---: | ---: |
| Strict | 1,491 | 1,020,102 | 1,021,593 |
| Broader assumptions | 20,369 | 6,957,955 | 6,978,324 |

These totals are 0.42% and 2.87% of the full-history corpus token proxy. Input
counts assume all visible preceding messages and available schemas are sent on
every request; compaction, caching, provider tokenizers, framing and hidden
reasoning are unknown. No downstream context-shortening benefit is compounded.
Tool results still go to the model and are not counted as removed output.
Router/discovery overhead, false-positive costs and changed trajectories are not
modeled. These are conditional gross opportunity estimates, not statistical
bounds, invoiced savings or held-out results. Other local programs receive no
credit on incompatible native harness tools.

```sh
python3 scripts/estimate-trace-savings.py --help
python3 scripts/estimate-trace-savings-test.py
```

[Public aggregate and method](../../docs/trace-savings-estimate.json) include
source/planner hashes; private per-event evidence remains outside the repository.

The trial finished all 36 scheduled attempts with 317 provider requests and
$16.472624 conservative usage, below its allocation. **No automatic repair
triggered in any run**, so it demonstrates no causal call savings. Three strict
primary pairs on issue 890 passed both checks in both arms: baseline 25 calls /
108,769 tokens; treatment 28 calls / 139,428 tokens. With zero triggers these
differences are sampling variation. The primary run state completed cleanly for
19/36 attempts; other attempts retain their inference/evaluation failures.

A separate post-hoc evaluation repair, `scripts/read-range-oracle-recheck.mjs`,
verifies test-patch conflicts and evaluates only the retained non-test fix against
identical dataset tests. Ten such fixes passed; six submissions already passed
the original oracle. One strict run did not finish inference cleanly and another
failed its original bug test. Supplemental checks do not replace the primary
results or validate omitted agent test edits. The runtime and original manifests
remain unchanged. [Public result](../../docs/read-range-live-summary.json).

### Full traces with recorded per-call usage

A separate sample downloads 50 Sonnet 4.5 and 50 GPT-5.2 mini-SWE-agent v2
trajectories from the official SWE-bench experiment submissions. Selection uses
repository round-robin and a fixed hash order within repository, without consulting
outcomes. The two model cohorts cover the same 50 issues across 12 repositories;
they are not 100 independent issues. Sources are pinned to experiments revision
`40f164d5b8f1d249bf95a6df8b74b577fd8e519d`; individual S3 files have private
SHA256/ETag provenance. About 44 MB of raw files remain on the external volume.

All 4,367 recorded responses carry usage: 92,192,158 input and 1,457,977 output
tokens, with cache/reasoning detail and recorded costs. One Sonnet trajectory
reports an additional API call whose response is missing; no usage is imputed.
Cached input is a subset of the normalized input total, not added again.

`scripts/estimate-recorded-usage.py` preserves native Responses objects as a
single call even when they contain multiple tool calls. It tests the unchanged
mini write/run planner and counts only singleton whole-response matches with
observed tool results. The current frozen policy produces zero supported
proposals in this official sample. The adapter recognizes all 4,826 native bash
actions; 494 cat/heredoc actions fall outside the frozen shell grammar or path
policy. Zero matches therefore do not establish that the workflow pattern is
absent. This is a portability/coverage result, not a
reason to transfer discovery savings to newer harnesses. Other native-harness
programs are not silently applied to these bash-tool traces. Provider usage makes
matched-call token accounting more precise, but removing a call still requires
live task-quality validation.

[Source summary](../../docs/usage-traces-summary.json) ·
[Recorded-usage replay](../../docs/recorded-usage-estimate.json)

### New candidate programs on the recorded-usage sample

One mining agent developed each candidate. These are inert planners with refusal
checks and replay estimates; no recorded shell command is executed. They use the
100 official mini-SWE-agent traces above (4,367 responses, 50 distinct issues).
A separate accounting script verifies every credited event against the original
response usage and deduplicates target calls and adjacent dependent replacements.
Per-program token counts are gross conditional opportunities, not net savings.

| Candidate | Proposals | Whole-response matches | Recorded tokens in matched calls |
| --- | ---: | ---: | ---: |
| Explicit script write/run v2 | 68 | 36 | 494,149 |
| Unique search hit → fixed context | 57 | 0 exact | 0 exact |
| Previously passing test → rerun after edit | 0 | 0 | 0 |

**Write/run v2** supports a single quoted Python heredoc with either redirection
order and an optional bounded `cd` prefix. It predicts a registered interpreter,
exact file path and working directory before inspecting the next response. A
future executor would require explicit run-after-write intent, an unchanged file
hash and bounded execution. Thirty-six whole singleton responses match across
11 issues, all Sonnet; the GPT cohort has one proposal and no match. The matched
calls contain 491,291 input and 2,858 output tokens. There are 32 unmatched
proposals (28 different actions and four multi-tool responses), so unconditional
execution after every script write would be unjustified. All matched responses
contain reasoning/prose. Their observed script exits (24 zero, 12 nonzero) do not
measure bug-fix quality.

Issue-grouped partitioning keeps both model runs for an issue together. The
write/run development partition has 17 matches / 210,358 tokens; the within-round
validation partition has 19 / 283,791. The corpus was sampled and inspected in
prior work, so this is not untouched external validation. Nine planner fixtures
cover parsing, refusal, working directories, early delimiters and multi-tool
exclusion. The original frozen planner and its zero-match report remain unchanged.

**Search/context v2** fixes a ±100-line window around a unique line hit or the
first 200 lines of a uniquely identified file. It produces 57 proposals and no
exact next-range matches. Twenty-nine next singleton reads fall inside its
proposed wider context, across 16 issues: 542,810 input + 1,866 output tokens.
This is a separate coverage scenario, not equivalent output. Extra-context costs,
byte-cap feasibility, file stability and task quality are unmeasured; these
544,676 tokens are excluded from the exact-match total. Eight fixtures pass.

**Passing-test rerun v2** recognizes 57 bounded source edits and 138 registered
standalone/inline test shapes, including 91 successful tests. Fifty-six source
edits have no recognized test in the previous 12 responses; the remaining edit
follows a failing test, so the success gate abstains. Zero proposals earn zero
savings credit. Coverage limitations are reported rather than hidden.

The exact-match union is 36 calls (0.824% of responses) and 494,149 tokens
(0.528% of recorded tokens), with no overlaps. Of the input, 467,821 tokens were
cache reads and 23,336 cache creation; these are already included, never added
again. Source-reported cost sums to about $0.2711, illustrating why a token
reduction need not produce a proportional cost reduction. Router costs, false
positives, reasoning loss and future cache behavior still need live measurement.

```sh
python3 scripts/candidate-write-run-v2-test.py
python3 scripts/candidate-search-read-v2-test.py
python3 scripts/candidate-rerun-v2-test.py
python3 scripts/aggregate-candidate-estimates-test.py
# Every candidate CLI accepts --manifest, --public and --private paths.
python3 scripts/aggregate-candidate-estimates.py --help
```

[Per-program accounting](../../docs/candidate-estimates.json) ·
[Write/run](../../docs/candidate-write-run-v2.json) ·
[Search/context](../../docs/candidate-search-read-v2.json) ·
[Test rerun](../../docs/candidate-rerun-v2.json)

The separate failed-regression rerun variant also yields zero proposals. It
requires exit code 1 and assertion-failure evidence; the sole preceding failure
is an Astropy import/setup error, which is rejected. Five variant fixtures pass
alongside eight original rerun fixtures. Both policies remain separate in the
[aggregate report](../../docs/candidate-estimates.json).

### Batch classifiers across thousands of trajectories

The expanded corpus contains 2,498 usable official mini-SWE-agent v2 trajectories:
500 each for Sonnet 4.5, GPT-5.2, DeepSeek V3.2 and Opus 4.5, and 498 Gemini
3 Flash trajectories. These are 500 distinct issues across 12 repositories, not
2,498 independent issues. About 1.67 GB is stored on the external volume. Two
empty Gemini artifacts are excluded. All 129,846 stored responses have usage and
cost metadata: 3,201,225,688 input + 42,377,608 output tokens. Source counters
report another 589 attempts without response records; their usage is not imputed.

`scripts/download-official-traces.py` downloads the pinned sources concurrently,
resumes verified files and caps planned bytes at 2 GB. The private manifest records
per-file SHA256/ETag and source URLs; only aggregates are published.
`scripts/trace_batch_core.py` performs linear message normalization, scopes tool
results to their preceding response IDs, and preserves a multi-tool response as
one model call. It matches the original normalizer on the original 100 files and
additional source samples. Unsupported accounting formats fail explicitly.

`scripts/batch-program-replay.py` runs the four unchanged program planners with a
bounded process pool. Decisions use current/prior observations; the next recorded
response is a label only. This is deterministic eligibility classification and
argument planning, not learned-router inference. No recorded command is executed.
Only singleton whole-response matches receive usage credit. The SQLite cache is
keyed by source checksum, cohort and selected program-bundle/source hashes. A code
change invalidates the bundle; cache hits still recheck the source bytes. Each
completed trace commits independently, making interrupted runs resumable. Errors
are reported separately from valid zero-opportunity traces. Source size and worker
counts are bounded; `--program` selects one classifier and `--limit` supports small
checks. All scripts use Python 3.9+ standard library only.

| Program | Proposals | Exact matches | Recorded tokens in matched calls |
| --- | ---: | ---: | ---: |
| Write/run v2 | 2,238 | 438 | 7,017,304 |
| Previously passing test rerun | 92 | 18 | 445,040 |
| Search/context v2 | 3,572 | 3 | 14,128 |
| Failed assertion rerun | 3 | 0 | 0 |

The exact union has 459 calls across 179 issues, 7,476,472 tokens and $3.5179 in
historical source-reported cost. No exact targets overlap. Search/context also has
1,695 wider-read coverage opportunities / 35,971,774 recorded tokens, excluded
from the exact union because additional context costs and byte-cap feasibility
are unknown. Proposal-match rates are descriptive: unmatched proposals could
change the workflow, and all matching calls may contain needed reasoning.
Execution opt-in and filesystem state checks remain unverified in replay.

The larger corpus includes the original discovery sample. Grouping by issue,
450 issues / 2,248 trajectories lie outside its 50 issues; this subset contributes
409 exact matches / 6,668,645 tokens. This is issue-disjoint from that specified
sample, not a claim that all issues were untouched by earlier project research.
Model differences are substantial: write/run matches 339 Sonnet, 95 DeepSeek and
four Opus calls, with none from GPT or Gemini. Passing-test rerun matches 16 Gemini,
one DeepSeek and one Sonnet call. These differences argue for model/harness-aware
eligibility checks rather than assuming one rule generalizes universally.

A complete classification pass took 23.6 seconds with four workers on the local
machine (~5,497 responses/second). A verified cache replay took 4.8 seconds and
reused all 2,498 results. Counts and token usage are identical; floating-point cost
sums agree within the recorded tolerance. These are classifier timings with a warm
filesystem, not a live model latency benchmark. Download time is excluded.
Seven normalizer fixtures, seven batch/cache/error fixtures and four downloader
fixtures pass, including tampered-source and multi-tool checks.

See the [README commands](../../README.md#run-program-classifiers-on-thousands-of-traces),
[source summary](../../docs/usage-traces-scale-summary.json),
[full per-program report](../../docs/scale-replay-summary.json), and
[cache benchmark](../../docs/scale-replay-benchmark.json). Raw trajectories and
cached per-event evidence remain outside the repository. No paid inference was
used to acquire or classify this public corpus.

### Four exploratory programs and percentage gains (round v3)

Four separate agents each developed one new inert program, then replayed it over
all 2,498 trajectories / 129,846 responses. Percentages divide by the full corpus
(3,243,603,296 input/output tokens), not by the number of proposals. A separate
accounting pass verifies each positive event against its original singleton
source/target responses, usage and cost, and compares the prior programs against
their frozen cache entries. No recorded command or paid inference is executed.

| New candidate | Matches / proposals | Call % | Token % | Recorded tokens |
| --- | ---: | ---: | ---: | ---: |
| Syntax check → repository status | 42 / 382 | 0.03235% | 0.03434% | 1,113,702 |
| Source edit → syntax check | 30 / 1,574 | 0.02310% | 0.02927% | 949,349 |
| Unique small-file inspection | 31 / 4,191 | 0.02387% | 0.01027% | 333,263 |
| Missing `rg` → literal `grep` retry | 9 / 11 | 0.00693% | 0.00111% | 36,046 |

**Syntax/status** chooses the fixed `git status --porcelain` operation after a
successful standalone `py_compile` or bounded `compileall -q` invocation on
explicit repository Python files. It never predicts future filenames from the
label, and does not credit redirected or bundled status commands. All 42 matches
are GPT-5.2 calls containing observed reasoning/prose. The match rate is 10.99%,
so automatic status output after every syntax check is not justified by replay.

**Edit/compile** reuses the bounded source-edit detector and derives the Python
filename from the successful edit, then predicts `python -m py_compile` on that
file. Multi-tool, bundled, redirected and alternative compile commands are
excluded. All 30 matches are GPT-5.2; nine contain observed reasoning/prose. Its
1.91% match rate limits the case for broad routing even though coverage is real.
The source edit and filesystem state are not reconstructed or executed.

**Small-file inspection** derives a unique file from a prior search and proposes
a full read only under runtime regular-file, no-symlink, unchanged-state,
16 KB and 250-line checks. Thirty-one next singleton `cat` calls match across
30 issues; the 0.74% match rate is too low for unconditional use. A separate
36-call EOF-equivalent head/sed scenario accounts for 519,026 tokens and is not
added to exact totals. All exact matches contain reasoning/prose. Historical
filesystem guards remain unverified.

**Missing-command repair** requires an exact native exit-127 `rg: command not
found` result, a plain literal pattern and at most four explicit repository file
paths. It predicts a registered `grep` invocation with the same normalized cwd,
pattern, files and line-number flag. Shell bundles, directories, regex translation,
unsupported options and implicit paths abstain. Nine of 11 proposals match, all
GPT-5.2. That 81.8% match rate is the strongest of this round, but only 0.00111%
of corpus tokens are represented. Matching a command is not an output-equivalence
or downstream-quality proof; runtime file/output/state bounds still apply.

The common split is SHA256(`autotoken-v3:` + issue ID) modulo five, with remainder
zero assigned discovery and all model runs for an issue grouped together. Three
agents began initial scans before the common seed was specified. Their initially
inspected issues are also assigned discovery; validation excludes the union.
This prevents exploratory exposure from being mislabeled as validation:

| Candidate | Discovery / validation issues | Validation exact matches |
| --- | ---: | ---: |
| Small-file inspection | 177 / 323 | 23 |
| Syntax/status | 157 / 343 | 32 |
| Missing-command repair | 164 / 336 | 8 |
| Edit/compile | 88 / 412 | 21 |

Rules were fixed before evaluating each remaining subset. These are within-round
partitions of a corpus already used by the project, not untouched external task
validation. Per-model and per-partition token accounting is in each report.

The four new programs add **112 exact matches / 2,432,360 tokens**: 0.08626% of
calls and 0.07499% of tokens. Together with the earlier four, the exact union is
**571 calls / 9,908,832 tokens across 240 issues**: **0.43975% of calls and
0.30549% of tokens**, up from 0.35350% and 0.23050%. No duplicate targets or
adjacent dependent substitutions occur in these positive events. The checker
would remove them if present. This is gross conditional usage, not net savings:
routing overhead, false positives, execution costs, reasoning loss, task quality
and changed future cache behavior remain unmeasured.

All eight program IDs are registered in `scripts/batch-program-replay.py` and can
be selected individually with `--program`. Its outputs agree with the independent
per-program/accounting pass. A fresh classifier-cache pass took 29.4 seconds with
four workers; a verified cached replay took 5.2 seconds and produced identical
counts/token totals. The four new planners pass 28 fixtures, accounting passes
three, and the updated batch/cache suite passes eight. Source hashes are pinned
in the public batch report; only test fixtures and aggregates are published.

[Percentage/overlap audit](../../docs/program-round-v3-summary.json) ·
[Eight-program batch](../../docs/program-round-v3-batch.json) ·
[Timing check](../../docs/program-round-v3-benchmark.json) ·
[Small-file program](../../docs/candidate-inspect-file-v3.json) ·
[Syntax/status](../../docs/candidate-diff-check-v3.json) ·
[Edit/compile](../../docs/candidate-edit-compile-v3.json) ·
[Missing-command repair](../../docs/candidate-command-repair-v3.json)

### Read continuation, traceback context and edited-file review (round v4)

Three separate agents each developed one new inert program on the same corpus.
The shared discovery split was specified before work began:
SHA256(`autotoken-v4:` + issue ID) modulo five equals zero. All models for an issue
stay together: 97 discovery issues and 403 within-round validation issues. Rules
were frozen before evaluating validation. This remains a reused research corpus,
not untouched external task-quality evaluation.

| Candidate | Proposals | Exact matches | Call % | Token % | Recorded tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bounded read continuation | 12,335 | 38 | 0.02927% | 0.01598% | 518,334 |
| Edited-file diff review | 1,574 | 4 | 0.00308% | 0.00376% | 121,960 |
| Deepest traceback source context | 862 | 0 | 0% | 0% | 0 |

**Read continuation** detects a fully filled bounded Python source window whose
last nonblank line remains indented. It proposes the next 100 lines with a
one-line overlap, once, under registered-repository/regular-file/unchanged-state
and output bounds. Indentation is weak evidence of a cut-off structure, not proof
that more context is wanted. The 38 exact singleton matches span 36 issues; 24
are in validation. Model counts are GPT 20, Sonnet eight, DeepSeek six, Gemini
three and Opus one. Twenty-five matches contain observed reasoning/prose. A
separate 489-call wider-coverage scenario accounts for 12,165,288 tokens; it is
excluded from exact totals and does not account for extra context costs.

**Edited-file review** uses the unchanged bounded source-edit detector, requires
successful completion, derives the filename from that command and proposes
`git diff -- <file>`. It canonicalizes harmless quotation, an optional `--` and
trailing newline, but not bundles, redirects, partial/windowed output, full-repo
reviews or additional filenames. Four exact calls match across four issues;
three are in validation. They are two Gemini, one GPT and one Opus call, all with
observed reasoning/prose. The runtime must disable external diff/textconv and
verify repository/file state; historical commands are not executed.

**Traceback context** accepts one failed Python traceback, excludes import/setup
failures and test/reproduction paths, chooses the deepest repository source frame
and proposes fixed ±50-line context (101 lines), bounded to 16 KB. No next read
matches that exact range. Fifty-one next reads fall inside the wider proposed
context (41 in validation), representing 1,595,165 recorded tokens. These are
coverage opportunities, not equivalent output or net savings; historical file
contents and output-cap feasibility are unverified.

Exact proposal match rates are only 0.308% for continuation and 0.254% for diff
review. These weak eligibility signals do not justify broad automatic routing.
They add **42 matches / 640,294 tokens**: 0.03235% of corpus calls and 0.01974%
of corpus tokens. The independently checked 11-program union is **613 calls /
10,549,126 tokens**, or **0.47210% of calls / 0.32523% of tokens**, up from
0.43975% / 0.30549%. No duplicate or adjacent-dependent targets occur in the exact
union. Wider-coverage counts are not combined with it.

All 11 classifiers are registered in the same batch runner. Its full-corpus
results agree with the independently audited per-program reports. Classification
took 32.5 seconds with four workers; a source-checksummed cache replay took
4.9 seconds and retained identical call/token totals. The three new planners
pass 22 fixtures; the existing eight batch/cache checks pass. No paid inference
or recorded commands were executed. These remain gross counterfactual usage
estimates before routing/execution/false-positive costs or downstream task effects.

[Percentage and overlap audit](../../docs/program-round-v4-summary.json) ·
[Full 11-program batch](../../docs/program-round-v4-batch.json) ·
[Read continuation](../../docs/candidate-read-continuation-v4.json) ·
[Edited-file review](../../docs/candidate-patch-review-v4.json) ·
[Traceback context](../../docs/candidate-traceback-context-v4.json)

### Error recovery and explicit completion checks (round v5)

Four separate agents evaluated one program each on the same 2,498 trajectories.
Discovery was fixed up front as SHA256(`autotoken-v5:` + issue ID) modulo five
equals zero: 110 discovery issues and 390 within-round validation issues, grouped
across models. Policies were frozen before validation; this is still a reused
research corpus. No recorded commands or paid inference were executed.

| Candidate | Proposals | Eligible exact matches | Recorded tokens | Corpus token % |
| --- | ---: | ---: | ---: | ---: |
| Empty-search parent-scope fallback | 784 | 14 | 396,689 | 0.01223% |
| Missing pytest → module retry | 106 | 0 | 0 | 0% |
| History-bound missing-path repair | 0 | 0 | 0 | 0% |
| Explicit finish-after-verification | 0 | 0 | 0 | 0% |

**Empty-search fallback** requires native exit 1 with empty output from a plain
literal `grep` over one explicit repository file. It predicts fixed recursive
search of that file's immediate parent, preserving the pattern, with no line
numbers. Root-wide search, changed queries, regex rewrites, bundles and unsupported
options abstain. Future execution must enforce registered-tree/no-symlink limits,
1,000 files, 8 MB total input, 16 KB output and a five-second timeout. Historical
bounds are unverified. Fourteen whole calls match across 13 issues (13 Gemini,
one DeepSeek), all containing observed reasoning/prose. The match rate is only
1.79%. Nine validation matches account for 280,851 tokens; discovery has five.

**Missing pytest** accepts an exact native exit-127 executable-not-found error
and a bounded standalone invocation with explicit test targets. Its fixed retry
uses registered `python3 -m pytest` with the same arguments and working directory,
without installation or option/target guessing. Twelve observed next commands
match that retry, but all twelve report that the pytest module is missing. They
fail the program's runtime-result guard and receive no eligible repair credit.
The remaining 94 next commands differ. An unavailable module is an environment
problem, not a repaired invocation; those failed retries are recorded separately.

**Path repair** preserves a failed `cat`/`head`/`sed` operation and range while
looking for exactly one previously observed successful same-basename path. It
uses the prior 12 responses and supported file listings, never future filenames,
spelling guesses or new searches. There are 29 supported native failed reads,
but none has the necessary unique historical alternative, so no proposal qualifies.

**Explicit completion** is a hypothetical opt-in scenario, not a default
termination rule. It requires an exact registered pytest command with a positive
passed-count summary, subsequent successful full-tree `git diff --check`, only
supported read-only operations in the recent history, unchanged tree/environment,
and registered handling of staged/untracked changes. Historical opt-in and test
registration are absent; deployment credit is always zero. Of 40 diff-check-like
turns, seven have supported passing full-tree checks, but none also has the
required recent trustworthy test evidence. No proposal qualifies. Passing tests
alone never implies completion, and final prose is not a native submission match.

The four candidates add **14 eligible calls / 396,689 tokens**, or 0.01078% of
recorded calls and 0.01223% of recorded tokens. After duplicate/dependency checks,
the 15-program union is **627 calls / 10,945,815 tokens**: **0.48288% of calls /
0.33746% of tokens**, up from 0.47210% / 0.32523%. No new overlap was found. These
are gross counterfactual usage estimates, before execution, routing, false-positive
costs, reasoning loss and task-quality effects. This round provides little new
coverage and does not justify broad routing.

All 15 program IDs are registered in the batch runner. Full-corpus batch counts
and token totals match the independent per-program accounting. A fresh
classification pass took 29.1 seconds with four workers; a checksum-verified
cached replay took 5.9 seconds with identical call/token totals. Timing differences
between rounds are single-machine observations, not comparative performance
claims. The four new planners pass 29 fixtures; the eight batch/cache fixtures
also pass. Raw event evidence stays private; only code and aggregates are published.

[Percentage/overlap audit](../../docs/program-round-v5-summary.json) ·
[Full 15-program batch](../../docs/program-round-v5-batch.json) ·
[Empty-search fallback](../../docs/candidate-empty-search-v5.json) ·
[Pytest retry](../../docs/candidate-pytest-repair-v5.json) ·
[Path repair](../../docs/candidate-path-repair-v5.json) ·
[Completion scenario](../../docs/candidate-finalize-v5.json)
