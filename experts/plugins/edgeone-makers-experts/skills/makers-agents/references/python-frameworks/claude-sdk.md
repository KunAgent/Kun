# Route B (Python): Claude Agent SDK

> Use when: multi-step agentic flows, sandbox code execution, file processing, session memory.
> Core pattern: `claude_agent_sdk.query()` + MCP servers + session binding + SSE streaming.
> Python runtime — see [../platform/python-entry.md](./../platform/python-entry.md) for entry signature, ctx object, and SSE conventions.

---

## Dependencies

```txt
# requirements.txt
claude-agent-sdk>=0.1.0
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
    
    "framework": "claude-agent-sdk",
    "timeout": 1800
  }
}
```

---

## When to Use This Route (Python)

✅ Good fit:
- Need a sandbox to run code (Python/shell) and process uploaded files
- Need multi-turn session memory (resume session)
- Need custom MCP tools
- Complex multi-step agentic reasoning
- Team already uses Python

❌ Not a fit:
- Single-turn short Q&A → DeepAgents (simpler)
- Multi-agent handoff → Route C (OpenAI Agents)
- Need LangGraph checkpointer persistence → Route D (LangGraph)

---

## Core Pattern Breakdown

### 1. LLM env mapping (AI Gateway → Anthropic variables)

```python
# agents/<name>/_model.py
DEFAULT_MODEL = "@makers/deepseek-v4-flash"


def resolve_model_name(env: dict) -> str:
    return env.get("AI_GATEWAY_MODEL") or DEFAULT_MODEL


def collect_gateway_env(env: dict) -> dict:
    """Map AI_GATEWAY_* to ANTHROPIC_* variables the SDK expects."""
    result = {}
    if env.get("AI_GATEWAY_BASE_URL"):
        result["ANTHROPIC_BASE_URL"] = env["AI_GATEWAY_BASE_URL"]
    if env.get("AI_GATEWAY_API_KEY"):
        result["ANTHROPIC_API_KEY"] = env["AI_GATEWAY_API_KEY"]
    if env.get("AI_GATEWAY_SMALL_MODEL") or env.get("AI_GATEWAY_MODEL"):
        result["ANTHROPIC_SMALL_FAST_MODEL"] = env.get("AI_GATEWAY_SMALL_MODEL") or env.get("AI_GATEWAY_MODEL", "")
    return result
```

> ⚠️ **Must include writable config directories** in the env dict passed to `query()`. The Claude CLI subprocess requires a writable `~/.claude` and temp directory. In the EdgeOne Makers serverless runtime, HOME is typically not writable — the SDK silently exits with zero output if it cannot initialise its config directory.

```python
query_env = {
    **collect_gateway_env(env),
    "CLAUDE_CONFIG_DIR": "/tmp/claude-agent-sdk",  # writable config directory
    "CLAUDE_CODE_TMPDIR": "/tmp",                  # writable temp directory
}
# Pass to query(prompt=..., options={"env": query_env, ...})
```

### 2. SSE streaming with query()

```python
# agents/<name>/index.py
from claude_agent_sdk import query, create_sdk_mcp_server
from ._model import resolve_model_name, collect_gateway_env


async def handler(ctx):
    message = ctx.request.body.get("message", "")
    if not message:
        return {"error": "'message' is required"}, 400

    env = ctx.env
    query_env = {
        **collect_gateway_env(env),
        "CLAUDE_CONFIG_DIR": "/tmp/claude-agent-sdk",
        "CLAUDE_CODE_TMPDIR": "/tmp",
    }

    # ⭐ Use to_claude_mcp_server — returns bundle with name, tools, allowed_tools
    edgeone_bundle = ctx.tools.to_claude_mcp_server("edgeone", always_load=True)
    edgeone_mcp = create_sdk_mcp_server(edgeone_bundle)

    async def gen():
        try:
            stream = query(
                prompt=message,
                options={
                    "model": resolve_model_name(env),
                    "env": query_env,
                    "max_turns": 30,
                    "mcp_servers": {"edgeone": edgeone_mcp},
                    "allowed_tools": edgeone_bundle.allowed_tools,
                },
            )

            async for msg in stream:
                if ctx.request.signal.is_set():
                    break
                # Dispatch by message type
                if hasattr(msg, "text") and msg.text:
                    yield ctx.utils.sse({"type": "ai_response", "content": msg.text})
                elif hasattr(msg, "tool_name") and msg.tool_name:
                    yield ctx.utils.sse({"type": "tool_call", "name": msg.tool_name})

        except Exception as e:
            if not ctx.request.signal.is_set():
                yield ctx.utils.sse({"type": "error_message", "content": str(e)})

        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())
```

### 3. Session binding (conversation memory)

```python
# ctx.store provides claudeSessionStore equivalent
# The Python SDK uses ctx.store directly for session persistence
session_store = ctx.store  # ConversationMemory handles session state
```

> ⚠️ The Python Claude Agent SDK session mechanism mirrors the Node version. Use `ctx.store` for persistence — do not mix with LangGraph checkpointer.

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

## Key Differences from Node Route B

| Dimension | Node (TS) | Python |
|-----------|-----------|--------|
| Import | `import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'` | `from claude_agent_sdk import query, create_sdk_mcp_server` |
| Entry | `export async function onRequest(context)` | `async def handler(ctx):` |
| Env mapping | `collectGatewayEnv(context.env)` | `collect_gateway_env(ctx.env)` |
| Tools | `context.tools.toClaudeMcpServer(...)` | `ctx.tools.to_claude_mcp_server(...)` |
| SSE | `createSSEResponse(gen, signal)` | `ctx.utils.stream_sse(gen())` |
| Abort signal | `signal?.aborted` | `ctx.request.signal.is_set()` |
| Session store | `context.store.claudeSessionStore()` | `ctx.store` (direct) |

---

## Review Checklist (Python Claude SDK)

- [ ] `edgeone.json` sets `agents.framework: "claude-agent-sdk"`
- [ ] `requirements.txt` includes `claude-agent-sdk>=0.1.0`
- [ ] Entry function is `async def handler(ctx):`
- [ ] env from `ctx.env` — never `os.environ`
- [ ] Gateway env mapped via helper (AI_GATEWAY_* → ANTHROPIC_*)
- [ ] `query()` has `max_turns` set
- [ ] Abort signal checked via `ctx.request.signal.is_set()`
- [ ] SSE uses `ctx.utils.stream_sse(gen())`
- [ ] Stream ends with `data: [DONE]\n\n`
- [ ] `/stop` reads body only — no `makers-conversation-id` header

---

## See Also

- Node Route B: [../node-frameworks/claude-sdk.md](../node-frameworks/claude-sdk.md)
- Python runtime conventions: [../platform/python-entry.md](./../platform/python-entry.md)
- Store API: [../capabilities/store.md](../capabilities/store.md)
- Sandbox: [../capabilities/sandbox.md](../capabilities/sandbox.md)
