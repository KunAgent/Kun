# Route E: CrewAI (Python-only)

> Use when: multi-agent collaboration (role split + Sequential/Hierarchical Process), YAML-configured Agent/Task is desired, or you want to leverage CrewAI's built-in skills / event_bus capabilities.
> Core pattern: `Crew(agents, tasks, process)` + `crew.kickoff()` + bridging events to SSE.
> ⚠️ **CrewAI has no official JS SDK** — this is the **only route among the five that requires the Python runtime**.

---

## When to use Route E

✅ Good fit:
- Multi-agent role split (e.g. Researcher / Writer / Polisher collaborating on articles or emails)
- Sequential or Hierarchical multi-task pipelines
- You want CrewAI 1.14+ `skills=[...]` to load local `SKILL.md` directories
- You want to nest CrewAI as a sub-flow inside a LangGraph node (hybrid paradigm)

❌ Not a fit:
- TypeScript templates (CrewAI has no JS SDK) → pick another framework instead
- Single-agent simple Q&A → DeepAgents (simpler)
- Need Claude SDK's sandbox MCP capabilities → Route B
- Need langgraph checkpointer persistence → Route D (you can also mix: embed CrewAI inside a LangGraph node)

---

## ⚠️ Key differences between Python and TS routes (in one shot)

| Dimension | TS routes (A/B/C/D) | **Python route (E)** |
|------|-------------------|---------------------|
| File extension | `.ts` | `.py` |
| Entry signature | `export async function onRequest(context)` | `async def handler(ctx):` |
| Dependency mgmt | `package.json` | **`requirements.txt`** |
| Key `edgeone.json` field | `agents.framework` |
| Naming style | camelCase (`appendMessage` / `abortActiveRun`) | **snake_case** (`append_message` / `abort_active_run`) |
| Memory API | `store.appendMessage({ ... })` | `await ctx.store.append_message(conversation_id, role, content)` |
| Types | TypeScript interfaces | Python type hints + Pydantic |
| Module layout | `_shared.ts` / `_model.ts` etc. | `_llm.py` / `_state.py` / `_tools.py` etc. |

> ⚠️ **A lot of naming intuition that holds in the TS routes does NOT hold in Python**: when reviewing a Python template, don't hunt for bugs against TS API names.

---

## Python Runtime Conventions (applies to all Python routes)

The Python agent runtime is an ASGI application (runs on uvicorn). It shares the same platform conventions as the Node runtime, but with Python-specific idioms.

### Entry Signature

```python
async def handler(ctx):
    """Every Python agent endpoint exports a top-level `handler` function."""
    ...
```

- The parameter is an `AgentContext` dataclass (imported from `_platform.context` internally, but you never need to import it yourself).
- File-based routing: `agents/<name>/index.py` or `agents/<name>.py` → `POST /<name>` (same as TS).
- Internal modules use `_` prefix: `_llm.py`, `_tools.py`, `_state.py` etc.

### Context Object (`ctx`)

| Field | Type | Description |
|-------|------|-------------|
| `ctx.request.body` | `dict` | Parsed JSON request body |
| `ctx.request.headers` | `dict` | Request headers (lowercase keys) |
| `ctx.request.signal` | `asyncio.Event` | Cancellation signal — check with `ctx.request.signal.is_set()` |
| `ctx.request.query` | `dict` | URL query parameters |
| `ctx.env` | `dict` | Environment variables (⚠️ never use `os.environ` in agent code) |
| `ctx.conversation_id` | `str` | From `makers-conversation-id` header |
| `ctx.run_id` | `str` | Current run ID |
| `ctx.store` | `ConversationMemory` | Message history CRUD + LangGraph adapters |
| `ctx.tools` | Tools | Platform tools (lazy-loaded, shaped by `agents.framework`) |
| `ctx.sandbox` | Sandbox | Sandbox client (lazy-loaded) |
| `ctx.kv` | KV store | Per-route KV store |
| `ctx.utils` | `ContextUtils` | Platform utilities (SSE, abort, etc.) |

