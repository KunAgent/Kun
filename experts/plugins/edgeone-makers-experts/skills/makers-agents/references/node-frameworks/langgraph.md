# LangGraph (Node)

> Use when: fine-grained graph orchestration, custom node/edge control, human-in-the-loop (interrupt/resume), persistent thread state.
> Core pattern: `StateGraph` + `compile({ checkpointer, store })` + `graph.stream()` → SSE.

---

## Dependencies

```bash
npm install @langchain/langgraph @langchain/openai @langchain/core zod
```

`edgeone.json`:
```json
{
  "agents": {
    "framework": "langgraph"
  }
}
```

> All `@langchain/*` packages are **auto-externalized** by the CLI — no manual `externalNodeModules` config needed.

---

## When to Pick LangGraph

✅ Good fit:
- Need fine-grained control over execution flow (nodes, edges, conditional routing)
- Human-in-the-loop workflows (`interrupt` / `resume`)
- Need persistent thread state (`langgraphCheckpointer`) + long-term KV (`langgraphStore`)
- Complex multi-node pipelines with subgraphs

❌ Not a fit:
- Simple single-agent tasks → use DeepAgents (higher-level, less boilerplate)
- Need a sandbox to run code → Route B (Claude Agent SDK)
- Multi-agent handoff → Route C (OpenAI Agents SDK)

---

## Core Pattern

### 1. Model initialization

```typescript
import { ChatOpenAI } from '@langchain/openai';

const MODEL_NAME = '@makers/deepseek-v4-flash';

let _model: ChatOpenAI | null = null;
function getModel(env: Record<string, string>): ChatOpenAI {
  if (_model) return _model;
  _model = new ChatOpenAI({
    model: MODEL_NAME,
    apiKey: env.AI_GATEWAY_API_KEY,
    configuration: { baseURL: env.AI_GATEWAY_BASE_URL },
    temperature: 0,
    timeout: 300_000,
  });
  return _model;
}
```

### 2. Graph construction

```typescript
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';

function buildGraph(model: any, tools: any[], checkpointer: any, store: any) {
  const modelWithTools = model.bindTools(tools);
  const toolNode = new ToolNode(tools);

  async function agentNode(state: typeof MessagesAnnotation.State) {
    return { messages: [await modelWithTools.invoke(state.messages)] };
  }

  function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | '__end__' {
    const last = state.messages[state.messages.length - 1] as any;
    return (last.tool_calls?.length) ? 'tools' : '__end__';
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('tools', 'agent')
    .compile({
      checkpointer,   // ⭐ context.store.langgraphCheckpointer
      store,          // ⭐ context.store.langgraphStore
    });
}
```

### 3. Streaming SSE

```typescript
async function* eventStream(graph: any, message: string, conversationId: string, signal?: AbortSignal) {
  try {
    const stream = await graph.stream(
      { messages: [{ role: 'user', content: message }] },
      { streamMode: 'messages', signal, configurable: { thread_id: conversationId } },
    );
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const [msg] = chunk;
      if (msg.tool_call_chunks?.length) {
        for (const tc of msg.tool_call_chunks) {
          if (tc.name) yield sseEvent({ type: 'tool_call', name: tc.name });
        }
      } else if (msg.type === 'tool') {
        yield sseEvent({ type: 'tool_result', name: msg.name, content: msg.text?.slice(0, 500) ?? '' });
      } else if (msg.text) {
        yield sseEvent({ type: 'ai_response', content: msg.text });
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError' && !signal?.aborted) {
      yield sseEvent({ type: 'error_message', content: (e as Error).message });
    }
  }
  yield 'data: [DONE]\n\n';
}
```

### 4. onRequest entry

```typescript
export async function onRequest(context: any) {
  const { request, env, conversation_id: conversationId, store } = context;
  const { message } = request?.body ?? {};
  if (!message) return new Response('Missing message', { status: 400 });

  const signal = request?.signal as AbortSignal | undefined;
  const model = await getModel(env);

  // ⭐ Must use toLangChainTools to get real StructuredTool instances
  const { tool } = await import('@langchain/core/tools');
  const tools = context.tools.toLangChainTools(tool);

  // ⭐ LangGraph adapters (direct properties)
  const checkpointer = store.langgraphCheckpointer;
  const lgStore = store.langgraphStore;

  const graph = buildGraph(model, tools, checkpointer, lgStore);
  return createSSEResponse((sig) => eventStream(graph, message, conversationId, sig), signal);
}
```

---

## Memory

```typescript
// Direct properties on context.store (not methods)
const checkpointer = context.store.langgraphCheckpointer;  // short-term thread state
const lgStore = context.store.langgraphStore;              // long-term KV

// Use conversation_id as thread_id
await graph.invoke(input, { configurable: { thread_id: context.conversation_id } });
```

> ⚠️ `langgraphStore.search` does NOT perform vector retrieval — `score` is always `undefined`.

---

## Stream Modes

- `'messages'`: token-level stream (most common, ideal for SSE)
- `'updates'`: node-level stream (one emission per node completion)
- `'values'`: full state at every step (useful for debugging)

---

## Human-in-the-Loop

LangGraph supports `interrupt` / `resume` for human-in-the-loop flows. When `interrupt()` is called inside a node, the graph pauses and raises `GraphInterrupt`. The runtime handles this gracefully (not treated as an error).

---

## Review Checklist

- [ ] `edgeone.json` has `agents.framework: "langgraph"`
- [ ] env from `context.env` — never `process.env`
- [ ] `context.store.langgraphCheckpointer` + `context.store.langgraphStore` used (direct properties)
- [ ] `thread_id` = `context.conversation_id` in `configurable`
- [ ] Signal forwarded and checked inside the loop
- [ ] Stream ends with `data: [DONE]\n\n`
- [ ] Graph compiled at module level or cached (not rebuilt per request)
