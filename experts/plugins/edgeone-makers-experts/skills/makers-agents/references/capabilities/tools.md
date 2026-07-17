# Tools Registry (context.tools)

> Covers: ToolsContext interface, agents.framework-driven shape, 5-framework integration, built-in tools inventory.

---

## 2. Tools Registry (context.tools)

`context.tools` is built by `toolkit.buildTools(framework, sandbox)` during lazy load, and **its shape is determined by `agents.framework` in `edgeone.json`**.

### 2.1 ToolsContext Interface (@edgeone/pages-agent-toolkit)

```typescript
interface ToolsContext {
  // —— Flat per-operation tool properties ——
  readonly commands: FrameworkTool;
  readonly files_read: FrameworkTool;
  readonly files_write: FrameworkTool;
  readonly files_list: FrameworkTool;
  readonly files_exists: FrameworkTool;
  readonly files_remove: FrameworkTool;
  readonly files_make_dir: FrameworkTool;
  readonly browser_fetch: FrameworkTool;
  readonly browser_screenshot: FrameworkTool;
  readonly browser_click: FrameworkTool;
  readonly browser_type: FrameworkTool;
  readonly browser_evaluate: FrameworkTool;
  readonly code_interpreter: FrameworkTool;
  readonly web_search: FrameworkTool;
  // —— Direct access methods ——
  all(): FrameworkTool[];
  get(name: string): FrameworkTool | undefined;
  files(): FrameworkTool[];
  browser(): FrameworkTool[];
  // —— Framework conversion helpers ——
  toLangChainTools(toolFactory, names?): FrameworkTool[];      // inject LangChain tool() factory
  toCrewAITools(baseTool, names?): FrameworkTool[];            // inject CrewAI BaseTool class
  toClaudeMcpServer(name?, options?): ClaudeMcpServerBundle;   // { name, tools, allowedTools }
}
```

> The `toLangChainTools` and `toCrewAITools` helpers allow templates to inject the framework class/factory at call time, so the toolkit itself does not depend on LangChain or CrewAI. In most cases, `all()` is sufficient since tools are already pre-adapted based on `agents.framework`.

### 2.2 Three Types of Tool Access

`context.tools` / `ctx.tools` provides three categories of access methods:

| Category | Methods | Usage |
|----------|---------|-------|
| **Direct tools** | `all()`, `get(name)`, `files()`, `browser()` | Returns tools pre-adapted for the current `framework`. Most frameworks just use `all()` directly. |
| **Claude MCP helper** | `toClaudeMcpServer(name?, options?)` / `to_claude_mcp_server(...)` | Generates `{ name, tools, allowedTools }` for Claude Agent SDK MCP server registration |
| **LangChain helper** | `toLangChainTools(toolFactory, names?)` | Injects LangChain `tool()` factory. Used by LangGraph / DeepAgents when explicit conversion is needed. |
| **CrewAI helper** | `toCrewAITools(baseTool, names?)` | Injects CrewAI `BaseTool` class. Used by CrewAI when explicit conversion is needed. |

> **OpenAI Agents SDK has no dedicated `toXXX` helper** — `all()` already returns tools in OpenAI function format (`{ type:'function', name, parameters, execute }`), ready to pass to `new Agent({ tools })`.

### 2.3 Framework-Specific Tool Wiring

⚠️ **Different frameworks require different methods to get tools.** Using the wrong method may result in tools that don't work (e.g., duck-type objects that fail `instanceof` checks).

| `agents.framework` | ⭐ Recommended method | Why |
|---------------------|----------------------|-----|
| `claude-agent-sdk` | `context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true })` | Returns `{ name, tools, allowedTools }` bundle for MCP registration |
| `openai-agents-sdk` | `context.tools.all()` | Returns real OpenAI function tool objects, ready to use |
| `langgraph` | `context.tools.toLangChainTools(tool)` | ⚠️ Must inject LangChain `tool` factory to produce real `StructuredTool` instances. `all()` returns duck-type objects that may fail. |
| `deepagents` | `context.tools.toLangChainTools(tool)` | ⚠️ Same as LangGraph — DeepAgents expects real LangChain tools. |
| `crewai` | `context.tools.toCrewAITools(BaseTool)` | ⚠️ Must inject CrewAI `BaseTool` class to produce real CrewAI tool instances. |

### 2.4 Code Examples Per Framework

**Claude Agent SDK (Node)**:
```typescript
// Recommended: toClaudeMcpServer
const bundle = context.tools.toClaudeMcpServer('edgeone', { alwaysLoad: true });
const mcp = createSdkMcpServer(bundle);
query({ prompt, options: { mcpServers: { [bundle.name]: mcp }, allowedTools: bundle.allowedTools } });
```

**OpenAI Agents SDK (Node)**:
```typescript
// all() works directly — tools are already in OpenAI function format
const tools = context.tools.all();
const agent = new Agent({ name: 'Assistant', tools, model });
```

**LangGraph / DeepAgents (Node)**:
```typescript
import { tool } from '@langchain/core/tools';

// ⭐ Must use toLangChainTools — inject the LangChain tool factory
const tools = context.tools.toLangChainTools(tool);
const modelWithTools = model.bindTools(tools);
const toolNode = new ToolNode(tools);
```

