# Autotoken

Autotoken learns which repeated model tasks can become reusable programs, and when to use them.

**Spot a pattern → write a program → test it → route requests → learn from the outcome.**

1. **Observe:** record requests, context, tool calls, results, and usage through a proxy.
2. **Discover and write:** find recurring procedures and try a program with explicit inputs, outputs, and conditions for use. A small workflow may replace more work than one command.
3. **Test:** check new inputs and separate issues; compare task quality and total cost with the normal model path.
4. **Route:** a decision model chooses an eligible program and validated arguments, or falls back to the main model.
5. **Learn:** use verified outcomes to improve the program catalog and train the router. Incremental updates go to a candidate policy; evaluation comes before promotion.

The goal is this whole loop. Today we have a multi-provider recording proxy, a bounded data-program prototype, coding-workflow experiments, and a shadow decision API with batch and online classifier training. Automatic activation of learned coding workflows is **not** implemented.

The [trace-router experiment](eval/swebench/WORKFLOW_EXPERIMENT.md#trace-trained-router-replay) trains and evaluates routing on recorded coding tasks, using separate issues for testing. It is not yet reliable enough for activation. Replay measures candidate opportunities; it does not demonstrate saved calls or preserved task quality. Detailed methods and results live in the research notes.

The [project website](https://hexapode.github.io/autotoken/) explains the loop and experiments. [Install below](#install), [try the trace router](#train-a-router-on-recorded-coding-runs), or start with [Pi setup](examples/pi/README.md). The [SWE-bench runner](eval/swebench/README.md) supports Docker evaluation and an explicitly separate local pilot with repository tests. Fixed workflow comparisons remain separate from learned routing.

## Install

Node.js 22.19 or later is required. The CLI has no runtime npm dependencies. Install from the public GitHub repository:

```sh
npm install -g github:hexapode/autotoken
autotoken demo
```

The demo is offline and needs no API key. To record real requests:

```sh
autotoken init
# Edit .autotoken.env: set LLM_API_KEY to your provider key.
autotoken proxy --provider openai
```

`init` generates a separate local `PROXY_TOKEN`, writes an owner-only configuration file, and excludes that file and `.autotoken/` recordings from Git. Point your client's base URL at `http://127.0.0.1:3001/v1`, use `PROXY_TOKEN` as its API key, and keep its existing model ID. The upstream provider key stays in the proxy. `autotoken traces .autotoken/traces` summarizes recordings.

### Providers

The recording proxy is model-agnostic. It forwards the client's model ID and request body unchanged, including tools and streamed responses. The API format must match the configured provider; this is not an API translator.

| Provider | Start command | Client API |
| --- | --- | --- |
| OpenAI | `autotoken proxy --provider openai` | Chat Completions or Responses |
| Anthropic | `autotoken proxy --provider anthropic` | Native Messages |
| OpenAI-compatible service | `autotoken proxy --provider compatible --upstream https://YOUR_PROVIDER/v1` | Supported Chat Completions / Responses endpoints |
| Local Ollama | `autotoken proxy --provider ollama` | Ollama's supported OpenAI-compatible endpoints |

Anthropic accepts `ANTHROPIC_API_KEY` or `LLM_API_KEY`; use `http://127.0.0.1:3001` as an Anthropic SDK base URL (the SDK appends `/v1/messages`). OpenAI accepts `OPENAI_API_KEY` or `LLM_API_KEY`. Other hosted compatible services use `LLM_API_KEY`. Local Ollama needs no upstream key, but client authentication still uses the local `PROXY_TOKEN`.

Options include `--env-file PATH`, `--port NUMBER`, and `--trace-dir PATH`; see `autotoken --help`. Each proxy process connects to one upstream. Start separate ports for multiple providers. The native Gemini, Bedrock, Azure deployment-path APIs, realtime WebSockets, uploads and batch APIs are not implemented. Use a compatible endpoint where your provider offers one.

Anthropic authentication, version headers, streamed tool JSON, and cumulative usage are covered by mock transport and real-Pi integration tests. The [Anthropic Messages documentation](https://platform.claude.com/docs/en/api/overview) and [streaming guide](https://platform.claude.com/docs/en/build-with-claude/streaming) define that protocol. Ollama documents its [OpenAI-compatible API](https://docs.ollama.com/api/openai-compatibility); endpoint support varies by provider. Recorded token totals include cached input; they are not invoices.

Installing the proxy enables recording, not automatic substitution. The bounded transformation demo and experimental coding workflows remain separate. Trace files can contain full prompts and source code; keep `.autotoken/` private. No traces are uploaded by Autotoken beyond the original requests sent to your configured model provider.

## Run from source


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

### Train a router on recorded coding runs

The experimental decision service uses the same interface for a local classifier or a model API. It returns **shadow proposals**; it does not replace traffic in the recording proxy. The first replay failed its promotion gate, so automatic activation is deliberately unavailable.

```sh
node src/trajectory-analysis.js data/collections/discovery-25usd data/analysis/discovery-final

autotoken router-replay data/analysis/discovery-final/analysis.json \
  .autotoken/router-experiment data/experiments/workflow-expanded-v2

# PROXY_TOKEN comes from .autotoken.env created by autotoken init.
autotoken router .autotoken/router-experiment/router.json
```

The optional third replay argument supplies separate baseline evaluation runs. Replay generates `report.json`, a restricted `patch-review.js` program, `router.json` (batch-trained), and `online-router.json` (one training pass). Splits are by issue, before fitting. Evaluation labels never update weights. No paid API calls occur during replay.

The local-only service defaults to port 3002. Authenticate with `Authorization: Bearer YOUR_LOCAL_PROXY_TOKEN`:

- `POST /decision`: `{ "issueId": "your-issue", "context": { "ordinal": 1, "history": [] } }`. Each history item contains earlier `actions: [{command, result}]`. Never include the target response. The result includes `requestId`, `shadowDecision`, and a proposed tool action; its effective route remains `model`.
- `POST /outcomes`: `{ "requestId": "returned-id", "evidence": "replay-action-match", "compatible": true }`. Use a recorded action checked against the program's contract, not a model's confidence. This updates and persists a **candidate only**, rejects repeated feedback and known held-out issues, and never changes the serving snapshot. This label measures action compatibility, not task success. Pending IDs expire after 1,000 decisions or a restart.
- `GET /health`: backend and candidate update count.

Set `ROUTER_BACKEND=api`, `ROUTER_PROVIDER=anthropic|openai|compatible`, `ROUTER_MODEL`, the corresponding API key, and optionally `ROUTER_BASE_URL` to try a hosted decision model. This makes paid API calls using that account; it does not share the separate SWE experiment budget. Program IDs and arguments are checked locally, and provider errors or malformed choices fall back. The adapter has mocked provider tests; the replay above evaluates local classifiers, not hosted routing accuracy.

Every accepted decision/outcome is logged privately under `.autotoken/router/`. Candidate updates are saved in `candidate.json`; restarting with that file evaluates its weights as a new shadow snapshot. Keep raw traces and keys out of version control. See [the replay protocol](eval/swebench/WORKFLOW_EXPERIMENT.md#trace-trained-router-replay) for results and limits.


To replay multiple trace collections together, use issue-grouped cross-validation:

```sh
autotoken router-corpus .autotoken/corpus-replay PATH_TO_COLLECTION PATH_TO_ANOTHER_TRIAL
```

All providers, repetitions, and approaches for the same issue stay in one fold. Baseline runs train and calibrate the router; intervention runs are scored separately. Completed runs are snapshotted, duplicate trace IDs removed, and unfinished/failed runs listed in the exclusion audit. Outputs stay local; use a new output directory for each replay. To reproduce a frozen snapshot, run `autotoken router-corpus NEW_OUTPUT --snapshot PREVIOUS_OUTPUT/snapshot.json`. This simulates routing and program proposals, not downstream execution or realized savings.


For higher-throughput coding trace collection, the source-only [fast collection runner](src/fast-collect.js) supports up to 12 workers with one shared budget. It reuses pristine Git objects and checksum-verified public fixtures while preserving fresh checkouts and test evaluation. Its current inventory and allocation rules are specific to this experiment; see the [collection protocol](eval/swebench/WORKFLOW_EXPERIMENT.md#faster-opus-discovery-collection).
