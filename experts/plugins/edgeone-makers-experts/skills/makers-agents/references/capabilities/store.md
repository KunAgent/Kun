# Memory / Store Cheat Sheet (Five Frameworks → context.store Adapters)

> One-page reference: on EdgeOne Makers, which store entry point each Agent framework should use, how short-term/long-term memory is wired up, and how cloud-functions read it.

---

## 0. One-Sentence Mental Model

- `context.store` / `context.agent.store` is a **conversation-storage wrapper**, not a raw KV (no `get/set/delete/list`).
- It ships **official adapters** for each framework — use them directly; **do not roll your own `kvGet/kvSet`**.
- Agent endpoints get `context.store` (full `AgentMemory`); cloud-functions get `context.agent.store` (with `langgraphCheckpointer` / `langgraphStore` **stripped out**). The generic message API plus the openai/claude adapters are identical on both sides, **but the langgraph adapters are only available on agent endpoints** — see §1.

---

## 1. Two Entry Points (First Decide Which Directory the Endpoint Lives In)

```
Where is this endpoint built?
├─ agents/<name>/         → context.store        ✅ All adapters (incl. langgraph*)
└─ cloud-functions/<name>/ → context.agent.store  ⚠️ No langgraphCheckpointer / langgraphStore
```

| Dimension | agent endpoint | cloud-function |
|------|-----------|----------------|
| Directory | `agents/<name>/` | `cloud-functions/<resource>/` |
| Entry point | `context.store` | `context.agent.store` |
| Message API (`appendMessage` / `getMessages` etc.) | ✅ | ✅ |
| Conversation metadata (`getConversation` / `updateConversation` etc.) | ✅ | ✅ |
| `openaiSession` / `claudeSessionStore` | ✅ | ✅ |
| `langgraphCheckpointer` / `langgraphStore` | ✅ | ❌ **Explicitly stripped by the runtime** |

> ⚠️ **`context.store` is a conversation-oriented storage abstraction** — designed for message history, session state, conversation metadata (title, tags, summary, user preferences). Both `context.store` (agent endpoints) and `context.agent.store` (cloud-functions) point to the **same data**. It is NOT a general-purpose relational database — for complex queries, aggregation, or user management, use an external database.

> ⭐ **Critical difference**: a cloud-function's `context.agent.store` does **not** include `langgraphCheckpointer` / `langgraphStore` — the runtime strips them. Calling `store.langgraphStore.get(...)` inside a cloud-function throws `Cannot read properties of undefined`. Endpoints that need langgraph operations **must live under `agents/`** and use `context.store`.

---

## 2. Five-Framework Adapter Matrix (Core Cheat Sheet)

| Framework | Short-term memory | Long-term memory | Adapter access | Notes |
|------|---------|---------|-------------|------|
| **Claude Agent SDK** ⭐ | SDK session (resume/fork) | Store messages + metadata | `context.store.claudeSessionStore()` (**no args**) | **Standalone usage**, its own world — do not graft langgraph onto it |
| **OpenAI Agents SDK** | SDK Session (auto-prepend) | Store messages + metadata | `context.store.openaiSession(convId)` | Don't manually concatenate history |
| **LangGraph** | `langgraphCheckpointer` | `langgraphStore` | `context.store.langgraphCheckpointer` / `.langgraphStore` | Direct properties; thread_id = conversation_id |
| **DeepAgents** | Reuses LangGraph checkpointer | LangGraph store + filesystem | Same as LangGraph | Essentially LangGraph |
| **Bare model / custom loop | `appendMessage`/`getMessages` | Messages + metadata | Use the message API directly | Convert input via `toOpenAIInput`/`toAnthropicMessages` |

> ⭐ **Why Claude SDK is in its own row**: it goes through `claudeSessionStore()` to plug into the SDK's own session (resume/fork), which is a completely different mechanism from LangGraph's checkpointer+store pair. The multimodal template uses this route — don't conflate them during review.

---

## 3. API Signature Essentials (**single-object input — do not use two-arg form**)

⚠️ Older examples mistakenly wrote the signature as `getMessages(convId, { limit })`. **The actual signature takes a single-object input**:

```typescript
// ✅ Correct
await store.appendMessage({
  conversationId: convId,
  role: 'user',
  content: 'hi',
  metadata: { ... },        // optional
  userId: 'u_123',          // optional
});

const msgs = await store.getMessages({
  conversationId: convId,
  limit: 50,                // 1~100
  order: 'asc',             // optional
  after: cursor,            // optional
  before: cursor,           // optional
});

await store.updateMessage({ conversationId, messageId, content: '...' });
await store.deleteMessage({ conversationId, messageId });
await store.clearMessages({ conversationId });
```

Conversation metadata:

```typescript
await store.getConversation(convId);
await store.updateConversation(convId, { metadata: { ... } });   // shallow merge
await store.listConversations({ limit: 20, after: cursor });
await store.deleteConversation(convId);
```

