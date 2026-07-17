# Route B: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

> Use when: multi-step agentic flows, sandbox code execution, file processing, session memory.
> Core pattern: `query()` + dual MCP servers (sandbox + custom tools) + session binding + SSE side channel.

---

## Dependencies

```bash
npm install @anthropic-ai/claude-agent-sdk zod
```

`edgeone.json`:
```json
{
  "agents": {
    "framework": "claude-agent-sdk"
  }
}
```

> `@anthropic-ai/claude-agent-sdk` is **auto-externalized** by the CLI — no manual `externalNodeModules` config needed.

---

## When to Use Route B

✅ Good fit:
- Need a sandbox to run code (Python/shell) and process uploaded files
- Need multi-turn session memory (resume session)
- Need custom MCP tools (e.g. `suggest_actions`, `deliver_file`)
- Complex multi-step agentic reasoning

❌ Not a fit:
- Plain text generation only → DeepAgents is simpler

---

## Core Pattern Walkthrough

### 1. Gateway env mapping (from `_model.ts`)
See `resolveModelName` + `collectGatewayEnv` in [`node-entry.md`](../platform/node-entry.md) §3. Key points:
- Map `AI_GATEWAY_*` to the `ANTHROPIC_*` variables the SDK expects
- Return a `Record` and inject it via `query()`'s `options.env`. **Do not read `process.env`** — agent endpoints disable `process.env`; always go through `context.env`.
- ⚠️ **Must include writable config directories** — the Claude CLI subprocess requires a writable `~/.claude` and temp directory. In the EdgeOne Makers serverless runtime, HOME is typically not writable — the SDK silently exits with zero output if it cannot initialise its config directory.

```typescript
const queryEnv = {
  ...collectGatewayEnv(ctxEnv),
  CLAUDE_CONFIG_DIR: '/tmp/claude-agent-sdk',  // writable config directory
  CLAUDE_CODE_TMPDIR: '/tmp',                  // writable temp directory
};
// Pass to query({ options: { env: queryEnv, ... } })
```

### 2. Defensive initialisation
```typescript
import { query, createSdkMcpServer, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { resolveModelName, collectGatewayEnv } from '../_model';
import { createLogger, sseEvent, createSSEResponse } from '../_shared';

const logger = createLogger('chat');

// Prevent the SDK's stdout observability from crashing the process on EPIPE
process.stdout.on('error', (err: any) => {
  if (err.code === 'EPIPE') return;
});
```
> **Principle**: the Claude Agent SDK writes to stdout internally, and on EdgeOne the pipe may close early — you must swallow EPIPE.

### 3. Session binding (conversation memory)
```typescript
/** Normalise an arbitrary conversationId into a valid UUID */
function normalizeUuid(id: string): string | null {
  if (!id) return null;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(id)) return id.toLowerCase();
  const hex = id.replace(/[^0-9a-f]/gi, '').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

/** Resume an existing session or start a new one */
async function resolveClaudeSessionBinding(
  sessionStore: any, conversationId: string, cwd: string
): Promise<{ resume?: string; sessionId?: string }> {
  const sessionId = normalizeUuid(conversationId);
  if (!sessionId) return {};
  try {
    const infoOptions: any = { dir: cwd };
    if (sessionStore?.load) infoOptions.sessionStore = sessionStore;
    const info = await getSessionInfo(sessionId, infoOptions);
    if (info) return { resume: sessionId };   // resume
  } catch { /* store unavailable */ }
  return { sessionId };                         // new session
}
```
> **Principle**: take `conversation_id` from `context.conversation_id`, falling back to the `makers-conversation-id` header.
>
> **Important**: Claude SDK has its own session/`resume`/`fork` mechanism via `context.store.claudeSessionStore()` (no-arg — unique to the Claude SDK). **Do not mix this with a langgraph checkpointer** — the two state models are incompatible. See [`langgraph.md`](./langgraph.md) for the langgraph-style alternative.

### 4. Sandbox readiness probe + file upload (with cold-start retry)
```typescript
// Sandbox may cold-start; probe with retry
let sandboxWorking = false;
if (sandbox) {
  try {
    await sandbox.commands.run('ls /tmp', { timeout: 10 });
    sandboxWorking = true;
  } catch {
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        await sandbox.commands.run('ls /tmp', { timeout: 10 });
        sandboxWorking = true; break;
      } catch { /* retry */ }
    }
  }
}

// File upload: strategy 1 (files.write + base64 -d) → strategy 2 (Python decode, supports chunking)
// See template _tools.ts for details. Key points:
// - Small files: write base64 with files.write, then `base64 -d` in shell
// - Large files (>150KB): chunk write + Python decode
// - All strategies fail → degrade to inline-text mode
```