### SSE Streaming (recommended pattern)

```python
async def handler(ctx):
    async def gen():
        yield ctx.utils.sse({"type": "ai_response", "content": "Hello"})
        yield ctx.utils.sse({"type": "ping", "ts": int(time.time() * 1000)})
        yield b"data: [DONE]\n\n"
    return ctx.utils.stream_sse(gen())
```

- `ctx.utils.sse(data, event=None)` → returns `bytes` (one SSE frame)
- `ctx.utils.stream_sse(gen())` → returns `StreamResponse` with correct headers (Content-Type, Cache-Control, X-Accel-Buffering, Connection)
- No need to manually set response headers — the platform handles them.

### Memory / Store API (snake_case)

```python
# Append a message
msg_id = await ctx.store.append_message(ctx.conversation_id, "user", "Hello!")

# Get messages (ascending by time, for prompt construction)
messages = await ctx.store.get_messages(ctx.conversation_id, limit=50)

# Convert to OpenAI format
openai_msgs = ctx.store.to_openai_input(messages)

# LangGraph adapters (direct properties, snake_case)
checkpointer = ctx.store.langgraph_checkpointer
lg_store = ctx.store.langgraph_store
```

### /stop Endpoint

```python
async def handler(ctx):
    target = ctx.request.body.get("conversation_id") or ""
    result = ctx.utils.abortActiveRun(target)  # camelCase (aligned with Node)
    # or: result = ctx.utils.abort_active_run(target)  # snake_case alias
    return {
        "status": "aborted" if result.aborted else "idle",
        "conversation_id": result.conversation_id,
        "run_id": result.run_id,
    }
```

### Key Differences from Node Runtime

| Dimension | Node (TS) | Python |
|-----------|-----------|--------|
| Abort signal | `signal.aborted` (boolean) | `ctx.request.signal.is_set()` (asyncio.Event) |
| Abort utility | `ctx.utils.abortActiveRun(id)` | `ctx.utils.abortActiveRun(id)` or `ctx.utils.abort_active_run(id)` |
| SSE helper | `createSSEResponse(gen, signal)` | `ctx.utils.stream_sse(gen())` |
| Store methods | camelCase: `appendMessage`, `getMessages` | snake_case: `append_message`, `get_messages` |
| LangGraph adapters | `ctx.store.langgraphCheckpointer` | `ctx.store.langgraph_checkpointer` |
| Return type | `Response` object | `dict` / `StreamResponse` / async generator |
| Blocking work | N/A | Wrap in `asyncio.to_thread()` (e.g., `crew.kickoff()`) |

---

## Core pattern breakdown

### 1. `edgeone.json` configuration
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "agents": {
    "scene": ["process"],
    "tags": ["CrewAI", "multi-agent"],
    
    "slug": "email-assistant",
    "framework": "langgraph",     // can also be "crewai" directly; use langgraph here if mixing LangGraph nesting Crew
    "timeout": 1800
  }
}
```

### 2. `requirements.txt`

Install dependencies locally for development:
```bash
pip install -r requirements.txt
```

```txt
# CrewAI core (version aligned with the platform's bundled lib: .edgeone/agent-python/lib/)
crewai>=1.14.5

# If mixing LangGraph orchestration (chaining multiple agent nodes)
langgraph>=1.0.0
langgraph-checkpoint>=2.0.0
pydantic>=2.0.0

# OpenAI client (talks to AI Gateway directly for lightweight chat completions)
openai>=1.50.0
```

### 3. LLM factory (connecting to AI Gateway)
```python
# agents/<slug>/_llm.py
from typing import Any, Mapping

REQUIRED_ENV = ("AI_GATEWAY_API_KEY", "AI_GATEWAY_BASE_URL")
DEFAULT_MODEL = "@makers/deepseek-v4-flash"

# Module-level singleton: avoid rebuilding the LLM client on every request
_crewai_llm_singleton: Any = None
_singleton_env_fingerprint: tuple[str, str] | None = None


