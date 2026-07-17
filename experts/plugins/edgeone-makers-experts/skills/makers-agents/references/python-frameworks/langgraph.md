# LangGraph (Python)

> Use when: fine-grained graph orchestration, custom node/edge control, human-in-the-loop (interrupt/resume), persistent thread state.
> Core pattern: `StateGraph` + `compile(checkpointer=..., store=...)` + `graph.astream()` → SSE.
> Python runtime — see [../platform/python-entry.md](./../platform/python-entry.md) for entry signature, ctx object, and SSE conventions.

---

## Dependencies

```txt
# requirements.txt
langgraph>=1.0.0
langgraph-checkpoint>=2.0.0
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
    
    "framework": "langgraph",
    "timeout": 1800
  }
}
```

---

## When to Pick LangGraph (Python)

✅ Good fit:
- Need fine-grained control over execution flow (nodes, edges, conditional routing)
- Human-in-the-loop workflows (`interrupt` / `resume`)
- Need persistent thread state (`ctx.store.langgraph_checkpointer`) + long-term KV (`ctx.store.langgraph_store`)
- Complex multi-node pipelines with subgraphs
- Team uses Python

❌ Not a fit:
- Simple single-agent tasks → use DeepAgents (higher-level)
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

### 2. Graph construction

```python
# agents/<name>/_graph.py
from langgraph.graph import StateGraph, MessagesState, START, END
from langgraph.prebuilt import ToolNode


def build_graph(model, tools, checkpointer=None, store=None):
    model_with_tools = model.bind_tools(tools)
    tool_node = ToolNode(tools)

    async def agent_node(state: MessagesState):
        response = await model_with_tools.ainvoke(state["messages"])
        return {"messages": [response]}

    def should_continue(state: MessagesState) -> str:
        last = state["messages"][-1]
        if hasattr(last, "tool_calls") and last.tool_calls:
            return "tools"
        return END

    graph = StateGraph(MessagesState)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", should_continue)
    graph.add_edge("tools", "agent")

    return graph.compile(
        checkpointer=checkpointer,
        store=store,
    )
```

### 3. SSE streaming entry

```python
# agents/<name>/index.py
from ._llm import get_model
from ._graph import build_graph


async def handler(ctx):
    message = ctx.request.body.get("message", "")
    if not message:
        return {"error": "'message' is required"}, 400

    model = get_model(ctx.env)
    # ⭐ Must use to_langchain_tools to get real LangChain tool instances
    from langchain_core.tools import tool
    tools = ctx.tools.to_langchain_tools(tool) if ctx.tools else []

    # ⭐ LangGraph adapters (direct properties, snake_case)
    checkpointer = ctx.store.langgraph_checkpointer
    lg_store = ctx.store.langgraph_store

    graph = build_graph(model, tools, checkpointer=checkpointer, store=lg_store)

    async def gen():
        try:
            async for event in graph.astream(
                {"messages": [{"role": "user", "content": message}]},
                config={"configurable": {"thread_id": ctx.conversation_id}},
                stream_mode="messages",
            ):
                if ctx.request.signal.is_set():
                    break
                msg, metadata = event
                if hasattr(msg, "content") and msg.content and not getattr(msg, "tool_calls", None):
                    yield ctx.utils.sse({"type": "ai_response", "content": msg.content})
                elif hasattr(msg, "tool_calls") and msg.tool_calls:
                    for tc in msg.tool_calls:
                        yield ctx.utils.sse({"type": "tool_call", "name": tc["name"]})
                elif hasattr(msg, "type") and msg.type == "tool":
                    yield ctx.utils.sse({
                        "type": "tool_result",
                        "name": getattr(msg, "name", ""),
                        "content": str(msg.content)[:500],
                    })
        except Exception as e:
            if not ctx.request.signal.is_set():
                yield ctx.utils.sse({"type": "error_message", "content": str(e)})
        yield b"data: [DONE]\n\n"

    return ctx.utils.stream_sse(gen())
```

---

## Memory

```python
# Direct properties on ctx.store (snake_case)
checkpointer = ctx.store.langgraph_checkpointer  # short-term thread state
lg_store = ctx.store.langgraph_store             # long-term KV

# Use conversation_id as thread_id
config = {"configurable": {"thread_id": ctx.conversation_id}}
```

> ⚠️ `langgraph_store.search()` does NOT perform vector retrieval — `score` is always `None`.

---

## Stream Modes

- `"messages"`: token-level stream (most common, ideal for SSE)
- `"updates"`: node-level stream (one emission per node completion)
- `"values"`: full state at every step (useful for debugging)

---

## Human-in-the-Loop

LangGraph supports `interrupt` / `resume`. When `interrupt()` is called inside a node, the graph pauses and raises `GraphInterrupt`. The Python runtime handles this gracefully (not treated as an error).

---

## Review Checklist

- [ ] `edgeone.json` sets `agents.framework: "langgraph"`
- [ ] `requirements.txt` includes `langgraph>=1.0.0`
- [ ] env from `ctx.env` — never `os.environ`
- [ ] `ctx.store.langgraph_checkpointer` + `ctx.store.langgraph_store` used (direct properties)
- [ ] `thread_id` = `ctx.conversation_id` in config
- [ ] Abort signal checked via `ctx.request.signal.is_set()`
- [ ] SSE uses `ctx.utils.stream_sse(gen())`
- [ ] Stream ends with `data: [DONE]\n\n`