See [`sandbox.md`](../capabilities/sandbox.md) for the full upload strategy reference.

### 5. File cache (working around the ephemeral sandbox)
```typescript
// Sandbox /tmp is ephemeral and lost between requests. Use a process-level
// cache and re-upload on every request.
const _sessionFileCache = new Map<string, Array<{ name: string; base64: string }>>();

// Merge new files with the cache (same-name overwrites)
if (conversationId && uploadedFiles.length > 0) {
  const mergedMap = new Map(cachedSessionFiles.map(f => [f.name, f]));
  uploadedFiles.forEach(f => mergedMap.set(f.name, f));
  _sessionFileCache.set(conversationId, Array.from(mergedMap.values()));
}
```
> ⚠️ **Critical**: the sandbox `/tmp/` is **per-request and easily lost** — there is no shared persistent FS between invocations. Route B templates **must** keep a process-level file cache and **re-upload on every request**. Even follow-up requests that carry no new files must re-upload everything previously cached for that conversation.

### 6. Custom MCP server (SSE side-channel pattern)
```typescript
// Key trick: tool handlers push events into sseQueue; the main loop drains
// the queue and yields after each step.
const sseQueue: string[] = [];

const customMcpServer = createSdkMcpServer({
  name: 'custom-tools',
  alwaysLoad: true,
  tools: [
    {
      name: 'suggest_actions',
      description: 'Present clickable action options to the user after analysing files.',
      inputSchema: {
        actions: z.array(z.object({
          id: z.string(), emoji: z.string(),
          title: z.string(), description: z.string(),
        })),
      },
      handler: async ({ actions }: { actions: any[] }) => {
        sseQueue.push(sseEvent({ type: 'suggest_actions', actions }));
        return { content: [{ type: 'text' as const, text: 'Suggestions displayed. Wait for user choice.' }] };
      },
    },
    {
      name: 'deliver_file',
      description: 'Deliver a processed file to the user for download.',
      inputSchema: {
        path: z.string(), filename: z.string(),
        description: z.string().optional(),
      },
      handler: async ({ path, filename, description }: any) => {
        let base64 = '';
        try {
          if (sandbox?.commands?.run) {
            const r = await sandbox.commands.run(`base64 -w 0 ${shellQuote(path)}`);
            base64 = (r.stdout || '').trim();
          }
        } catch (e) {
          return { content: [{ type: 'text' as const, text: `Error reading file: ${(e as Error).message}` }] };
        }
        if (!base64) return { content: [{ type: 'text' as const, text: `File not found: ${path}` }] };
        sseQueue.push(sseEvent({ type: 'file_output', base64, filename, description: description ?? '' }));
        return { content: [{ type: 'text' as const, text: `File "${filename}" delivered.` }] };
      },
    },
  ],
});
```
> **Core trick**: MCP tools cannot write to the HTTP stream directly. Use the `sseQueue` array as a side channel — tool handlers push to it, and the main `query()` loop drains and yields the queue after each step.

### 7. Assembling the `query()` main loop (with dual MCP servers)
```typescript
export async function onRequest(context: any) {
  // ⭐ Always read env from context.env, never process.env
  const ctxEnv = context.env ?? {};
  const body = context.request.body ?? {};
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return new Response(JSON.stringify({ error: "'message' is required" }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const signal = context.request.signal;
  const conversationId = context.conversation_id;
  const sandbox = context.sandbox ?? null;
  const store = context.store ?? null;

  // ... sandbox probe + file upload (with module-level cache, re-upload each time)
  //     + session binding (see above)

  // ⭐ Use toClaudeMcpServer to get the MCP bundle (name + tools + allowedTools)
  const edgeoneBundle = context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true });
  const edgeoneMcpServer = createSdkMcpServer(edgeoneBundle);

  async function* run(sig?: AbortSignal): AsyncGenerator<string> {
    const sessionBinding = await resolveClaudeSessionBinding(store, conversationId, process.cwd());

    const stream = query({
      prompt: message,
      options: {
        model: resolveModelName(ctxEnv),
        env: {
          ...collectGatewayEnv(ctxEnv),
          CLAUDE_CONFIG_DIR: '/tmp/claude-agent-sdk',
          CLAUDE_CODE_TMPDIR: '/tmp',
        },
        maxTurns: 30,
        mcpServers: {
          edgeone: edgeoneMcpServer,
          'custom-tools': customMcpServer,
        },
        allowedTools: edgeoneBundle.allowedTools,
        ...sessionBinding,
        abortController: sig ? { signal: sig } as any : undefined,
      },
    });

    for await (const msg of stream) {
      if (sig?.aborted) break;
      // First, drain SSE events pushed by custom tools
      while (sseQueue.length) yield sseQueue.shift()!;
      // Then handle model text / tool messages (dispatch by msg.type to ai_response/tool_call/...)
      // ...
    }
    while (sseQueue.length) yield sseQueue.shift()!;
    yield 'data: [DONE]\n\n';
  }

  return createSSEResponse(run, signal);
}
```

