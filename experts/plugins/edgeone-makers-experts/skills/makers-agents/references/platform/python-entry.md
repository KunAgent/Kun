# Python Agent Runtime Convention

> The Python agent runtime is an ASGI application (uvicorn). It shares the same platform conventions as the Node runtime (file-based routing, `makers-conversation-id` header contract, SSE protocol, etc.), but uses Python idioms.
> Applies to: Route E (CrewAI) and any future Python-based routes (LangGraph Python, DeepAgents Python, etc.).

---

## Prerequisites

- `edgeone.json` must set `agents.framework` to `crewai`, `langgraph`, or `deepagents`
- Dependencies go in `requirements.txt` (not `package.json`)

---

## 1. Entry Signature

```python
# agents/<name>/index.py or agents/<name>.py → POST /<name>
async def handler(ctx):
    """The runtime looks for a top-level `handler` function in each route module."""
    ...
```

- The `handler` function must be `async`.
- The single parameter (`ctx`) is an `AgentContext` dataclass.
- If handler is an **async generator** (`async def handler(ctx): ... yield ...`), the runtime auto-wraps it as a streaming response.
- Internal modules use `_` prefix: `_llm.py`, `_tools.py`, `_state.py` etc. (same convention as TS `_shared.ts`).

---

## 2. Context Object (`ctx`)

| Field | Type | Description |
|-------|------|-------------|
| `ctx.request.body` | `dict` | Parsed JSON request body |
| `ctx.request.headers` | `dict` | Request headers (lowercase keys, plain dict) |
| `ctx.request.signal` | `asyncio.Event` | Cancellation signal — check with `ctx.request.signal.is_set()` |
| `ctx.request.query` | `dict` | URL query parameters |
| `ctx.env` | `dict` | Environment variables — ⚠️ **never use `os.environ`** |
| `ctx.conversation_id` | `str` | Injected from `makers-conversation-id` header |
| `ctx.run_id` | `str` | Current run ID |
| `ctx.store` | `ConversationMemory` | Message CRUD + LangGraph adapters |
| `ctx.tools` | Tools | Platform tools (lazy-loaded, shaped by `agents.framework`) |
| `ctx.sandbox` | Sandbox | Sandbox client (lazy-loaded) |
| `ctx.kv` | KV store | Per-route KV store |
| `ctx.utils` | `ContextUtils` | SSE helpers + abort utility |
| `ctx.tracer` | Tracer | Manual observability span API |

### ⚠️ The Iron Rule on Environment Variables

- Every `.py` file under `agents/`: **`os.environ` is forbidden**, **`ctx.env` is mandatory**
- Frontend code (`app/`, `src/`) is not subject to this restriction
- Shared internal modules (`_llm.py`, etc.): take `env` as a parameter from the caller

---

## 3. SSE Streaming

**Recommended pattern** (via `ctx.utils`):

```python
import time

async def handler(ctx):
    message = ctx.request.body.get("message", "")
    if not message:
        return {"error": "'message' is required"}, 400

    async def gen():
        # ... LLM streaming logic ...
        yield ctx.utils.sse({"type": "ai_response", "content": "Hello"})
        yield ctx.utils.sse({"type": "ping", "ts": int(time.time() * 1000)})
        yield ctx.utils.sse({"type": "usage", "input_tokens": 10, "output_tokens": 5})
        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())
```

**Alternative** (explicit `StreamResponse`):

```python
from _platform.context import StreamResponse, sse

async def handler(ctx):
    async def gen():
        yield sse({"type": "ai_response", "content": "World"})
    return StreamResponse.sse(gen())
```

Both approaches produce identical SSE responses with correct headers (`text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, `Connection: keep-alive`).

---

## 4. Return Values

Python handlers can return:

| Return type | Runtime behavior |
|-------------|-----------------|
| `dict` / `list` | JSON response (200) |
| `str` | Plain text response (200) |
| `(body, status)` tuple | Response with custom status code |
| `StreamResponse` | Streaming response (via `ctx.utils.stream_sse()` or `StreamResponse.sse()`) |
| async generator | Auto-wrapped as streaming response |

---

## 5. Memory / Store API

Python uses **positional arguments** (not a single-object input like Node):

```python
# Append a message
msg_id = await ctx.store.append_message(ctx.conversation_id, "user", "Hello!")

# Get messages (default: ascending order)
messages = await ctx.store.get_messages(ctx.conversation_id, limit=50)

# Convert to model input format
openai_msgs = ctx.store.to_openai_input(messages)

# LangGraph adapters (direct properties, snake_case)
checkpointer = ctx.store.langgraph_checkpointer
lg_store = ctx.store.langgraph_store
```

> ⚠️ Same constraint as Node: `langgraph_checkpointer` / `langgraph_store` are only available in agent endpoints (`agents/<name>/`), not cloud-functions.

---

## 6. Abort / Stop Convention

```python
# agents/stop.py
async def handler(ctx):
    # ⚠️ Read conversation_id from body only (no makers-conversation-id header)
    target = ctx.request.body.get("conversation_id") or ""
    result = ctx.utils.abortActiveRun(target)  # camelCase (aligned with Node)
    # Alias: ctx.utils.abort_active_run(target)
    return {
        "status": "aborted" if result.aborted else "idle",
        "conversation_id": result.conversation_id,
        "run_id": result.run_id,
    }
```

---

## 7. Node ↔ Python Naming Mapping

| Node (TS) | Python |
|-----------|--------|
| `context.request.signal.aborted` | `ctx.request.signal.is_set()` |
| `context.store.appendMessage({conversationId, role, content})` | `await ctx.store.append_message(conversation_id, role, content)` |
| `context.store.getMessages({conversationId, limit})` | `await ctx.store.get_messages(conversation_id, limit=N)` |
| `context.store.langgraphCheckpointer` | `ctx.store.langgraph_checkpointer` |
| `context.store.langgraphStore` | `ctx.store.langgraph_store` |
| `context.store.toOpenAIInput(msgs)` | `ctx.store.to_openai_input(msgs)` |
| `context.utils.abortActiveRun(id)` | `ctx.utils.abortActiveRun(id)` or `ctx.utils.abort_active_run(id)` |
| `createSSEResponse(gen, signal)` | `ctx.utils.stream_sse(gen())` |
| `sseEvent({type, content})` | `ctx.utils.sse({"type": ..., "content": ...})` |

---

## 8. Blocking Code (Critical for Python)

CrewAI's `crew.kickoff()` is **synchronous and blocking**. You MUST offload it to a thread:

```python
import asyncio

async def handler(ctx):
    crew = build_crew(...)
    # ⚠️ WRONG: result = crew.kickoff()  ← blocks event loop, kills heartbeats
    # ✅ RIGHT:
    result = await asyncio.to_thread(crew.kickoff)
```

This applies to any synchronous SDK call (CrewAI, some LangChain tools, file I/O, etc.).

---

## 9. File Routing (same as Node)

- `agents/<name>.py` or `agents/<name>/index.py` → `POST /<name>`
- `_`-prefixed files are internal modules (not routed)
- The CLI auto-scans at build time (do not hand-edit config)

---

## See Also

- Node runtime conventions: [node-entry.md](./node-entry.md)
- Memory / Store: [../capabilities/store.md](../capabilities/store.md)
- Sandbox & Tools: [../capabilities/sandbox.md](../capabilities/sandbox.md)
- CrewAI framework route: [../python-frameworks/crewai.md](../python-frameworks/crewai.md)
- Review checklist (§J Python): [../review-checklist.md](../review-checklist.md)