def get_env(context_env: Mapping[str, str] | None) -> dict[str, str]:
    """Extract and validate required vars from context.env (do NOT read os.environ)"""
    source = dict(context_env or {})
    missing = [k for k in REQUIRED_ENV if not (source.get(k) or "").strip()]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")
    return {k: source[k] for k in REQUIRED_ENV}


def get_crewai_llm(env: Mapping[str, str], *, model: str = DEFAULT_MODEL) -> Any:
    """CrewAI LLM bound to AI Gateway."""
    global _crewai_llm_singleton, _singleton_env_fingerprint
    fp = (env["AI_GATEWAY_API_KEY"], env["AI_GATEWAY_BASE_URL"])
    if _singleton_env_fingerprint != fp:
        _crewai_llm_singleton = None
        _singleton_env_fingerprint = fp
    if _crewai_llm_singleton is not None:
        return _crewai_llm_singleton

    from crewai import LLM   # Lazy import: tests that only exercise parsing don't pull heavy deps

    _crewai_llm_singleton = LLM(
        model=model,
        provider="openai",                # ⭐ Must be 'openai' to bypass LiteLLM dispatch (the platform image does not bundle LiteLLM)
        api_key=env["AI_GATEWAY_API_KEY"],
        base_url=env["AI_GATEWAY_BASE_URL"],
        temperature=0.3,
        timeout=300,
        stream=True,                       # Let CrewAI push token chunks onto event_bus
    )
    return _crewai_llm_singleton
```
> ⭐ **`provider="openai"` is mandatory**: CrewAI 1.14+ defaults to LiteLLM dispatch, but the platform image does not include LiteLLM. Force the provider to talk to the OpenAI-compatible protocol directly, bypassing LiteLLM.

### 4. Agent / Task definitions (role split)
```python
# agents/<slug>/_agents.py
from crewai import Agent

def build_writer_agent(llm) -> Agent:
    return Agent(
        role="Email Reply Writer",
        goal="Draft a first-pass reply based on the email classification and the user's tone rules",
        backstory="You are an efficient email assistant skilled at adapting tone to context...",
        llm=llm,
        tools=[],                  # Attach tools here; for platform tools use context.tools
        verbose=False,             # Don't print to stdout; events flow through event_bus
        allow_delegation=False,
    )

def build_polisher_agent(llm) -> Agent:
    return Agent(
        role="Email Polisher",
        goal="Polish the draft into the recipient's preferred style",
        backstory="...",
        llm=llm,
        verbose=False,
    )
```

```python
# agents/<slug>/_tasks.py
from crewai import Task

def build_draft_task(writer_agent, *, email_subject: str, email_body: str) -> Task:
    # ⭐ The f-string bakes data into the description at build time, avoiding runtime placeholders
    return Task(
        description=f"""Please draft a reply to the following email:
Subject: {email_subject}
Body: {email_body}

Requirements:
1. Concise and professional
2. Ask clarifying questions when necessary
""",
        expected_output="A Chinese reply draft (150-300 chars)",
        agent=writer_agent,
    )
```

### 5. Crew assembly (the core)
```python
# agents/<slug>/_crew.py
from pathlib import Path
from typing import Any

_SKILLS_DIR = Path(__file__).resolve().parent / "skills"


def _resolve_skill_dirs() -> list[str]:
    """Collect local skill directories; CrewAI 1.14+ natively loads these SKILL.md files"""
    dirs: list[str] = []
    for name in ("email-tone", "email-templates"):
        candidate = _SKILLS_DIR / name
        if candidate.is_dir():
            dirs.append(str(candidate))
    return dirs


def build_email_draft_crew(llm, *, classified, rules) -> Any:
    from crewai import Crew, Process

    writer = build_writer_agent(llm)
    polisher = build_polisher_agent(llm)

    draft_task = build_draft_task(writer, email_subject=..., email_body=...)
    polish_task = build_polish_task(polisher, ...)

    return Crew(
        agents=[writer, polisher],
        tasks=[draft_task, polish_task],
        process=Process.sequential,        # ⭐ Run in order; you may also use Process.hierarchical (auto-dispatch)
        memory=False,                       # ⭐ Use ctx.store for cross-turn memory; do NOT use CrewAI's built-in
        skills=_resolve_skill_dirs(),       # ⭐ CrewAI 1.14+ loads local SKILL.md (tone / templates)
        verbose=False,
        # max_rpm=10,                       # Optional: rate-limit guard
    )
