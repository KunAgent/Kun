# DeepAgents (Python)

> Use when: long-running tasks with automatic context compression, sub-agent orchestration, middleware.
> Core pattern: `create_deep_agent()` + `agent.astream()` → SSE.
> Python runtime — see [../platform/python-entry.md](./../platform/python-entry.md) for entry signature, ctx object, and SSE conventions.

---

## Dependencies

```txt
# requirements.txt
deepagents>=1.9.0
langchain-openai>=0.3.0
langchain-core>=0.3.0
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
    
    "framework": "deepagents",
    "timeout": 1800
  }
}
```

---

## When to Pick DeepAgents (Python)

✅ Good fit:
- Long agent tasks with automatic context compression
- Sub-agent orchestration with isolated context
- Want middleware (retry, call limits)
- Team uses Python

❌ Not a fit:
- Need fine-grained graph control → use LangGraph
- Need Claude SDK sandbox/MCP → use Claude SDK route
- Multi-agent handoff → use OpenAI Agents route

---

## Core Pattern

### 1. Model initialization

```python
# agents/<name>/_llm.py
from langchain_openai import ChatOpenAI

DEFAULT_MODEL = "@makers/deepseek-v4-flash"
_model_cache: dict = {}


def get_model(env: dict) -> ChatOpenAI:
    cache_key = env.get("AI_GATEWAY_BASE_URL", "")
    if cache_key in _model_cache:
        return _model_cache[cache_key]
    llm = ChatOpenAI(
        model=DEFAULT_MODEL,
        api_key=env["AI_GATEWAY_API_KEY"],
        base_url=env["AI_GATEWAY_BASE_URL"],
        temperature=0,
        timeout=300,
        streaming=True,
    )
    _model_cache[cache_key] = llm
    return llm
```

### 2. Agent assembly

```python
# agents/<name>/_agent.py
from deepagents import create_deep_agent


def build_agent(model, tools):
    return create_deep_agent(
        model=model,
        system_prompt="You are a helpful research assistant.",
        tools=tools,
        max_turns=30,
    )
```

### 3. Sub-agent orchestration

```python
from deepagents import create_deep_agent

research_agent = create_deep_agent(
    model=model,
    system_prompt="You are a research expert.",
    tools=[internet_search],
)

writer_agent = create_deep_agent(
    model=model,
    system_prompt="You are a writer.",
    tools=[],
    sub_agents=[
        {"name": "researcher", "description": "For research tasks", "agent": research_agent},
    ],
)
```

### 4. SSE streaming entry

```python
# agents/<name>/index.py
from ._llm import get_model
from ._agent import build_agent


async def handler(ctx):
    message = ctx.request.body.get("message", "")
    if not message:
        return {"error": "'message' is required"}, 400

    model = get_model(ctx.env)
    # ⭐ Must use to_langchain_tools to get real LangChain tool instances
    from langchain_core.tools import tool
    tools = ctx.tools.to_langchain_tools(tool) if ctx.tools else []
    agent = build_agent(model, tools)

    async def gen():
        try:
            async for chunk in agent.astream(
                {"messages": [{"role": "user", "content": message}]},
                config={"configurable": {"thread_id": ctx.conversation_id}},
                stream_mode="messages",
            ):
                if ctx.request.signal.is_set():
                    break
                msg, _ = chunk
                if hasattr(msg, "content") and msg.content:
                    yield ctx.utils.sse({"type": "ai_response", "content": msg.content})
                elif hasattr(msg, "tool_calls") and msg.tool_calls:
                    for tc in msg.tool_calls:
                        yield ctx.utils.sse({"type": "tool_call", "name": tc["name"]})
        except Exception as e:
            if not ctx.request.signal.is_set():
                yield ctx.utils.sse({"type": "error_message", "content": str(e)})
        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())
```

---

## Memory

DeepAgents reuses LangGraph's memory adapters (snake_case in Python):

```python
checkpointer = ctx.store.langgraph_checkpointer
lg_store = ctx.store.langgraph_store
```

---

## Review Checklist

- [ ] `edgeone.json` sets `agents.framework: "deepagents"`
- [ ] `requirements.txt` includes `deepagents>=1.9.0`
- [ ] env from `ctx.env` — never `os.environ`
- [ ] Abort signal checked via `ctx.request.signal.is_set()`
- [ ] SSE uses `ctx.utils.stream_sse(gen())`
- [ ] Stream ends with `data: [DONE]\n\n`