Format conversion:

```typescript
const oaInput = store.toOpenAIInput(msgs);
const anthropicMsgs = store.toAnthropicMessages(msgs);
```

---

## 4. Copy-Paste Snippets

### Bare model / custom loop — read & store history
```typescript
const { store, conversation_id } = context;

const history = await store.getMessages({
  conversationId: conversation_id,
  limit: 50,
});
const modelInput = store.toOpenAIInput(history);

await store.appendMessage({
  conversationId: conversation_id,
  role: 'user',
  content: body.message,
});
await store.appendMessage({
  conversationId: conversation_id,
  role: 'assistant',
  content: finalText,
});
```

### Claude Agent SDK — Route B
```typescript
const sessionStore = context.store.claudeSessionStore();   // no args
// Wires into Claude SDK session persistence; multi-user is keyed by conversation_id, reuse via resume
```

### OpenAI Agents SDK
```typescript
import { run, Agent } from '@openai/agents';
const session = context.store.openaiSession(context.conversation_id);
const agent = new Agent({ name: 'Assistant', instructions: '...', tools, model });
const result = await run(agent, message, { stream: true, session, signal });
```

### LangGraph / DeepAgents
```typescript
const checkpointer = context.store.langgraphCheckpointer;  // direct property
const lgStore = context.store.langgraphStore;              // direct property
const graph = workflow.compile({ checkpointer, store: lgStore });
await graph.invoke(input, { configurable: { thread_id: context.conversation_id } });
```

### cloud-function — regular endpoint
```typescript
export async function onRequest(context: any) {
  const store = context.agent?.store;          // ⚠️ not context.store
  if (!store) return Response.json({ ok: false });

  const conversationId = context.request.body?.conversation_id || '';

  // ✅ Read conversation history (for display in frontend)
  const messages = await store.getMessages({ conversationId, limit: 50, order: 'asc' });
  return Response.json({ conversation_id: conversationId, messages });

  // ❌ Do NOT use the langgraph adapters inside a cloud-function:
  //    the runtime has explicitly stripped them; store.langgraphStore === undefined
  //    Endpoints that need langgraph KV must live under agents/<name>/ and use context.store.

  return Response.json({ ok: true, prefs });
}
```

---

## 5. Limits Cheat Sheet

| Item | Value |
|----|-----|
| `getMessages` limit | 1 ~ 100 |
| Max messages per conversation | 10,000 |
| Max content size per message | 50MB |
| `langgraphStore.search` | No vector search; `score` is always undefined |
| `updateConversation` metadata | Shallow merge (top-level overwrite) |
| `appendMessage` / `getMessages` signature | Single-object input `{ conversationId, ... }` |

---

## 6. Choosing the Right Storage

`context.store` is one of several storage options available on EdgeOne Makers. Choose based on your data type:

### Storage Decision Guide