```

> ⭐ Key boundaries:
> - `memory=False` — cross-conversation memory goes through `context.store` (consistent with the TS routes)
> - `verbose=False` — progress events flow through `crewai_event_bus`, not stdout (avoids polluting the SSE stream)
> - `skills=[...]` — 1.14+ feature; loads local markdown skill files

### 6. Event bridge: CrewAI event_bus → SSE
```python
# agents/<slug>/_events.py
import asyncio
from typing import Any
from crewai.utilities.events import crewai_event_bus
from crewai.utilities.events.task_events import TaskCompletedEvent
from crewai.utilities.events.llm_events import LLMStreamChunkEvent


class CrewProgressBridge:
    """Subscribe to CrewAI events → push onto an asyncio.Queue → SSE generator yields"""

    def __init__(self, queue: asyncio.Queue):
        self.queue = queue
        self._unsubs = []

    def start(self):
        @crewai_event_bus.on(LLMStreamChunkEvent)
        def _on_chunk(source, event: LLMStreamChunkEvent):
            # Streaming token → ai_response
            chunk = getattr(event, "chunk", "") or ""
            if chunk:
                self.queue.put_nowait({"type": "ai_response", "content": chunk})

        @crewai_event_bus.on(TaskCompletedEvent)
        def _on_task_done(source, event: TaskCompletedEvent):
            # Task completed → tool_result (a custom type also works)
            self.queue.put_nowait({
                "type": "tool_result",
                "name": event.task.description[:40],
                "content": str(event.output)[:500],
            })
        # Save handlers for later cleanup (the CrewAI API varies by version; adjust as needed)

    def stop(self):
        for u in self._unsubs:
            try: u()
            except: pass
```

### 7. SSE main entry (async generator + heartbeat)
```python
# agents/<slug>/run.py
import asyncio
import json
from typing import AsyncIterator
from _crew import build_email_draft_crew
from _events import CrewProgressBridge
from _llm import get_crewai_llm, get_env


async def event_stream(context, body) -> AsyncIterator[str]:
    """yield SSE frames"""
    queue: asyncio.Queue = asyncio.Queue()
    bridge = CrewProgressBridge(queue)
    bridge.start()

    try:
        env = get_env(context.env)               # ⭐ context.env, do NOT read os.environ
        llm = get_crewai_llm(env)
        crew = build_email_draft_crew(llm, classified=..., rules=...)

        # crew.kickoff is a synchronous blocking call; offload it to a thread
        task = asyncio.create_task(asyncio.to_thread(crew.kickoff))

        while True:
            if context.request.signal.is_set():   # ⭐ Python uses .is_set(), not .aborted
                break
            done, _ = await asyncio.wait(
                [task, asyncio.create_task(queue.get())],
                return_when=asyncio.FIRST_COMPLETED,
                timeout=5,
            )
            # 5-second heartbeat
            yield f"data: {json.dumps({'type': 'ping', 'ts': int(asyncio.get_event_loop().time() * 1000)})}\n\n"

            for d in done:
                if d is task:
                    final = d.result()
                    yield f"data: {json.dumps({'type': 'usage', 'final': str(final)[:500]})}\n\n"
                    yield "data: [DONE]\n\n"
                    return
                else:
                    evt = d.result()
                    yield f"data: {json.dumps(evt)}\n\n"
    except asyncio.CancelledError:
        pass
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error_message', 'content': str(e)})}\n\n"
    finally:
        bridge.stop()
        yield "data: [DONE]\n\n"


