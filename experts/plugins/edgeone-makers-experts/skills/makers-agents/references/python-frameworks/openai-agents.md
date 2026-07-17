# Route C (Python): OpenAI Agents SDK

> Use when: multi-agent collaboration (`handoff`), `guardrails`, or scenarios that need `Session` to auto-prepend history.
> Core pattern: `Agent` + `Runner.run()` streaming + session + event-to-SSE mapping.
> Python runtime — see [../platform/python-entry.md](./../platform/python-entry.md) for entry signature, ctx object, and SSE conventions.

---

## Dependencies

```txt
# requirements.txt
openai-agents>=0.1.0
openai>=1.50.0
pydantic>=2.0.0
```

```bash
pip install -r requirements.txt
```

`edgeone.json`:
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "agents": {
    
    "framework": "openai-agents-sdk",
    "timeout": 1800
  }
}
```

---

## When to Use This Route (Python)

✅ Good fit:
- Multi-agent collaboration (Triage Agent routing to specialist Agents via `handoff`)
- Need Session to auto-prepend history
- Want OpenAI Agents' `guardrails` mechanism
- Team already uses Python / existing Python codebase

❌ Not a fit:
- Single-turn short Q&A → DeepAgents (simpler)
- Need sandbox to run code → Route B (Claude SDK)
- Need LangGraph persistence → Route D

---

## Core Pattern Breakdown

### 1. Model initialization

```python
# agents/<name>/_model.py
from openai import OpenAI

DEFAULT_MODEL = "@makers/hy3-preview"


def build_client(env: dict) -> OpenAI:
    """Build OpenAI client pointing to AI Gateway."""
    return OpenAI(
        api_key=env["AI_GATEWAY_API_KEY"],
        base_url=env["AI_GATEWAY_BASE_URL"],
    )
```

### 2. Agent and tool definitions

```python
# agents/<name>/_agents.py
from agents import Agent


def build_agent(model: str, ctx_tools=None):
    """Build the main agent with platform tools."""
    # ⭐ ctx.tools.all() returns OpenAI Agents-compatible tools directly
    tools = ctx_tools.all() if ctx_tools else []

    return Agent(
        name="Assistant",
        instructions="You are a helpful assistant.",
        tools=tools,
        model=model,
    )
```

### 3. SSE streaming entry point

```python
# agents/<name>/index.py
from agents import Runner
from ._model import build_client, DEFAULT_MODEL
from ._agents import build_agent


async def handler(ctx):
    message = ctx.request.body.get("message", "")
    if not message:
        return {"error": "'message' is required"}, 400

    env = ctx.env
    if not env.get("AI_GATEWAY_API_KEY") or not env.get("AI_GATEWAY_BASE_URL"):
        return {"error": "Missing AI_GATEWAY_API_KEY or AI_GATEWAY_BASE_URL"}, 500

    client = build_client(env)
    model = env.get("AI_GATEWAY_MODEL") or DEFAULT_MODEL
    agent = build_agent(model, ctx.tools)

    async def gen():
        try:
            result = await Runner.run(
                agent,
                message,
                stream=True,
                context={"openai_client": client},
            )

            async for event in result.stream_events():
                if ctx.request.signal.is_set():
                    break

                # Text delta
                if event.type == "raw_model_stream_event" and hasattr(event.data, "delta"):
                    delta = event.data.delta
                    if delta:
                        yield ctx.utils.sse({"type": "ai_response", "content": delta})

                # Tool call
                elif event.type == "run_item_stream_event" and event.name == "tool_called":
                    tool_name = getattr(event.item, "name", "")
                    if tool_name:
                        yield ctx.utils.sse({"type": "tool_call", "name": tool_name})

                # Tool result
                elif event.type == "run_item_stream_event" and event.name == "tool_output":
                    name = getattr(event.item, "name", "")
                    output = str(getattr(event.item, "output", ""))[:500]
                    yield ctx.utils.sse({"type": "tool_result", "name": name, "content": output})

                # Handoff
                elif event.type == "agent_updated_stream_event":
                    agent_name = getattr(event.agent, "name", "unknown")
                    yield ctx.utils.sse({"type": "tool_call", "name": f"handoff:{agent_name}"})

        except Exception as e:
            if not ctx.request.signal.is_set():
                yield ctx.utils.sse({"type": "error_message", "content": str(e)})

        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())
```

### 4. /stop endpoint

```python
# agents/stop.py
async def handler(ctx):
    target = ctx.request.body.get("conversation_id") or ""
    if not target:
        return {"error": "Missing conversation_id"}, 400
    result = ctx.utils.abortActiveRun(target)
    return {
        "status": "aborted" if result.aborted else "idle",
        "conversation_id": result.conversation_id,
        "run_id": result.run_id,
    }
```

---

## Key Differences from Node Route C

| Dimension | Node (TS) | Python |
|-----------|-----------|--------|
| Import | `import { Agent, run } from '@openai/agents'` | `from agents import Agent, Runner` |
| Entry | `export async function onRequest(context)` | `async def handler(ctx):` |
| Model | `new OpenAIChatCompletionsModel(client, model)` | Pass `model` string + client via context |
| Run | `run(agent, message, { stream: true, session })` | `Runner.run(agent, message, stream=True)` |
| Stream events | `result.toStream()` | `result.stream_events()` |
| Tools | `context.tools.all()` → FunctionTool format | `ctx.tools.all()` → OpenAI Agents-compatible |
| SSE | `createSSEResponse(gen, signal)` | `ctx.utils.stream_sse(gen())` |
| Abort | `signal?.aborted` | `ctx.request.signal.is_set()` |
| Session | `context.store.openaiSession(convId)` | Session via store (same pattern) |

---

## Review Checklist (Python OpenAI Agents)

- [ ] `edgeone.json` sets `agents.framework: "openai-agents-sdk"`
- [ ] `requirements.txt` includes `openai-agents>=0.1.0` and `openai>=1.50.0`
- [ ] Entry function is `async def handler(ctx):`
- [ ] env from `ctx.env` — never `os.environ`
- [ ] OpenAI client uses `api_key` and `base_url` from `ctx.env`
- [ ] Abort signal checked via `ctx.request.signal.is_set()`
- [ ] SSE uses `ctx.utils.stream_sse(gen())`
- [ ] Stream events mapped: text delta → `ai_response`, tool_called → `tool_call`, tool_output → `tool_result`
- [ ] Stream ends with `data: [DONE]\n\n`
- [ ] `/stop` reads body only — no `makers-conversation-id` header

---

## See Also

- Node Route C: [../node-frameworks/openai-agents.md](../node-frameworks/openai-agents.md)
- Python runtime conventions: [../platform/python-entry.md](./../platform/python-entry.md)
- Store API: [../capabilities/store.md](../capabilities/store.md)
