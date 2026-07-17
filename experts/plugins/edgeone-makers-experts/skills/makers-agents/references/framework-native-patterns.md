# Native Code Patterns Across Five Frameworks (Migration Reference)

> ⚠️ **Purpose**: This document shows the **official native patterns** for each Agent framework (i.e. what they look like *without* EdgeOne Makers injection).
> **Do NOT copy these patterns into Makers templates** — on Makers, models go through the `context.env` gateway, tools come from `context.tools`, and storage comes from `context.store`.
> Use this file to: ① understand the native shape of each framework, ② see by contrast what Makers injection saves you, ③ help teammates migrate from native usage to Makers.
> For the actual Makers patterns you should write, see `langchain-route.md`, `claude-sdk-route.md`, and `platform-conventions.md`.

---

## 0. Framework Positioning and Officially Recommended Path

| Framework | Positioning | Onboarding Priority |
|-----------|-------------|--------------------|
| DeepAgents | A batteries-included harness on top of LangGraph: automatic context compaction, virtual FS, sub-agents | ⭐ Top pick for getting started |
| LangChain `createAgent` | High-level wrapper with automatic tool loop + middleware | Second choice |
| LangGraph | Low-level graph orchestration: Persistence / HITL / Streaming / Durable | Drop down only for complex scenarios |
| OpenAI Agents SDK | Lightweight Agent runtime (Swarm successor): Handoff / Guardrails | Multi-agent collaboration |
| Claude Agent SDK | Anthropic Messages API + Tool Use, the most direct path | Edge-friendly |

Officially recommended order: **DeepAgents (highest level) → LangChain createAgent → LangGraph (lowest level)**, dropping down only as needed.

---

## 1. LangGraph

**Core conventions**
- Python: define State with `TypedDict + Annotated Reducer`; production checkpointer must be `AsyncPostgresSaver` — `MemorySaver` is for demos only
- TypeScript: use `MessagesAnnotation` (built-in reducer), cleaner than hand-written TypedDict
- Stream: `streamMode: "messages"` streams tokens; `streamMode: "updates"` streams node-state updates
- Must use `runtime = 'nodejs'` — Edge Runtime is not supported

```typescript
// Native pattern (@langchain/langgraph)
import { StateGraph, MessagesAnnotation, START } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { MemorySaver } from '@langchain/langgraph'

const modelWithTools = model.bindTools(tools)
const toolNode = new ToolNode(tools)

async function agentNode(state: typeof MessagesAnnotation.State) {
  return { messages: [await modelWithTools.invoke(state.messages)] }
}
function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | '__end__' {
  const last = state.messages[state.messages.length - 1]
  return ('tool_calls' in last && (last.tool_calls as any[]).length) ? 'tools' : '__end__'
}

const graph = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode).addNode('tools', toolNode)
  .addEdge(START, 'agent').addConditionalEdges('agent', shouldContinue).addEdge('tools', 'agent')
  .compile({ checkpointer: new MemorySaver() })  // Swap in PostgresSaver for production
```

> **→ How the Makers version differs**: the model goes through the `context.env` gateway; tools come from `context.tools.all()` (after setting `agents.framework: 'langgraph'` or `'deepagents'` in `edgeone.json`); checkpointer/store come from `context.store.langgraphCheckpointer` / `context.store.langgraphStore` (direct properties); thread_id = conversation_id.

---

## 2. OpenAI Agents SDK

**Core conventions**
- Decorate tools with `@function_tool` (Python); the docstring becomes the description automatically
- Run guardrails in parallel (with Pydantic structured output) — keep them out of the main Agent loop
- Use Handoff for multi-agent collaboration
- Use a Session for multi-turn conversations (Python `SqlAlchemySession`); do not stitch history manually

```python
from agents import Agent, Runner, handoff, function_tool, input_guardrail

@function_tool
def search_web(query: str) -> str:
    """Search the web for information about a given topic."""
    return f"Search results for: {query}"

billing_agent = Agent(name="Billing", instructions="Handle billing.", tools=[search_web])
triage_agent = Agent(
    name="Triage", instructions="Route to specialist.",
    handoffs=[handoff(billing_agent, tool_name_override="to_billing")],
    input_guardrails=[safety_check],
)
```

```typescript
// New in 2026: @openai/agents (run a full Agent directly in Node)
import { Agent, Runner } from '@openai/agents'
const agent = new Agent({ name: 'Assistant', instructions: '...', tools, model })
// Streaming: Runner.runStreamed().streamEvents()
//   event.type === 'run_item_stream_event'      → text output
//   event.type === 'agent_updated_stream_event' → Handoff switch
```