| Data type | Recommended storage | Why |
|-----------|-------------------|-----|
| Conversation history / messages | `context.store` | Built-in, zero-config, designed for this |
| Agent session state / checkpoints | `context.store` (langgraphCheckpointer) | Framework-native integration |
| Conversation metadata (title, summary, tags) | `context.store` (updateConversation) | Lightweight, per-conversation |
| Simple key-value pairs | [EdgeOne Makers KV](https://cloud.tencent.com/document/product/1552/127420) | Fast, edge-distributed, string values |
| File / blob storage (images, PDFs, large objects) | [EdgeOne Makers Blob](https://cloud.tencent.com/document/product/1552/131425) | Object storage, supports large files |
| Structured business data (users, products, orders) | External database (Supabase, Neon, PlanetScale, etc.) | Relational queries, indexes, joins |
| Vector / semantic search | External vector store (Supabase pgvector, Pinecone, etc.) | `langgraphStore.search` has no vector search |

### Default behavior for AI assistants

**Default: use `context.store` to implement the feature first.** After implementation is complete, inform the user about alternative storage options if their use case may benefit from them:

> ✅ Done! I've implemented this using `context.store` (the platform's built-in conversation storage).
>
> FYI: if your project grows to need more advanced storage, EdgeOne Makers also offers:
> - **[KV](https://cloud.tencent.com/document/product/1552/127420)** — edge-distributed key-value store (fast reads, simple data)
> - **[Blob](https://cloud.tencent.com/document/product/1552/131425)** — object/file storage (images, PDFs, large files)
> - **Supabase / external DB** — for relational data with queries, indexes, and joins

### `context.store` Fit Boundaries

| Use case | Fit? | Notes |
|------|-------|------|
| Conversation/dialog history (≤10,000 messages) | ✅ | Primary use case |
| Agent execution state / thread snapshots | ✅ | `langgraphCheckpointer` |
| Conversation-level metadata (summary, preferences) | ✅ | `updateConversation` metadata |
| Simple key-value within langgraph | ✅ | `langgraphStore.get/put` |
| Structured queries (WHERE, JOIN, ORDER BY) | ❌ | Use external database |
| Semantic / full-text search | ❌ | Use external vector store |
| Large files / binaries | ❌ | Use Blob storage |

**Key cross-framework sharing rule**: each adapter (`openaiSession` / `claudeSessionStore` / `langgraphStore` / generic `appendMessage`) writes into its own namespace and cannot see the others. To share data across frameworks, **pick one entry point as the source of truth**. Do not expect adapters to interoperate automatically.

---

## Python Store API (Route E and future Python routes)

The Python runtime provides the same `ctx.store` (`ConversationMemory`) with **identical data layout**, but uses Python naming conventions:

### Node ↔ Python Method Mapping

| Node (TS) | Python | Notes |
|-----------|--------|-------|
| `store.appendMessage({ conversationId, role, content, metadata })` | `await ctx.store.append_message(conversation_id, role, content, metadata=None)` | Positional args (not single-object) |
| `store.getMessages({ conversationId, limit, order })` | `await ctx.store.get_messages(conversation_id, limit=20, order="asc")` | Default ascending |
| `store.updateMessage({ messageId, content, metadata })` | `await ctx.store.update_message(message_id, content=..., metadata=...)` | |
| `store.deleteMessage({ messageId })` | `await ctx.store.delete_message(message_id)` | |
| `store.clearMessages({ conversationId })` | `await ctx.store.clear_messages(conversation_id)` | |
| `store.getConversation(id)` | `await ctx.store.get_conversation(conversation_id)` | |
| `store.updateConversation(id, { metadata })` | `await ctx.store.update_conversation(conversation_id, metadata={})` | Shallow merge |
| `store.listConversations({ limit, order })` | `await ctx.store.list_conversations(limit=20, order="desc")` | |
| `store.deleteConversation(id)` | `await ctx.store.delete_conversation(conversation_id)` | |
| `store.toOpenAIInput(messages)` | `ctx.store.to_openai_input(messages)` | Sync (no await) |
| `store.toAnthropicMessages(messages)` | `ctx.store.to_anthropic_messages(messages)` | Sync (no await) |
| `store.langgraphCheckpointer` | `ctx.store.langgraph_checkpointer` | Direct property (snake_case) |
| `store.langgraphStore` | `ctx.store.langgraph_store` | Direct property (snake_case) |

### Python Example

```python
async def handler(ctx):
    # Append user message
    msg_id = await ctx.store.append_message(ctx.conversation_id, "user", "Hello!")

    # Get history (ascending = oldest first, ready for prompt)
    messages = await ctx.store.get_messages(ctx.conversation_id, limit=50)

    # Convert to OpenAI format for model input
    openai_msgs = ctx.store.to_openai_input(messages)

    # LangGraph adapters (same rules: only in agent endpoints, not cloud-functions)
    checkpointer = ctx.store.langgraph_checkpointer
    lg_store = ctx.store.langgraph_store
```

> ⚠️ **Same constraint applies**: `ctx.store.langgraph_checkpointer` and `ctx.store.langgraph_store` are only available in agent endpoints (`agents/<name>/`). The Python runtime applies the same stripping logic for cloud-function endpoints.

---

## 7. Review Red Lines (Spot Issues in 5 Seconds)

- [ ] Agent endpoints use `context.store`, cloud-functions use `context.agent.store` — is the entry point correct?
- [ ] Are `appendMessage` / `getMessages` called with **single-object input**, not `(convId, options)` two args?
- [ ] Does Claude SDK use `claudeSessionStore()` (no args), and **not** mistakenly graft langgraph onto it?
- [ ] **No** home-rolled `kvGet/kvSet` simulating KV via `clearMessages+appendMessage`?
- [ ] **No** pseudo-fallback like `store?.langgraphStore ?? store`? (Inside a cloud-function, `langgraphStore` is undefined; the fallback hands back the store itself, and the next `.get` call will crash.)
- [ ] Is history stored as multiple `appendMessage` records, **not** stuffed into a single message's content field?
- [ ] Is the model fed via `toOpenAIInput`/`toAnthropicMessages`, **not** a hand-built array?
- [ ] Business data (user profiles, settings, files) is stored in an external database — NOT crammed into `context.store`?
- [ ] No process-local `new Map()` cache mistaken for a persistence layer?
- [ ] ⚠️ Endpoints that need `langgraphStore.get/put/delete` are **placed under `agents/`**, not accidentally dropped into `cloud-functions/` (the runtime strips langgraph adapters there)?
- [ ] Structured business data that needs querying / sorting / aggregation has not been crammed into the store (that's MySQL's job)?
- [ ] You are not relying on `langgraphStore.search` for semantic / full-text retrieval (it has no vector search)?
- [ ] When sharing data across frameworks, a **single entry point** has been chosen as the source of truth — no expectation that different adapter namespaces will interoperate automatically?
