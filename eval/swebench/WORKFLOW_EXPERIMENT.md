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