> **→ How the Makers version differs**: tools come from `context.tools.all()` (with `agents.framework='openai-agents-sdk'`); session comes from `context.store.openaiSession(conversationId)`, which auto-prepends history; env goes through `context.env` — never read `process.env`.

---

## 3. CrewAI

**Core conventions**
- Configure Agent/Task in **YAML** (with the `@CrewBase` decorator) — do not hard-code in Python
- Set `max_iterations` (default 15; lower it in production)
- For long-running tasks, use `kickoff_async()` + an async job + polling
- ⚠️ **CrewAI has no official JS SDK** — it is Python-only, with no native Node option

```python
# config/agents.yaml — keep role descriptions clear and specific; use {topic} for dynamic interpolation
# crew.py
from crewai import Agent, Crew, Task
from crewai.project import CrewBase, agent, task, crew

@CrewBase
class ResearchCrew:
    @agent
    def researcher(self) -> Agent:
        return Agent(config=self.agents_config['researcher'], verbose=True)
    @crew
    def crew(self) -> Crew:
        return Crew(agents=self.agents, tasks=self.tasks, memory=True)  # memory=True for unified memory
```

> **→ How the Makers version differs**: tools come from `context.tools.all()` (with `agents.framework='crewai'`); memory uses CrewAI's built-in `memory=True`; because there is no JS SDK, CrewAI templates require a Python runtime.

---

## 4. DeepAgents / LangChain createAgent

**Core conventions**
- Top pick for getting started; `create_deep_agent` (Python) handles context compaction automatically — no manual `trim_messages`
- In TypeScript, use `createAgent` from `langchain` — simpler than going straight to LangGraph.js
- Extend behavior via middleware (logging / guardrail); each middleware should do exactly one thing
- LangSmith: set `LANGSMITH_TRACING=true` for automatic tracing

```python
from deepagents import create_deep_agent
from langchain_anthropic import ChatAnthropic
agent = create_deep_agent(model=ChatAnthropic(model="claude-sonnet-4-5"), tools=[...])
# Streaming: agent.astream_events(..., version="v2") → event["event"]=="on_chat_model_stream"
```

```typescript
import { createAgent, tool } from 'langchain'
const agent = createAgent({
  model: 'anthropic/claude-sonnet-4-5', tools: [getWeather],
  middleware: [loggingMiddleware(), guardrailMiddleware({ maxOutputLength: 4096 })],
})
```

> **→ How the Makers version differs**: see `langchain-route.md`; the model goes through the gateway (`context.env`), tools come from `context.tools.all()` (with `agents.framework='deepagents'` or `'langgraph'`), and memory reuses the LangGraph adapters (direct properties `langgraphCheckpointer` / `langgraphStore`).

---

## 5. Claude Agent SDK

**Core conventions**
- Anthropic Messages API + Tool Use is the most direct way to build an Agent on the edge
- ⚠️ `claude-code` itself is a CLI and is not suitable for direct deployment; implement logic with `@anthropic-ai/claude-agent-sdk`
- Use the SDK session (resume/fork) for multi-turn conversations

```typescript
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()
// Tool Use multi-turn loop: call messages.create → check stop_reason === 'tool_use'
//   → execute the tool → append tool_result back into messages → call again, until no more tool_use
```

> **→ How the Makers version differs**: see `claude-sdk-route.md`; after setting `agents.framework: 'claude-agent-sdk'` in `edgeone.json`, the recommended way to wire tools is `context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true })` (returns `{name,tools,allowedTools}` — a Claude SDK-specific capability), or feed `context.tools.all()` into `createSdkMcpServer({ name, tools, alwaysLoad: true })`; session comes from `context.store.claudeSessionStore()` (no arguments — ⭐ standalone usage; do not wrap it with langgraph).

---

## 6. Native → Makers Injection Cheat Sheet

| Aspect | Framework Native | EdgeOne Makers Injected |
|--------|------------------|-------------------------|
| Model | You instantiate `new ChatAnthropic()` / `new Anthropic()` yourself | Injected via the `context.env` AI Gateway (**do not** use `process.env`) |
| Tools | You define tools yourself / `@function_tool` | `context.tools.all()` (first set `agents.framework` in `edgeone.json` — that determines tool shape) |
| Sandbox | You spin up containers/processes yourself | `context.sandbox` (commands/files/browser/code_interpreter) |
| Short-term memory | checkpointer / SDK session | The matching adapter on `context.store` |
| Long-term memory | PostgresSaver / store | `context.store.langgraphStore` / conversation metadata |
| Entry point | `app/api/route.ts` + `POST(req)` | `agents/<name>/` + `onRequest(context)` |
| Streaming | You assemble SSE yourself | `createSSEResponse` from `_shared.ts` + a unified event protocol |
| Route registration | You maintain config yourself | Auto-scanned by the CLI at build time — **no** manual maintenance needed |
