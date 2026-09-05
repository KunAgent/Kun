# Agent Request Observability

> **Current product surface:** Agent Perspective has moved from the right rail
> into the conversation center as **Trace**. New durable records contain compact
> lifecycle metadata and optional content-addressed Prompt Manifests; raw HTTP
> request/response payloads are no longer appended to persistent trace JSONL.
> See [`conversation-trajectory.md`](./conversation-trajectory.md) for the
> current UI, storage, API, and retention contract. The wire-inspection details
> below document the bounded in-memory/legacy schema-v1 compatibility path.

Kun's **Agent Perspective** is a local, thread-scoped HTTP inspector for model requests. It captures the effective request assembled by `CompatModelClient`, each retry or compatibility fallback, the HTTP response, the bounded raw response stream, and Kun's decoded output. The feature is for inspecting a conversation; it is not a runtime/process diagnostics panel and has no provider controls or replay action.

## Framework review

The existing ecosystem is useful, but its standard trace model and Kun's wire-inspection requirement are different layers:

| Project | Strength | Fit for exact Kun HTTP inspection |
| --- | --- | --- |
| [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) | Vendor-neutral GenAI spans, metrics, events, and export | Good metadata/export vocabulary. Standard spans do not promise the literal final HTTP URL, headers, request bytes, or raw SSE frames. |
| [Langfuse](https://langfuse.com/docs/observability/overview) | LLM traces, generations, scores, prompt management, and self-hosting | Good optional trace backend; still needs Kun-specific Fetch-boundary capture for exact wire data. |
| [Arize Phoenix](https://arize.com/docs/phoenix) | OpenTelemetry/OpenInference tracing, evaluation, and a local/self-hosted UI | Good investigation backend and future exporter target; normal semantic instrumentation is not a raw HTTP recorder. |
| [Opik](https://www.comet.com/docs/opik/) | Open-source LLM tracing, evaluation, dashboards, and self-hosting | Good full-trace product; integrating its SDK would not remove the need to capture Kun's retries and raw stream itself. |
| [LangSmith](https://docs.langchain.com/langsmith/observability) | Agent tracing, monitoring, evaluation, OpenTelemetry ingestion | Strong managed/enterprise workflow; not an offline, exact-wire default for the Electron app. |
| [OpenLLMetry](https://github.com/traceloop/openllmetry) | OpenTelemetry auto-instrumentation for common LLM SDKs | Useful when a supported SDK owns the call. Kun uses a custom compatibility client and needs stricter content and credential handling. |
| [Helicone](https://github.com/Helicone/helicone) | Gateway/proxy observability close to the HTTP wire | Can see provider traffic, but making a proxy mandatory changes the request hot path, endpoint, authentication, and deployment model. |
| [BeeAI Agent Stack](https://github.com/i-am-bee/agentstack) | Open-source agent platform and orchestration | Relevant as an agent stack, but not a drop-in per-request wire inspector for Kun's single bundled runtime. |

The implementation therefore captures locally at the existing `fetch` boundary and uses stable fields that can later map to OpenTelemetry GenAI attributes. Kun's existing content-free `AgentObservabilityRecorder` remains the opt-in span/export path; Agent Perspective does not upload sensitive content.

## Capture boundary and coverage

One logical model round may produce multiple HTTP exchange records:

- `initial`: the first provider call.
- `transport_retry`: a retry after a configured transient HTTP status.
- `stream_options_fallback`: a compatibility retry with a changed request body after a provider rejects `stream_options`.

Each record includes:

- thread, turn, provider, model, endpoint format, attempt ordinal, and reason;
- final sanitized request URL, POST headers, and the exact JSON string supplied to `fetch`;
- response status, status text, headers, and bounded raw response text (including SSE framing);
- start, time-to-headers, finish, duration, transport/capture errors, and truncation metadata;
- the semantic text, reasoning, tool calls, usage, stop reason, or error decoded by Kun.

Coverage includes model requests routed through `CompatModelClient`, Gemini CLI Code Assist, Claude Agent SDK, Cursor SDK, and Antigravity CLI. Renderer requests, tool traffic, MCP traffic, Work inline completion, scheduled-task detection, and other Electron services are not captured. An empty Agent Perspective panel does not mean that no non-model network traffic occurred.

The recorder never retries, rewrites, replays, or blocks a provider request because capture failed. It serializes each request body once, observes a cloned response, and isolates recorder failures from the agent-visible result.

## Capture policy

The Agent Perspective header owns a persistent capture switch for the selected conversation. The switch is off by default; enabling it starts capture at the next model request boundary. Disabling it lets a trace that already started finish, stops later requests from being captured, and keeps existing history readable.

Settings → LLM request troubleshooting includes **Capture new conversations by default**. That setting controls only the initial state of conversations created afterward. Existing conversations, forks, side conversations, and resumed conversations retain independent state and are not rewritten when the setting changes.

The recorder facility remains available by default so a conversation switch can take effect immediately. Advanced installations can disable the facility entirely in Kun runtime configuration:

```yaml
runtime:
  llmDebug:
    enabled: false
```

Changing the effective `runtime.llmDebug.enabled` value through runtime config apply returns `restart_required`; restart Kun to apply that advanced facility policy. Changing only `runtime.llmDebug.defaultThreadCaptureEnabled` hot-applies to later runtime-created conversations.

Capture is not retroactive. Requests that start while the conversation switch or recorder facility is disabled cannot be reconstructed, while trace files written earlier remain readable after restart.

## Security and local storage

Legacy schema-v1 completed exchange records were append-only JSONL files at:

```text
<Kun dataDir>/observability/model-http/<base64url-thread-id>.jsonl
```

The observability directory is forced to mode `0700` and trace files to `0600`. Active attempts live only in bounded runtime memory and are merged with completed records when queried. Deleting a conversation waits for its lifecycle fence and deletes its trace file. Malformed JSONL lines are ignored with a warning so an interrupted final append does not make the inspector unusable.

Credential values are removed **before** a record enters memory or storage:

- URL user info is stripped.
- Query values whose names imply keys, tokens, secrets, signatures, authentication, passwords, credentials, or cookies become `[REDACTED]`.
- authorization, API-key, token, secret, cookie, signature, and similar request/response header values become `[REDACTED]`.
- A configured API key is also redacted if it appears in another header value.

Header names are retained so request construction remains diagnosable. Request and response **bodies are intentionally not redacted**, because prompts and provider output are the data the inspector exists to show. Treat the trace directory as sensitive user data; do not attach it to an issue without reviewing its bodies.

The default in-memory capture limit is 4 MiB for each request body and each response body. New durable trajectory records omit these bodies and retain optional prompt detail through the bounded content-addressed store. Legacy JSONL remains readable and follows its existing retention policy.

## API

The renderer reads traces through the authenticated runtime route:

```http
GET /v1/threads/{threadId}/model-requests?limit=30&cursor=<opaque>
Authorization: Bearer <runtime-token>
```

The route first verifies that the thread exists, then returns newest-first records, an optional opaque cursor, active count, capture limits, schema version, and storage warnings. The capture switch uses the existing thread metadata contract:

```http
PATCH /v1/threads/{threadId}
Content-Type: application/json

{"modelRequestCaptureEnabled":true}
```

Both paths are exposed through the constrained `window.kunGui.runtimeRequest` allowlist. There is no trace write or replay endpoint.

## Using Agent Perspective

1. Open or select a Code conversation.
2. Select **Agent Perspective** (the scan/perspective icon) in the right rail.
3. Turn on **Capture** in the panel header before sending the request you want to inspect.
4. Pick an attempt in the left request timeline.
5. Use **Overview**, **Request**, **Response**, and **Decoded** to compare the provider wire data with Kun's parsed result.
6. Switch between formatted JSON and raw text where available. Copy actions copy only the already-sanitized DTO shown by the panel.
7. Use **Load older requests** to page backward. While the panel is visible and the thread runs, it refreshes once per second and performs one final refresh when the turn settles.

Useful diagnosis patterns:

- `404` or wrong path: compare **Final request URL** with provider Base URL and Endpoint format settings.
- Provider rejects a field: compare the initial and `stream_options` fallback request bodies.
- A retry changes the outcome: compare status, response body, timing, and attempt reason across records.
- UI output differs from provider output: compare **Raw response** with **Decoded**.
- Missing early data: confirm the conversation switch was enabled before the request began; earlier requests are not reconstructed.
- Capture unavailable: confirm `runtime.llmDebug.enabled` is not explicitly `false`, then restart Kun after changing the setting.

## Validation targets

Focused coverage lives in:

- `kun/src/services/model-request-trace-safety.test.ts`
- `kun/src/services/model-request-trace-store.test.ts`
- `kun/src/adapters/model/compat-model-client.observability.test.ts`
- `kun/src/server/routes/model-requests.test.ts`
- `src/renderer/src/agent/model-request-traces.test.ts`
- `src/renderer/src/components/workbench/useModelRequestTraces.test.ts`
- `src/renderer/src/components/workbench/AgentPerspectivePanel.test.ts`

Run the focused suites first, followed by top-level typecheck, `build:kun`, and the production build.
