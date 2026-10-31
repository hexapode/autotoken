# Autotoken

A local experiment in replacing repeated LLM work with deterministic programs. General requests go through the proxy; the learner discovers recurring data transformations, proposes bounded programs, and evaluates them in shadow mode. A decision model selects a registered program or abstains.

For the coding-agent experiment, a separate **Pi recording proxy** now preserves Responses API and Chat Completions requests, tool calls/results, streamed responses, and per-request traces. Start with [Pi setup and verification](examples/pi/README.md). This path is record-only. The [SWE-bench baseline runner](eval/swebench/README.md) supports isolated Docker tasks with official evaluation and an explicit Docker-free local pilot with repository tests. Both export patches and traces; learned action substitution is not yet implemented. A resumable `swe:collect` runner supports larger discovery collections with per-request budget accounting; see the [collection instructions](eval/swebench/README.md#larger-discovery-collection).

Public project: [hexapode/autotoken](https://github.com/hexapode/autotoken). The static explainer lives in [`docs/index.html`](docs/index.html).

An [exploratory workflow comparison](eval/swebench/WORKFLOW_EXPERIMENT.md) tests automatic validation against single-check and baseline arms on independent issues. This intervention is confined to the experiment.

## Run

The core proxy requires Node.js 22+; no package installation is needed for its runtime or unit tests. The optional real-Pi integration test uses the pinned development dependency (`npm ci --ignore-scripts`) and requires Node.js 22.19+.

```sh
npm test
npm run demo
cp .env.example .env
npm start
```

The demo uses **scripted fixtures, not actual learning or model inference**. It walks through observation → discovery → shadow evaluation → explicit promotion → program response → fallback. Its state is written to a fresh temporary directory. The server uses `./data` by default and binds only to `127.0.0.1`.

For real models, set `DEMO_MODE=false`, `LLM_API_KEY`, and `ANSWER_MODEL`, `ROUTER_MODEL`, `LEARNER_MODEL` in `.env`. Use model IDs available from your provider. Set `LLM_BASE_URL` to a chat-completions API base URL ending in `/v1`. The router and learner require JSON object response mode. The adapter follows the [official Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Provider compatibility is tested with mocked HTTP responses; live inference requires your credentials.

## Send requests

```sh
curl http://127.0.0.1:3000/query \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Sort these numbers ascending","data":[9,2,1]}'
```

`prompt` is natural-language intent. Optional `data` is the exact input available to deterministic programs. Programs return JSON values serialized as text in `answer`. The response includes route, decision, program ID, model usage when supplied by the provider, shadow comparison, and latency.

General questions without data also work, via the upstream answer model. This first version only automates requests with explicit data: it does not yet safely extract arbitrary program inputs from free-form prose.

A limited `/v1/chat/completions` endpoint accepts plain-text messages and non-streaming output. Ordinary conversations preserve all messages and go to the answer model. To opt into program routing, send exactly one user message whose content is a JSON string containing `{"prompt":"...","data":...}`. The configured answer model is used; the incoming `model` field is accepted as a compatibility alias. Unsupported generation options, tool calls, multimodal inputs, and streaming are rejected rather than silently dropped.

## Discover and activate

Record at least three differently worded requests for the same operation. In demo mode these work:

```sh
curl localhost:3000/query -H 'Content-Type: application/json' -d '{"prompt":"Sort these numbers ascending","data":[9,2,1]}'
curl localhost:3000/query -H 'Content-Type: application/json' -d '{"prompt":"Order numbers ascending","data":[10,2,1]}'
curl localhost:3000/query -H 'Content-Type: application/json' -d '{"prompt":"Sort numbers from smallest to largest","data":[11,2,1]}'
curl localhost:3000/learn -X POST -H 'Content-Type: application/json' -d '{}'
curl localhost:3000/programs
```

Discovery inspects the last 60 eligible model-served requests and proposes up to three programs per pass. You can set `LEARN_EVERY=20` to launch discovery in the background after every 20 successful requests. Overlapping discovery passes are prevented within the server process.

Candidates must pass at least three distinct positive tests, a rejection test, and replay against three distinct observed prompts. All accepted programs start in **shadow**: the proxy serves the model answer and compares it with program output using exact parsed JSON equality. Formatting differences in JSON do not count as disagreement; prose and fenced JSON do.

After discovery, send new data to collect shadow evidence:

```sh
curl localhost:3000/query -H 'Content-Type: application/json' -d '{"prompt":"Sort numbers ascending","data":[8,4,5]}'
curl localhost:3000/query -H 'Content-Type: application/json' -d '{"prompt":"Sort numbers ascending","data":[12,-3,0]}'
curl localhost:3000/query -H 'Content-Type: application/json' -d '{"prompt":"Sort numbers ascending","data":[100,10,1]}'
```

Inspect the program, its description, tests, and evidence with `GET /programs`. Use its ID to change status:

```sh
curl localhost:3000/programs/PROGRAM_ID/active -X POST -H 'Content-Type: application/json' -d '{}'
curl localhost:3000/programs/PROGRAM_ID/disabled -X POST -H 'Content-Type: application/json' -d '{}'
curl localhost:3000/stats
```

Activation requires three distinct held-out inputs matching the model and no held-out mismatches in the retained evidence window (100 observations). Discovery inputs and generated test inputs do not count. `/shadow` returns a program to shadow mode. This gate is experimental evidence, **not proof of correctness**: the model is a fallible reference, and generated tests are not independent verification. Promotion remains explicit. Active programs currently do not receive ongoing model audits; return them to shadow mode to collect more evidence.

## Architecture and limits

```text
request → model router → contract + deterministic interpreter → response
                 └─ abstention / error / rejection → answer model

traffic → learner model → program + tests → validation → shadow registry
```

- The learner writes a bounded JSON operation language, not arbitrary JavaScript. Programs compose sort, unique, sum, count, pluck, trim, lower, and upper. They cannot perform I/O or execute generated source. Unsupported task families stay with the model; additional primitives can be implemented and tested later.
- Router selection uses full program descriptions and a confidence threshold of 0.98. This is self-reported model confidence, not a calibrated probability. Input validation cannot prove that the chosen program matches the user's intent.
- The router selects a program only. It cannot change the supplied data. Step parameters are fixed in each generated program, so different fields or sort directions may produce separate programs.
- Program serving avoids an **answer-model call**, not every model call. Routing still costs inference. Shadow requests cost both routing and answering; discovery adds further cost. Usage is recorded, but monetary savings are not claimed or estimated.
- Storage is a local atomic JSON snapshot for one server process. It retains the last 1,000 successful requests, 100 discovery results, and 100 observations per program. Do not run multiple processes against the same directory. This is not production storage.
- Raw prompts, supplied data, and answers are stored locally; discovery sends recent eligible traffic to the configured learner provider. Do not submit sensitive traffic without adding your own redaction and retention policy. `.env` and `data/` are git-ignored. Delete the data directory while the server is stopped to reset the experiment.
- This local API has no authentication; do not expose it publicly. Browser-origin requests are rejected. Request bodies are limited to 100 KB, program inputs to 64 KB, array operations to 2,000 entries, and programs to eight steps.
- No embeddings, trained classifier, arbitrary code sandbox, independent semantic evaluator, cost-based routing, or automatic activation yet. The next useful measurement is held-out routing accuracy across paraphrases and near-miss requests, followed by actual provider cost and latency.

## Files

- `src/server.js`: HTTP API and background discovery trigger.
- `src/engine.js`: routing, fallback, learning, evidence, and lifecycle.
- `src/program.js`: deterministic language, contracts, and candidate tests.
- `src/provider.js`: real model adapter and isolated demo fixtures.
- `src/store.js`: bounded local persistence.
- `test/proxy.test.js`: lifecycle, fallback, execution boundaries, HTTP and adapter tests.

## Repeatable evaluation

Run the bundled benchmark without an API key:

```sh
npm run eval
```

It uses the existing scripted demo provider, so low answer accuracy outside the demo's narrow sorting vocabulary is expected. This mode verifies the evaluation machinery, not actual model quality. Each run writes `report.md`, a detailed `report.json`, and isolated proxy state to a new directory under `data/evals/`. It never touches the running server's registry.

To evaluate real models, configure the three model names and API key in `.env`, then explicitly opt into provider calls:

```sh
npm run eval -- --live
```

`--live` determines the evaluation provider regardless of `DEMO_MODE`. This sends the benchmark requests to your configured provider and incurs its normal usage. A run has 9 discovery requests, one discovery pass, 12 calibration requests, and 20 paired test requests. Routing adds calls when programs exist. No localhost server is required.

Use a custom dataset or output location:

```sh
npm run eval -- --dataset eval/dataset.json --out data/evals/my-experiment
```

The output directory must not already exist, preventing accidental reuse of learned programs or overwriting a previous run. JSON results are checkpointed after each request; the Markdown summary appears when the run finishes.

### Experimental protocol

1. **Discovery:** send only the discovery requests, then run the learner once. Expected answers and labels are never passed to a provider.
2. **Calibration:** collect shadow observations on a separate split. In addition to the engine's promotion gate, reject programs whose calibration outputs disagree with the independent oracle or violate a fallback label. Activate qualifying programs only in this isolated evaluation state; disable the rest.
3. **Held-out test:** freeze the registry. Run each test request through the proxy and independently through the answer model. Alternate which path goes first. Never learn from, tune on, or promote based on these test results during the run.

The fixture contains sorting, sums, uppercase conversion, paraphrases, duplicates, negative numbers, near-miss operations, extra requirements, format changes, subjective requests, invalid input, and routing manipulation. It is a small smoke benchmark; add representative traffic and repeat live runs before drawing conclusions about generalization. If you tune the system against the test results, create a new untouched test split for your next assessment.

### Dataset schema and scoring

`eval/dataset.json` has three nonempty arrays: `discovery`, `calibration`, and `test`. Each case has:

```json
{
  "id": "unique-case-id",
  "category": "sort",
  "automatable": true,
  "request": { "prompt": "Sort numbers ascending", "data": [7, 2, 5] },
  "expected": { "kind": "json", "value": [2, 5, 7] }
}
```

- `automatable: true` means a matching deterministic JSON program could satisfy the request; it does not mean the registry already contains one. Such cases require an exact JSON oracle.
- `automatable: false` means the request must fall back under this prototype's contract. It can use a `text` oracle or `{"kind":"unscored"}` for subjective or invalid-input answers. Unscored answers still participate in routing checks but are excluded from answer accuracy.
- JSON answers use structural equality, including array order. Text answers compare after trimming surrounding whitespace. No semantic judge model is used.
- IDs and full requests must be unique. Input data must not repeat across splits, including objects with reordered keys. The validator rejects contamination before making any model calls.
- Oracles in the fixture are hand-authored literal values, not outputs from the program interpreter or baseline model.

The report includes per-category and overall accuracy, errors, mean/p50/p95 latency (p50 is in JSON), program coverage, incorrect program responses, and fallback violations. An incorrect program response is a program-served answer that either violates a fallback label or fails its oracle. This measures errors that reach the user; it does not claim to identify every semantic routing error or rejected candidate. When no program serves any request, its error rate is `N/A`, not zero.

Usage is separated into setup, proxy test, baseline test, and proxy including setup. All attempted calls, including failed calls, are recorded. Missing provider token usage stays unknown. Dollar savings are not estimated. The provider's latency and caching can vary; alternating execution order does not eliminate those effects.

Exit status is nonzero for operational failures or incorrect program responses. Zero does **not** imply sufficient coverage or answer accuracy: inspect both before accepting a result. No automatic minimum coverage threshold is imposed.

Relevant code: `src/evaluate.js`, `eval/dataset.json`, and `test/evaluate.test.js`.
