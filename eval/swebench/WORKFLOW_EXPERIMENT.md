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