async def handler(context):
    body = getattr(getattr(context, "request", None), "body", None) or {}
    return {
        "headers": {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
        "stream": event_stream(context, body),
    }
```
> ⚠️ The Python runtime's SSE return convention may differ from TS: check the official docs of the target platform version (Python typically returns a `dict` with a `stream` key, or returns a `Response`). `context.request.signal` in Python is a `threading.Event` / `asyncio.Event` (test with `.is_set()`), not TS's `AbortSignal` (which uses `.aborted`).

### 8. /stop endpoint (abort_active_run)
```python
# agents/<slug>/stop.py
async def handler(context):
    body = getattr(getattr(context, "request", None), "body", None) or {}
    if not isinstance(body, dict):
        body = {}

    # ⚠️ /stop reads only the body; it does NOT read the makers-conversation-id header
    conversation_id = (
        body.get("conversation_id")
        or body.get("conversationId")
    )
    if not conversation_id:
        return {"status_code": 400, "body": {"error": "Missing conversation_id"}}

    utils = getattr(context, "utils", None)
    if utils is None:
        return {"status": "noop", "reason": "ctx.utils unavailable"}

    # ⭐ Python uses abort_active_run (snake_case), not abortActiveRun
    result = utils.abort_active_run(conversation_id)
    did_abort = getattr(result, "aborted", False) if result else False
    return {
        "status": "aborting" if did_abort else "idle",
        "conversation_id": conversation_id,
        "aborted": did_abort,
    }
```

### 9. Writing history messages (persisting the conversation)
```python
async def save_message(context, role: str, content: str, metadata: dict | None = None):
    """best-effort write of a message to context.store"""
    store = getattr(context, "store", None)
    if store is None or not hasattr(store, "append_message"):
        return
    cid = getattr(context, "conversation_id", None) or "local"
    try:
        # ⭐ Python: await store.append_message(conversation_id=..., role=..., content=...)
        await store.append_message(
            conversation_id=cid,
            role=role,
            content=content,
            metadata=metadata or {},
        )
    except Exception:
        pass   # Failure to persist history must not break the SSE stream
```

### 10. /history endpoint
```python
# agents/<slug>/history.py
async def handler(context):
    body = (getattr(context.request, "body", None) or {})
    if not isinstance(body, dict):
        body = {}

    # cloud-function works too (context.agent.store); this is the agent endpoint (context.store)
    conversation_id = (
        body.get("conversation_id")
        or body.get("conversationId")
        or ctx.conversation_id
        or ""
    )
    if not conversation_id:
        return {"conversation_id": "", "messages": []}

    store = context.store
    # ⭐ Note how `limit` is passed as a single-object kwarg (depends on the Python store implementation)
    messages = await store.get_messages(
        conversation_id=conversation_id,
        limit=100,
        order="asc",
    )
    return {"conversation_id": conversation_id, "messages": messages}
```

---

## Tool integration (context.tools)

Once `edgeone.json` sets `agents.framework: 'crewai'`, `context.tools` returns CrewAI `BaseTool` instances:

```python
async def handler(context):
    # ⭐ Must use to_crewai_tools to get real CrewAI BaseTool instances
    from crewai import BaseTool
    tools = context.tools.to_crewai_tools(BaseTool)

    crew = Crew(
        agents=[Agent(role="...", tools=tools, llm=llm)],
        tasks=[...],
    )
```

> Use `ctx.tools.to_crewai_tools(BaseTool)` to get real CrewAI `BaseTool` instances. This injects the CrewAI class at call time so the toolkit doesn't depend on CrewAI directly.

---

## Route E review checklist

- [ ] `edgeone.json` sets `agents.framework` (`crewai` or `langgraph` for hybrid)
- [ ] `requirements.txt` exists and versions align with the platform's bundled lib
- [ ] LLM construction uses `provider="openai"` (bypassing LiteLLM)
- [ ] `LLM` / Crew / OpenAI client use a module-level singleton + env fingerprint reset
- [ ] env is read solely from `context.env`; **never from `os.environ`** (frontend code is exempt)
- [ ] Crew has `memory=False` + `verbose=False` (events go through event_bus, nothing on stdout)
- [ ] `crew.kickoff()` is wrapped in `asyncio.to_thread` (does not block the event loop)
- [ ] event_bus bridges `LLMStreamChunkEvent` → SSE `ai_response` and `TaskCompletedEvent` → `tool_result`
- [ ] SSE frame format `data: <JSON>\n\n` + 5-second `ping` heartbeat + closing `[DONE]`
- [ ] AbortSignal: Python uses `context.request.signal.is_set()` (not `.aborted`)
- [ ] `/stop` calls `context.utils.abort_active_run(conversation_id)` (snake_case)
- [ ] Memory API uses snake_case: `store.append_message(conversation_id=..., ...)` / `store.get_messages(conversation_id=...)`
- [ ] `/stop` reads body only — **no** `makers-conversation-id` header
- [ ] Templates that use the `web_search` tool have `WSA_API_KEY` configured
- [ ] ⭐ Frontend calls this endpoint with the `makers-conversation-id` header (the frontend is TypeScript, identical to the TS routes)

---

## Frontend call example (frontend is TS, identical to other routes)

```typescript
// Frontend code example
const conversationId = getOrCreateConversationId();   // UUID cached in localStorage

const resp = await fetch('/email/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'makers-conversation-id': conversationId,         // ⭐ required
  },
  body: JSON.stringify({ task: 'daily_digest' }),
});

