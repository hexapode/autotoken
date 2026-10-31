# Record Pi trajectories

This integration uses Pi's `openai-responses` provider protocol with `gpt-6.1-sol` at medium reasoning with a separate record-only server on port 3001. It does not use the toy `/query` API, invoke a decision model, generate programs, or substitute actions. Pi continues to execute tools itself.

The proxy forwards the original JSON body, including tool definitions, assistant tool calls, tool results, sampling options, and reasoning options. It relays response body bytes, status, and end-to-end headers, including streaming SSE and upstream error responses. It does not retry, select a different model, or inject usage options. Hop-by-hop headers are removed; the local credential is replaced by the upstream bearer key; `X-M2C-*` labels are recorded locally and removed upstream. It supports **POST `/v1/responses` and `/v1/chat/completions`**. Anthropic Messages, WebSocket sessions, Responses retrieval/deletion endpoints, and subscription/OAuth flows are not supported. Configure Pi to use SSE.

## Start the proxy

In the project root, copy `.env.example` to `.env` if needed, then set:

```dotenv
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your-upstream-key
PROXY_TOKEN=your-separate-local-token
PROXY_PORT=3001
TRACE_DIR=./data/trajectories
```

```sh
npm run proxy
```

`DEMO_MODE` and the three model names used by the toy prototype do not control this server. The model ID in each Pi request is forwarded unchanged. The proxy also accepts an existing `OPENAI_API_KEY` when `LLM_API_KEY` is unset. Keep `.env` private. The server binds to loopback and requires the local token for generation. `/health` is public and exposes no traces.

## Configure Pi

Pi 1.4.0 is pinned as a project development dependency. Run `npm ci --ignore-scripts` to install the locked dependencies, then use `npx --no-install pi` wherever this guide says `pi`. A global installation is not required. The proxy itself still has no runtime dependencies. The installed Pi dependency tree currently has npm audit advisories (two moderate and one high); it is used here for isolated read-only smoke tests, and should be reviewed before running it on untrusted benchmark repositories.

Keep an isolated Pi agent directory for this experiment instead of replacing your normal configuration. Run these commands from the project root:

```sh
mkdir -p data/pi-agent
cp examples/pi/models.json data/pi-agent/models.json
cp examples/pi/settings.json data/pi-agent/settings.json
export PI_CODING_AGENT_DIR="$PWD/data/pi-agent"
```

The example selects `gpt-6.1-sol`, medium reasoning, and SSE transport, with retries disabled. It caps output at 16,384 tokens per call; the live smoke runner uses a smaller 4,096-token cap. Keep context, output, reasoning, and retry settings identical between baseline and proxy benchmark conditions. Pricing metadata reflects standard short-context rates and is not a billing guarantee. [Model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

Export the **same local token** configured in the proxy and give this run explicit labels:

```sh
export PROXY_TOKEN='your-separate-local-token'
export M2C_RUN_ID='pi-smoke-001'
export M2C_INSTANCE_ID='manual-smoke'
export M2C_SESSION_ID='session-001'
pi --provider model-to-code --model gpt-6.1-sol --thinking medium --tools read --print \
  'Read package.json and tell me the available npm scripts. Do not modify files.'
```

Pi must inherit these environment variables. `npm run proxy` loads `.env` for its own process; it does not export values into the shell running Pi. The local token never goes to the upstream provider. The example uses the current Pi environment-interpolation syntax (`$NAME`); older Pi releases may require different configuration syntax. See [Pi models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), [agent directory](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md), and [CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md).

For each benchmark issue, start a fresh Pi session and set `M2C_INSTANCE_ID` to its SWE-bench instance ID. Use a unique `M2C_SESSION_ID` for each rollout/retry. Do not reuse a conversational session across issues. The proxy does not infer sessions from conversation text. Headers take precedence over optional `M2C_*` defaults on the proxy process.

## Inspect traces

```sh
npm run traces
# Or specify a different trace root:
npm run traces -- /path/to/trajectories
```

Each request creates `data/trajectories/<uuid>/` with:

- `request.json`: the exact request body, including accumulated tool history.
- `response.bin`: raw response bytes (SSE for streaming requests).
- `metadata.json`: run/issue/session IDs, timestamps, time to first body byte, duration, status, recording completeness, usage, and a best-effort reconstruction of assistant text/tool calls.

Do not treat the reconstructed message as a lossless replacement for the raw stream: provider-specific reasoning, signatures, and other fields are retained in `response.bin`, not fully normalized. Responses traces retain completed output items, including reasoning items, and distinguish completed, failed, incomplete, and interrupted streams. Missing usage is unknown, not zero. For streaming Chat Completions, usage generally requires the client to request `stream_options.include_usage`; an interrupted stream may omit final usage. The proxy deliberately does not alter this option. See the [official API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Request bodies are limited to 16 MiB. Each response recording retains up to 64 MiB; bytes beyond the recording cap still reach Pi and the trace is marked truncated. These limits bound per-request buffers, not total disk usage. Compressed response bytes pass through unchanged but do not receive parsed usage analysis. Requests with compressed bodies are rejected. Response capture respects backpressure and adds disk I/O latency. A failed initial trace write prevents dispatch; a mid-response recording failure is marked and forwarding continues. Metadata left `in-progress` indicates an incomplete attempt, such as a process crash.

Traces contain full source excerpts, prompts, and tool output. They are local and git-ignored, but are **not content-redacted**. Authorization and cookie headers are not persisted. Run labels must not contain credentials. There is no automatic trace retention cleanup.

## Verify before a benchmark

```sh
npm test
npm run proxy:smoke
npm run pi:smoke
```

The smoke test starts a local mock upstream and the real proxy, sends two streamed turns with a tool-call/result round-trip, verifies byte-preserving forwarding, and checks recorded usage. It needs no API key and does not execute a tool. It tests sockets, not Pi itself. In environments that prohibit localhost listeners, it reports the restriction and exits nonzero; the unit suite exercises streaming and cancellation with in-memory transports.

`pi:smoke` additionally launches the actual pinned Pi CLI in an isolated temporary workspace with only the `read` tool enabled. A mock provider requests a fixture-file read; the test verifies that Pi executes it and includes the actual file contents in the next request through the proxy. It checks the final streamed response and recorded usage. Startup networking, telemetry, extensions, MCP, skills, context-file discovery, and persisted sessions are disabled. Provider credentials are not passed to the Pi subprocess. This test makes no paid model calls. Both socket and real-Pi mock smoke tests have passed.

The live `gpt-6.1-sol` Responses test has also passed: two calls, a real read-tool round-trip, the correct unseen fixture token, and 1,404 reported total tokens with no stream or upstream errors. This validates connectivity and tool use, not coding-task performance.

To repeat it using `LLM_API_KEY` or `OPENAI_API_KEY`:

```sh
npm run pi:live-smoke
```

This makes paid API calls. It starts and stops its own loopback proxy, uses only a temporary fixture workspace with the read tool, permits at most four upstream requests, caps output at 4,096 tokens per request, and has a three-minute process deadline. Traces and `result.json` are saved in `data/live-smoke/<timestamp>/`. The upstream key stays in the parent proxy process; Pi receives only a temporary local token. The next experiment is collecting discovery trajectories in isolated SWE-bench task environments. The [SWE-bench baseline runner](../../eval/swebench/README.md) now provides task preparation, container tool execution, patch export, and official evaluator integration. Learned action substitution is not implemented yet. Pi running inside a container cannot reach the host's loopback address as its own localhost; run the proxy in the same network namespace for this initial integration.
