# EdgeOne Makers Agent Review Checklist

> Purpose: when bulk-auditing or refactoring existing templates, walk this list top-to-bottom. Items marked ⚠️ are common foot-guns.

---

## A. Directory Structure

- [ ] `agents/` exists; every AI inference endpoint lives here

- [ ] `agents/_shared.ts` exists (logger + SSE helper)

- [ ] `agents/_model.ts` exists (model name + env mapping)

- [ ] Internal modules are prefixed with `_` (`_shared` `_model` `_tools` `_skills` `_templates`)

- [ ] `cloud-functions/` is separated from `agents/` (data CRUD does not bleed into AI endpoints)

- [ ] ⭐ **No** hand-maintained `.edgeone/agent-node/config.json` (the CLI auto-scans and generates it at build time) — ⚠️ how to tell: check the project root `.gitignore`. If it **contains** `.edgeone`, then a local copy is just a build artifact and is fine; if it **does not**, the whole `.edgeone/` got committed and that is the violation.

- [ ] `.gitignore` covers at least: `node_modules` / `.env` / `.edgeone` / `.next` (or your framework's build-output dir)

- [ ] `.edgeone/project.json` exists (Name + ProjectId)

- [ ] `edgeone.json` sets `agents.framework` (`claude-agent-sdk` / `openai-agents-sdk` / `langgraph` / `crewai` / `deepagents` — **no `basic`**, the schema enum does not include it) — **required for console icon display**

- [ ] Frontend lives under `app/`, components under `app/components/`, global utilities under root `lib/`

---

## B. Entry Point & Signature

- [ ] Every endpoint is `export async function onRequest(context: any)` (or a method-specific variant such as `onRequestPost`)

- [ ] Resources are destructured off `context`; do not import a model SDK and call it directly

- [ ] Request body comes from `context.request.body` (⚠️ not `await req.json()`)

- [ ] ⚠️ Request headers are read by index: `context.request.headers['x-foo']` (plain object, **not** `.get('x-foo')`)

- [ ] Failed input validation returns `400 + JSON`

- [ ] ⚠️ No Vercel-style `app/api/.../route.ts` + `POST()` handlers

---

## C. Environment Variables & Models

- [ ] ⭐ **Inside `agents/` and `cloud-functions/`, `process.env.X` is forbidden — use `context.env.X` exclusively** (the frontend `app/` is not bound by this)

- [ ] ⚠️ No `process.env.X = '...'` **assignment / mutation** (same rule #3 — `process.env` is shared across the process, mutating it pollutes other handlers; pass SDK config through SDK option arguments)

- [ ] Shared internal modules (`_shared.ts` / `_model.ts`) take `env` as a parameter; they do not read global env inside the module

- [ ] Only `AI_GATEWAY_API_KEY` + `AI_GATEWAY_BASE_URL` are recognized (plus optional `AI_GATEWAY_MODEL`)

- [ ] Missing variables raise an explicit error (Path A: `getAgentEnv` / Path B: validation at mapping time)

- [ ] ⚠️ No hard-coded API keys / baseURLs / model names scattered across files

- [ ] Model names are constants (`@makers/deepseek-v4-flash` or routed through `resolveModelName`)

- [ ] Path B: inject via `collectGatewayEnv(context.env)` into `query().options.env`, **not** by reading `process.env`

- [ ] Path A: model instances are cached by baseURL

- [ ] ⭐ Templates that use `context.tools.web_search` / `context.tools.get('web_search')`: the project env has `WSA_API_KEY` configured (otherwise auth fails with 401)

---

## D. SSE Protocol (where consistency tends to slip)

- [ ] Returns `text/event-stream`, in the format `data: <JSON>\n\n`

- [ ] Event `type` uses the unified vocabulary (`ai_response` / `tool_call` / `tool_result` / `usage` / `suggest_actions` / `file_output` / `ping` / `error_message`)

- [ ] Heartbeat: a `ping` every 5 seconds

- [ ] Stream ends with `data: [DONE]\n\n`

- [ ] All four response headers present: `Content-Type` + `Cache-Control:no-cache` + `Connection:keep-alive` + `X-Accel-Buffering:no`

- [ ] ⚠️ Use the shared `createSSEResponse` helper instead of inlining a `ReadableStream` per file

- [ ] A `usage` event (token accounting) is emitted at the end

---

## E. Conversation ID & the /stop Dual Channel

- [ ] ⭐ **Frontend**: every `fetch()` to an AI endpoint (`/chat`, `/outline`, `/create`, and every other endpoint under `agents/`) sends the HTTP header `makers-conversation-id: <uuid>`

- [ ] The frontend `conversation_id` is generated with `crypto.randomUUID()` and persisted in `localStorage` (one ID, used across all AI endpoints)

- [ ] AI endpoints on the backend use `context.conversation_id` directly (runtime injects it from the header automatically)

- [ ] ⚠️ When the frontend calls `/stop`: **never** include the `makers-conversation-id` header (doing so sticky-routes the request to the very chat instance that is stuck). The target conversation_id is passed only via the body as `{ conversation_id }`

- [ ] On the backend, `/stop` reads `request.body.conversation_id` and calls `context.utils.abortActiveRun(conversationId)` (only available in the agent runtime)

- [ ] cloud-function endpoints (`/history`, `/preferences`, etc.): header or body, either is fine — no sticky-routing constraint

- [ ] Claude SDK path: normalize `conversationId` with `normalizeUuid()` to a valid UUID (the SDK session enforces UUID format)

---

## F. Robustness

- [ ] Loops have a hard ceiling (Path A: `for i<N` / Path B: `maxTurns`)

- [ ] `context.request.signal` is observed; `signal?.aborted` is checked inside both the loop and the stream

- [ ] Error classification: AbortError / "terminated" are silenced; everything else is surfaced as `error_message`

- [ ] Tool calls are wrapped in try/catch with a graceful fallback on failure

- [ ] Path A: `stripDSML` is applied to all outgoing text (mandatory for the DeepSeek family)

- [ ] Path A: no text is emitted before search runs (avoids leaking the chain of thought)

- [ ] Path B: `process.stdout` EPIPE is swallowed

- [ ] Path B: sandbox liveness probe retries on cold start

- [ ] Path B: file uploads use a multi-strategy approach, falling back to inline text when the sandbox is unavailable

- [ ] Path B: ⭐ the sandbox `/tmp/` directory is easily lost across requests → use an in-process `Map` file cache plus re-upload on every request

- [ ] Path B: the system prompt explicitly forbids the AI from fabricating files when it sees `FileNotFoundError`

---

## G. Sandbox / Tools

- [ ] Use `context.sandbox` / `context.tools` directly; **no** hand-rolled `/v1/sandbox/*` calls or manual token parsing

- [ ] The template `.env` does **not** ask the user to fill in sandbox credentials / PROJECT_ID / SANDBOX_API_BASE / API_ENV

- [ ] ⭐ Claude SDK templates wire tools via `context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true })` (recommended) or feed `context.tools.all()` into `createSdkMcpServer`

- [ ] `files()` / `browser()` can be invoked as methods to get grouped arrays (no need to filter `all()`)

- [ ] `sandbox.runCode(...)` is used as a top-level method, not as `sandbox.code_interpreter.runCode(...)`; `browser.screenshot({fullPage:true})` takes an object argument

- [ ] Binary assets are produced via `commands` running `base64 -d` inside the sandbox; **not** through `files.write` (which only accepts UTF-8 strings)

- [ ] Timeout is in **seconds**, not mistaken for milliseconds

- [ ] The argument to `extendTimeout(seconds)` is named `seconds`

---

## H. Memory / Persistence (built on the official context.store API)

- [ ] Agent endpoints (which call AI) use `context.store`; cloud-functions (which do not call AI) use `context.agent.store` — ⚠️ pick the right entry point

- [ ] ⚠️ Be aware that the cloud-function's `context.agent.store` does **not** include `langgraphCheckpointer` / `langgraphStore` (the runtime strips them inside `createCloudFunctionAgentStore`); only the generic message API plus `openaiSession` / `claudeSessionStore` remain. Endpoints that need the langgraph KV must live under `agents/<name>/` and use `context.store`

- [ ] ⚠️ No fake-fallback patterns like `store?.langgraphStore ?? store` (in a cloud-function this always falls through to `store` itself, and the next `.get` call blows up with `kv.get is not a function`)

- [ ] ⚠️ **`appendMessage` / `getMessages` take a single object argument**: `store.appendMessage({ conversationId, role, content })`, **not** `store.appendMessage(convId, { role, content })`

- [ ] ⚠️ **No** home-grown `kvGet/kvSet`, and **no** simulating KV with `clearMessages+appendMessage` (a deprecated, broken workaround)

- [ ] Conversation history is stored as multiple records via `appendMessage`/`getMessages`, **not** stuffed into a single message's content

- [ ] Claude Agent SDK uses `claudeSessionStore()` (no arguments) — does **not** mistakenly bolt on langgraph

- [ ] OpenAI Agents use `openaiSession(convId)`; LangGraph / DeepAgents use `langgraphCheckpointer` + `langgraphStore` (direct properties)

- [ ] Models are fed through `toOpenAIInput` / `toAnthropicMessages` conversion, **not** by hand-assembling a history array

- [ ] Complex business data (relational queries, aggregation, user management) uses an external database — `context.store` is conversation-oriented, not a relational DB

- [ ] **Never** treat an in-process `new Map()` as durable storage (multi-instance / cold-start will lose it; the only legitimate exception is Path B's deliberate "sandbox `/tmp/` file cache" pattern)

- [ ] A given piece of data has a single writer — **no** dual writes from both an agent and a cloud-function

- [ ] Mind the limits: `getMessages` limit is 1–100, ≤10000 messages per conversation, ≤50MB per message content, `langgraphStore.search` has no vector search

---

## I. Frontend Integration (app/)

- [ ] ⭐ Every `fetch()` to an AI endpoint sends the HTTP header `makers-conversation-id: <uuid>` (`/chat`, `/outline`, `/create`, `/create-lite`, and every other endpoint under `agents/`)

- [ ] `conversation_id` is generated with `crypto.randomUUID()` and persisted in `localStorage` (one ID, used across all AI endpoints)

- [ ] ⚠️ When the frontend calls `/stop`, it **never** sends the `makers-conversation-id` header; the target ID is passed via the body as `{ conversation_id }`

- [ ] cloud-function endpoints (`/history`, etc.): header or body, either works

- [ ] The frontend reads SSE through a `ReadableStream`, splits on `data: `, filters out `ping` heartbeats so they are not rendered, and stops on `[DONE]`

- [ ] `process.env` is allowed on the frontend (consistent with frontend frameworks), but **do not** expose backend secrets like `AI_GATEWAY_API_KEY` to the browser

---

## Remediation Table: from "generic Vercel style" → "EdgeOne Makers style"

| If you currently write it like this (❌)              | Change it to (✅)                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `app/api/chat/route.ts`                               | `agents/chat/index.ts`                                                                      |
| `export async function POST(req)`                     | `export async function onRequest(context)` (or `onRequestPost`)                             |
| `const body = await req.json()`                       | `const body = context.request.body`                                                         |
| `req.headers.get('x-foo')`                            | `context.request.headers['x-foo']` (plain object)                                           |
| `process.env.AI_GATEWAY_API_KEY`                      | `context.env.AI_GATEWAY_API_KEY` (inside agent / cloud-function)                            |
| `new Anthropic({ apiKey: process.env.X })`            | Path B: `query({ options: { env: collectGatewayEnv(context.env) }})`                        |
| `new OpenAI({ apiKey, baseURL })`                     | Path A: `createModel(getAgentEnv(context.env))`                                             |
| `result.toUIMessageStreamResponse()`                  | `createSSEResponse(gen, signal)` + the unified event protocol                               |
| `export const runtime = 'edge'`                       | delete it (the EdgeOne Agent Node Runtime manages this itself)                              |
| `req.signal`                                          | `context.request.signal`                                                                    |
| Hand-written `.edgeone/agent-node/config.json`        | delete it (the CLI generates it)                                                            |
| `sandbox.code_interpreter.runCode(...)`               | `sandbox.runCode(code, { language })` (top-level method)                                    |
| `browser.screenshot(true)`                            | `browser.screenshot({ fullPage: true })`                                                    |
| `store.getMessages(convId, { limit })`                | `store.getMessages({ conversationId: convId, limit })`                                      |
| Hard-coded model names scattered around               | constant / `resolveModelName(env)`                                                          |
| Each file rolling its own SSE `ReadableStream`        | the shared `createSSEResponse` from `_shared.ts`                                            |
| Home-grown `kvGet/kvSet` faking a KV                  | use an external database for business data; `context.store` for conversation history only   |
| Claude SDK bolted onto a langgraph checkpointer       | `context.store.claudeSessionStore()` (its own thing)                                        |
| Hand-assembling a history array to feed the model     | `toOpenAIInput` / `toAnthropicMessages`                                                     |
| `/stop` sent with a `makers-conversation-id` header   | `/stop` uses **only** the body `{ conversation_id }` (the header sticky-routes and fails)   |
| Frontend calls AI endpoints without a conversation_id | every AI endpoint `fetch()` must send the header `makers-conversation-id: <uuid>`           |

---

## J. Python Routes (Route E and future Python routes)

- [ ] `edgeone.json` sets `agents.framework` (`crewai` / `langgraph` / `deepagents`)

- [ ] `requirements.txt` exists with pinned versions aligned to the platform's bundled lib

- [ ] Entry function is `async def handler(ctx):` — not `handler(context)`, not `onRequest`

- [ ] ⚠️ env is read from `ctx.env`, **never from `os.environ`**

- [ ] Abort signal uses `ctx.request.signal.is_set()` — **not** `.aborted` (that's the TS convention)

- [ ] SSE streaming uses `ctx.utils.stream_sse(gen())` or `StreamResponse.sse(gen())` — not hand-built ASGI responses

- [ ] `ctx.utils.sse(data)` is used to construct SSE frames (returns `bytes`) — not manual `f"data: {json.dumps(...)}\n\n"`

- [ ] Store methods use snake_case: `append_message` / `get_messages` / `langgraph_checkpointer` / `langgraph_store`

- [ ] Store methods use **positional arguments**: `await ctx.store.append_message(conversation_id, role, content)` — **not** single-object input like Node

- [ ] Synchronous blocking calls (e.g. `crew.kickoff()`) are wrapped in `asyncio.to_thread()` — otherwise the event loop stalls and heartbeats die

- [ ] CrewAI LLM uses `provider="openai"` — bypassing LiteLLM (not bundled on platform)

- [ ] CrewAI has `memory=False` + `verbose=False` (events go through `crewai_event_bus`, nothing on stdout)

- [ ] `/stop` endpoint reads body only, calls `ctx.utils.abortActiveRun(conversation_id)` — **no** `makers-conversation-id` header

- [ ] ⭐ Frontend calls to Python AI endpoints still use the standard `makers-conversation-id` header (the frontend is TS, identical to Node routes)

---

## Bulk Refactor Workflow (SOP for teammates)

1. **First, unify** `_shared.ts`: adopt the multimodal version's `createLogger / sseEvent / createSSEResponse` as the team standard and align every template to it.
2. **Unify** `_model.ts`: Path A uses `getAgentEnv + createModel`; Path B uses `resolveModelName + collectGatewayEnv`. All env values come from `context.env` — never `process.env`.
3. **Fix entry points endpoint by endpoint**: `onRequest` signature + `context.request.body` + `context.request.signal` + headers by index.
4. **Fix SSE endpoint by endpoint**: replace the inline `ReadableStream` with `createSSEResponse`, and align event `type`s to the unified table.
5. **Delete the old** `.edgeone/agent-node/config.json`: the CLI generates it; stop hand-maintaining it.
6. **Verify `edgeone.json`**: `agents.framework` is set correctly.
7. **Run the checklist**: every box from A through I ticked.
8. **Promote shared pieces to the template repo**: `_shared.ts` / `_model.ts` / this checklist crystallize into team scaffolding.
