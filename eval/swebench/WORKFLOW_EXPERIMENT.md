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