**CrewAI (Python)**:
```python
from crewai import BaseTool

# ⭐ Must use toCrewAITools — inject the CrewAI BaseTool class
tools = ctx.tools.to_crewai_tools(BaseTool)
agent = Agent(role="...", tools=tools, llm=llm)
```

**LangGraph / DeepAgents (Python)**:
```python
from langchain_core.tools import tool

# ⭐ Must use toLangChainTools
tools = ctx.tools.to_langchain_tools(tool)
model_with_tools = model.bind_tools(tools)
tool_node = ToolNode(tools)
```

### 2.5 Getting a Single Tool / Group

```typescript
// Node
const search = context.tools.get('web_search');    // single tool or undefined
const fileTools = context.tools.files();           // [files_read, files_write, ...]
const browserTools = context.tools.browser();      // [browser_fetch, browser_screenshot, ...]
```

```python
# Python
search = ctx.tools.get("web_search")
file_tools = ctx.tools.files()
browser_tools = ctx.tools.browser()
```

| Tool | Parameters | Notes |
|------|------|------|
| `commands` | cmd, cwd, env, timeout | One-shot shell; also used to download/generate binaries |
| `files_read` / `files_write` / `files_list` / `files_exists` / `files_remove` / `files_make_dir` | path (write also takes content) | Text-file CRUD; **use commands for binary** |
| `browser_fetch` / `browser_screenshot` / `browser_click` / `browser_type` / `browser_evaluate` | varies | Real Chromium |
| `code_interpreter` | language, code, timeout | Python/JS/R/Bash execution |
| `web_search` | query, maxResults, site | Tencent Cloud WSA search API; **does NOT use sandbox** — calls WSA API directly. ⚠️ **Requires `WSA_API_KEY` env var**. Supports optional `site` for domain-restricted search. |

### ⭐ web_search Configuration Requirements

If a template uses `context.tools.web_search` (or pulls this tool via `context.tools.all()` / `get('web_search')`), `WSA_API_KEY` **must** be configured in the project environment variables.

| Item | Description |
|----|------|
| Env var name (EdgeOne Makers) | `WSA_API_KEY` |
| Upstream service | [Tencent Cloud Web Search API (product 1806)](https://cloud.tencent.com/document/product/1806/130615) — a standalone service, separate product from EdgeOne |
| Console | <https://console.cloud.tencent.com/wsapi/index> |
| Where to configure | EdgeOne project environment variables (same level as `AI_GATEWAY_API_KEY`) |
| How template code reads it | **No explicit reference needed** — the toolkit's `SimpleSearch` class reads `WSA_API_KEY` from `process.env` at call time (this is an exception to the "no process.env" rule — the toolkit itself is allowed to read it) |
| Failure symptom | `web_search` calls fail with 401 / auth errors |

#### Steps to Obtain

1. Open the [Tencent Cloud Web Search API console](https://console.cloud.tencent.com/wsapi/index)
2. Overview page → "Service API KEY" section → click "Create API KEY"
3. Enter a key name → confirm → **download the CSV or copy immediately** (cannot be viewed again after closing the dialog)
4. Back in your EdgeOne project → environment variables → add `WSA_API_KEY` = the value you just copied
5. Redeploy; `context.tools.web_search` will now work

> ⚠️ Naming convention difference: in the Tencent Cloud Web Search API official docs, the env var is named `TENCENTCLOUD_WSA_APIKEY` (used when calling their SDK directly); in EdgeOne Makers' sandbox runner, **the convention is `WSA_API_KEY`**. Both point to the same key — only the injection location differs. Just set `WSA_API_KEY` in your EdgeOne project; you do not need to set `TENCENTCLOUD_WSA_APIKEY` separately.

**Template self-check:**
- If you only do plain LLM text generation (no search tool) → `WSA_API_KEY` is not needed
- If your code uses `context.tools.get('web_search')` / `context.tools.all()` → `WSA_API_KEY` **must** be configured

### web_search Return Value

Returns an array of `SearchResult` objects:

```typescript
interface SearchResult {
  title: string;   // Result page title
  href: string;    // Canonical destination URL
  snippet: string; // Text excerpt / passage (not full page content)
  site: string;    // Source website name (may be empty)
  date: string;    // Publication date (may be empty)
}
```

Example response:
```json
[
  {
    "title": "EdgeOne Makers Documentation",
    "href": "https://edgeone.ai/docs/pages",
    "snippet": "EdgeOne Makers is a full-stack deployment platform...",
    "site": "edgeone.ai",
    "date": "2026-05-01"
  },
  {
    "title": "Getting Started with EdgeOne",
    "href": "https://cloud.tencent.com/document/product/1552",
    "snippet": "Quick start guide for EdgeOne acceleration...",
    "site": "cloud.tencent.com",
    "date": ""
  }
]
```

### web_search Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | ✅ | Search query text |
| `maxResults` | integer | ❌ | Max results to return (default 5, must be positive integer) |
| `site` | string | ❌ | Restrict to a single domain, e.g. `"zhihu.com"` |

### web_search vs browser_* — when to use which

| Scenario | Tool |
|----------|------|
| Open-ended search (news, docs, discovery) | `web_search` |
| Known URL needing DOM / screenshot / interaction | `browser_*` |
| Direct JSON/API endpoints | `commands` or `code_interpreter` |

> `web_search` returns structured results (title, href, snippet, site, date). It does NOT load pages, execute JS, or return full HTML — use `browser_fetch` for that.

---