> ⭐ **About `context.tools.toClaudeMcpServer()`**: returns `{ name, tools, allowedTools }` (where `allowedTools` looks like `mcp__edgeone__commands`). This is the **required way** to wire platform tools on the Claude SDK route:
> ```typescript
> const bundle = context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true });
> const mcp = createSdkMcpServer(bundle);
> query({ prompt, options: { mcpServers: { [bundle.name]: mcp }, allowedTools: bundle.allowedTools } });
> ```
> Prerequisite: set `agents.framework: "claude-agent-sdk"` in `edgeone.json`.

### 8. Degrading when the sandbox is unavailable
```typescript
// Sandbox down → inline text-like files directly into the message
if (!sandboxWorking && uploadedFiles.length > 0) {
  let inlineContent = '\n\n--- FILE CONTENTS (sandbox unavailable) ---\n';
  for (const file of uploadedFiles) {
    const content = Buffer.from(file.base64, 'base64');
    if (canInlineFallbackFile(file.name, content)) {       // text-like only, no heavy binary noise
      inlineContent += `\n### File: ${file.name}\n\`\`\`\n${content.toString('utf8')}\n\`\`\`\n`;
    }
  }
  message = message + inlineContent;
}
```
> **Principle**: the sandbox is best-effort. Text files can degrade to inline content; for binaries that can't degrade, tell the model explicitly that they were skipped.

> Beyond `sandbox.runCode(...)` (top-level) and `sandbox.commands.run(...)`, the Claude SDK route can also use `screenshot({ fullPage: true })`, `context.tools.files()`, and `context.tools.browser()` — see [`sandbox.md`](../capabilities/sandbox.md).

---

## Route B Review Checklist
- [ ] `process.stdout` EPIPE swallowed
- [ ] `query()` has `maxTurns` set
- [ ] env injected via `collectGatewayEnv(context.env)`, **never `process.env`**
- [ ] Sandbox probe includes cold-start retry
- [ ] File upload has multiple strategies + fallback to inline text
- [ ] Cross-request files use a process-level cache + re-upload every time (sandbox `/tmp/` is easily lost)
- [ ] Custom tools use the `sseQueue` side channel; main loop drains it
- [ ] Sessions normalised with `normalizeUuid` + `getSessionInfo` to decide resume/new
- [ ] AbortSignal forwarded to `query()` and checked inside the loop
- [ ] `context.request.headers` accessed via `headers['x-foo']` indexing, **not** `.get('x-foo')`
- [ ] `edgeone.json` has `agents.framework: "claude-agent-sdk"`
- [ ] ⭐ Tools wired with `context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true })` → `createSdkMcpServer(bundle)`
- [ ] System prompt explicitly forbids the AI from fabricating files on `FileNotFoundError`
- [ ] ⭐ Frontend includes `makers-conversation-id` header on `/chat`; **omits** the header on `/stop` (uses body)

See [`review-checklist.md`](../review-checklist.md) for the cross-route checklist.

---

## Frontend Call Example (chat + stop + file upload)

```typescript
// Frontend code example
const conversationId = getOrCreateConversationId();   // UUID cached in localStorage

// 1. /chat: header required
const chatResp = await fetch('/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'makers-conversation-id': conversationId,         // ⭐ required
  },
  body: JSON.stringify({
    message: userInput,
    files: uploadedFiles,    // [{ name, base64 }]
  }),
});

// 2. /stop: ⚠️ NEVER send the header — pass via body
async function stopAgent() {
  await fetch('/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },  // no makers-conversation-id
    body: JSON.stringify({ conversation_id: conversationId }),
  });
}
```

---

## See Also


- Route C (OpenAI Agents): [`openai-agents.md`](./openai-agents.md)
- Route D (LangGraph + DeepAgents): [`langgraph.md`](./langgraph.md)
- Route E (CrewAI): [`crewai.md`](../python-frameworks/crewai.md)
- Platform conventions: [`node-entry.md`](../platform/node-entry.md)
- Sandbox & tools reference: [`sandbox.md`](../capabilities/sandbox.md)
- Review checklist: [`review-checklist.md`](../review-checklist.md)