// /stop (NEVER include the header)
await fetch('/email/stop', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ conversation_id: conversationId }),
});
```

---

## Quick comparison vs. A/B/C/D

| Dimension | TS routes (A/B/C/D) | **Python route (E)** |
|------|------|------|
| Language | TypeScript | **Python** |
| Runtime config | `agents.framework` | `agents.framework` |
| Entry signature | `export async function onRequest(context)` | **`async def handler(context):`** |
| Naming style | camelCase | **snake_case** |
| Memory API | `store.appendMessage({ conversationId, role, content })` | **`await store.append_message(conversation_id=..., role=..., content=...)`** |
| Abort | `signal.aborted` | **`signal.is_set()`** |
| Stream orchestration | SDK-built-in or hand-written | event_bus bridge + asyncio.Queue + asyncio.to_thread |
| Multi-agent | C's Handoff / D's subAgents | **Crew + Process.sequential / hierarchical** |
| Built-in memory option | None | CrewAI's own `memory=True` (typically replaced by ctx.store) |
| Skill loading | None | `Crew(skills=[dir])` loads local SKILL.md |
| LiteLLM compatibility trap | None | ⭐ `provider="openai"` is mandatory (platform has no LiteLLM) |

---

## Common pitfalls

1. **`provider="openai"` not set** → CrewAI dispatches via LiteLLM, which is absent on the platform and will crash outright
2. **`crew.kickoff()` not wrapped in `asyncio.to_thread`** → blocks the event loop and stalls all SSE heartbeats
3. **`verbose=True` not flipped to False** → CrewAI logs to stdout and may corrupt the SSE stream
4. **`memory=True` enabled while also using `ctx.store`** → double-write, state desync
5. **Reading env via `os.environ.get("AI_GATEWAY_API_KEY")` directly** → must read from `context.env` (the platform-injected path)
6. **Python `.is_set()` written as `.aborted`** → AbortSignal never fires
7. **Calling `store.append_message` with camelCase** → wrong name, AttributeError
8. **`requirements.txt` not pinned, or grossly diverging from the bundled platform versions** → dependency conflicts and failed deployment

See also:
- 
- Route B (Claude Agent SDK): `../node-frameworks/claude-sdk.md`
- Route C (OpenAI Agents SDK): `../node-frameworks/openai-agents.md`
- Route D (LangGraph + DeepAgents): `../node-frameworks/langgraph.md`
- Platform conventions: `../platform/node-entry.md`
- Sandbox & tools: `../capabilities/sandbox.md`
- Memory store: `../capabilities/store.md`
- Review checklist: `review-checklist.md`
