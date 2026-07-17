# Environment Variables and Model Convention

> Covers: AI_GATEWAY_* variables, WSA_API_KEY for web_search, model initialization patterns.

---
## 3. Environment Variables and Model Convention

### Principle
- Unified gateway variables: `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL`, plus optional `AI_GATEWAY_MODEL` / `AI_GATEWAY_SMALL_MODEL`
- Missing variables must throw explicitly — never silently degrade
- Default model as a constant: `@makers/deepseek-v4-flash`
- ⭐ **If the template uses `context.tools.web_search`**: you must also configure `WSA_API_KEY` in the project's environment variables. Create an API KEY in the [Tencent Cloud Web Search API console](https://console.cloud.tencent.com/wsapi/index), copy the value, and set `WSA_API_KEY=<value>` in the EdgeOne project environment variables (reference docs: https://cloud.tencent.com/document/product/1806/130615). This variable is read directly by the sandbox runner; template code typically does not need to reference it explicitly. Without it, search will fail authentication / return 401. Detailed steps in `capabilities/tools.md`.

### LangGraph / DeepAgents — env validation + model initialization (`agents/_model.ts`)
```typescript
import { ChatOpenAI } from '@langchain/openai';

const MODEL_NAME = '@makers/deepseek-v4-flash';

export interface AgentEnv {
  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL: string;
}

export function getAgentEnv(contextEnv: Record<string, string | undefined> | undefined): AgentEnv {
  const source = contextEnv ?? {};
  const required = ['AI_GATEWAY_API_KEY', 'AI_GATEWAY_BASE_URL'] as const;
  const missing = required.filter((k) => !source[k]?.trim());
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return {
    AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY!,
    AI_GATEWAY_BASE_URL: source.AI_GATEWAY_BASE_URL!,
  };
}

// Cache the model instance per baseURL
const modelCache = new Map<string, ChatOpenAI>();

export function createModel(env: AgentEnv, options?: { timeout?: number }): ChatOpenAI {
  const cacheKey = `${MODEL_NAME}:${env.AI_GATEWAY_BASE_URL}`;
  if (modelCache.has(cacheKey)) return modelCache.get(cacheKey)!;

  const model = new ChatOpenAI({
    model: MODEL_NAME,
    apiKey: env.AI_GATEWAY_API_KEY,
    configuration: { baseURL: env.AI_GATEWAY_BASE_URL },
    timeout: options?.timeout ?? 300_000,
  });
  modelCache.set(cacheKey, model);
  return model;
}
```

### Route B — Gateway env mapping (`agents/_model.ts`)
```typescript
const DEFAULT_MODEL = '@makers/deepseek-v4-flash';

export function resolveModelName(env: Record<string, string | undefined>): string {
  return env.AI_GATEWAY_MODEL || DEFAULT_MODEL;
}

// Map EdgeOne Gateway variables to the ANTHROPIC_* names the Claude Agent SDK expects.
// Returns a Record to inject into query()'s options.env — never reads process.env.
export function collectGatewayEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  if (env.AI_GATEWAY_BASE_URL) result.ANTHROPIC_BASE_URL = env.AI_GATEWAY_BASE_URL;
  if (env.AI_GATEWAY_API_KEY) result.ANTHROPIC_API_KEY = env.AI_GATEWAY_API_KEY;
  if (env.AI_GATEWAY_SMALL_MODEL || env.AI_GATEWAY_MODEL) {
    result.ANTHROPIC_SMALL_FAST_MODEL = env.AI_GATEWAY_SMALL_MODEL || env.AI_GATEWAY_MODEL || '';
  }
  if (env.ANTHROPIC_CUSTOM_HEADERS) result.ANTHROPIC_CUSTOM_HEADERS = env.ANTHROPIC_CUSTOM_HEADERS;
  return result;
}

// Caller side (agents/chat/index.ts):
// const gatewayEnv = collectGatewayEnv(context.env);   // ⭐ context.env, never process.env
// query({ ..., options: { env: gatewayEnv, ... } })
```

---
