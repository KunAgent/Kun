# DeepAgents (Node)

> Use when: long-running tasks with automatic context compression, sub-agent orchestration, middleware (retry/call-limit).
> Core pattern: `createDeepAgent({ model, systemPrompt, tools, middleware })` + `agent.stream({ messages }, { streamMode })`.

---

## Dependencies

```bash
npm install deepagents@^1.9.0 @langchain/openai @langchain/core zod
```

`edgeone.json`:
```json
{
  "agents": {
    "framework": "deepagents"
  }
}
```

> `deepagents` and all `@langchain/*` packages are **auto-externalized** by the CLI — no manual `externalNodeModules` config needed.

---

## When to Pick DeepAgents

✅ Good fit:
- Long agent tasks (writing, research) — automatic context compression saves manual work
- Sub-agent orchestration with isolated context
- Multi-step research workflows (search → deep-read → cite → produce)

❌ Not a fit:
- Need fine-grained graph control (nodes, edges, conditional routing) → use LangGraph
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

### 2. Agent assembly with middleware

```typescript
import { createDeepAgent } from 'deepagents';

let _agent: any = null;
function getAgent(model: any) {
  if (_agent) return _agent;
  _agent = createDeepAgent({
    model,
    systemPrompt: 'You are a helpful research assistant.',
    tools: [internetSearch],
    maxTurns: 30,
  });
  return _agent;
}
```

### 3. Sub-agent orchestration

```typescript
import { createDeepAgent } from 'deepagents';

const researchAgent = createDeepAgent({
  model,
  systemPrompt: 'You are a research expert.',
  tools: [internetSearch, fetchWebpage],
});

const writerAgent = createDeepAgent({
  model,
  systemPrompt: 'You are a writer.',
  tools: [],
  subAgents: [
    {
      name: 'research_specialist',
      description: 'Use this for in-depth research tasks',
      agent: researchAgent,
    },
  ],
});
```

> Sub-agent state is automatically isolated — the parent only sees the final result.

### 4. Streaming SSE

```typescript
async function* eventStream(agent: any, message: string, conversationId: string, signal?: AbortSignal) {
  try {
    const stream = await agent.stream(
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

### 5. onRequest entry

```typescript
export async function onRequest(context: any) {
  const { request, env, conversation_id: conversationId, store } = context;
  const { message } = request?.body ?? {};
  if (!message) return new Response('Missing message', { status: 400 });

  const signal = request?.signal as AbortSignal | undefined;
  const model = await getModel(env);
  const agent = getAgent(model);

  return createSSEResponse((sig) => eventStream(agent, message, conversationId, sig), signal);
}
```

---

## Memory

DeepAgents reuses LangGraph's memory adapters:

```typescript
const checkpointer = context.store.langgraphCheckpointer;  // direct property
const lgStore = context.store.langgraphStore;              // direct property
```

---

## Review Checklist

- [ ] `edgeone.json` has `agents.framework: "deepagents"`
- [ ] Model/agent instances cached as module-level singletons
- [ ] env from `context.env` — never `process.env`
- [ ] `maxTurns` is set to cap agent loops
- [ ] Streaming uses `streamMode: 'messages'`
- [ ] Signal forwarded and checked inside the loop
- [ ] Stream ends with `data: [DONE]\n\n`
