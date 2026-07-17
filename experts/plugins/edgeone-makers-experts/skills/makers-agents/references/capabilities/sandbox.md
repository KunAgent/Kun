# Sandbox (context.sandbox)

> Platform capability: `context.sandbox` provides sandboxed code execution, file operations, and browser automation.

---

## 0. First Principle: Use Runtime Injection, Don't Roll Your Own

- Inside Makers Agent templates, **always use the injected `context.sandbox` / `context.tools`** (Python: `ctx.sandbox` / `ctx.tools`).
- **Do not** re-parse tokens, hand-write `/v1/sandbox/*` requests, or manually construct a sandbox in business code.
- `context.sandbox` is **lazily loaded** on first access; auth / ProjectId / control-plane env are injected by the runtime or the CLI deploy pipeline. Template `.env` files **do not** need to carry sandbox tickets, PROJECT_ID, SANDBOX_API_BASE, or API_ENV.
- Only use `buildSandboxProxy` / `build_sandbox` for manual construction when **outside the Makers Agent runtime** and connecting an SDK directly to the control plane.

> ⚠️ Distinguish two classes of env:
> - `AI_GATEWAY_API_KEY` / `AI_GATEWAY_BASE_URL` are **business variables for the LLM gateway** (required by the agent)
> - Sandbox tickets (`sandbox.v1.*` sealed token) are **sandbox-auth variables** injected by the deploy pipeline; they are **not** AI Gateway variables

---

## ⚠️ Must-Read: Sandbox `/tmp/` Is Easily Lost Across Requests

**This is a platform-level characteristic, not a per-framework limitation:**
- Even when the same `conversation_id` is sticky-routed to the same sandbox instance, files in the sandbox `/tmp/` **may be cleaned between requests**.
- Scenario: on the first `/chat` request the user uploads an image to `/tmp/foo.jpg` and the AI returns a result; on a later request asking "compress that image", `/tmp/foo.jpg` may already be gone.

**Correct approach (Route B / Claude SDK template pattern):**
1. Cache uploaded files on the backend in a module-level `Map<conversationId, Array<{ name, base64 }>>`
2. At the start of every request, re-write the cached files back to the sandbox at `/tmp/<name>`
3. This way the AI can always find the files regardless of whether `/tmp/` was cleaned

**Anti-patterns:**
- Assuming `/tmp/foo.jpg` still exists on the second request → AI hits `FileNotFoundError`, and the model may "hallucinate" a fake image as the response
- The system prompt must explicitly forbid this: on `FileNotFoundError`, the model must stop and never fabricate a file

---

## 1. Sandbox API (context.sandbox)

| Module | Method | Notes |
|------|------|------|
| **commands** | `run(cmd, {cwd?, env?, user?, timeout?})` → `{stdout, stderr, exitCode}` | Shell execution; **timeout is in seconds**; also used to download/generate binary assets |
| **files** | `read` / `write` / `list` / `makeDir` / `exists` / `remove` | ⚠️ `write(path, content)` **only accepts UTF-8 strings**; binary content must be produced inside the sandbox via `commands.run('base64 -d ...')` |
| **browser** | `goto` / `screenshot({fullPage?})` / `click` / `type` / `evaluate` / `getContent` / `close`; properties `cdpUrl` / `liveUrl` | CDP attached to a real Chromium (driven by Playwright); `screenshot` takes an **object** `{ fullPage?: boolean }` and returns `{ base64Image }` (the boolean form `screenshot(true)` is not a valid signature) |
| **runCode** ⭐ | `sandbox.runCode(code, {language?, timeout?})` → `{results, logs, error}` | Jupyter kernel; variables persist across calls. ⚠️ This is a **top-level method** on `context.sandbox` — there is no `code_interpreter` namespace, so do not write `sandbox.code_interpreter.runCode(...)` |
| Control | `getInfo()` / `extendTimeout(seconds)` / `kill()` / `envdAccessToken` / `getHost(port)` | Inspect instance, extend lifetime, terminate |

```typescript
// Inside an agent endpoint: use the injected sandbox directly
const result = await context.sandbox.commands.run('echo "hello"', { timeout: 10 })  // 10 seconds
await context.sandbox.files.write('/tmp/a.txt', 'utf8 content')
const shot = await context.sandbox.browser.screenshot({ fullPage: true })  // {base64Image}
const exec = await context.sandbox.runCode('print(1+1)', { language: 'python' })  // top-level method, {results, logs, error}
await context.sandbox.extendTimeout(900)                      // extend by 900 seconds
```

```python
result = await ctx.sandbox.commands.run('echo "hello"', timeout=10)
```

---

## 4. Debug Logging

- **Off** by default; when enabled, logs are emitted to **stderr** and **do not enter the model context**.
- Enable with the env var `MAKERS_AGENT_TOOLKIT_DEBUG=1` (or in Python `build_tools(..., debug=True)`).
- Automatically redacts token/auth/password/secret/key; screenshots only print summaries, not full base64.

---

## 5. Review Red Lines

- [ ] Agent endpoints use `context.sandbox` / `context.tools` directly, with **no** hand-written `/v1/sandbox/*` calls or manual token parsing
- [ ] Template `.env` does **not** require sandbox tickets / PROJECT_ID / SANDBOX_API_BASE / API_ENV (unless connecting via SDK directly)
- [ ] `agents.framework` in `edgeone.json` is set correctly (`claude-agent-sdk` / `openai-agents-sdk` / `langgraph` / `deepagents` / `crewai` — **no `basic`**) — **required for console icon display**
- [ ] Claude SDK templates prefer `context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true })` (recommended); manual assembly via `all()` is also acceptable
- [ ] `screenshot` is called with an object: `screenshot({ fullPage: true })`, not the boolean `screenshot(true)`
- [ ] `runCode` is invoked as the top-level `sandbox.runCode(...)`, **not** `sandbox.code_interpreter.runCode(...)` (that namespace does not exist)
- [ ] Binary / cached assets are generated inside the sandbox via `commands` (base64 -d), **not** misused through `files.write`
- [ ] The non-persistent nature of sandbox `/tmp/` is handled: the template wires up an in-process file cache plus re-upload on every request, and does not assume `/tmp/` is preserved
- [ ] System prompt explicitly forbids the AI from fabricating files when it sees `FileNotFoundError`
- [ ] Timeout values are in **seconds**, not mistakenly milliseconds
- [ ] `extendTimeout(seconds)` parameter is named `seconds`, not `s`
- [ ] For templates using `web_search` (Python), the sandbox python env already has primp/httpx/h2/lxml installed
- [ ] ⭐ Any template using the `web_search` tool (any language path) has `WSA_API_KEY` configured in project environment variables
