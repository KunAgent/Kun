# Stage 0 — Extension Seam Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Extension Seam infrastructure (backend + GUI) with an empty registry, wired into 10 one-time upstream integration points, so behavior is byte-identical to upstream and later feature stages register through the seam without touching upstream files again.

**Architecture:** A registry-based extension system. Each seam point in an upstream file makes exactly one dispatch call into our owned `extensions/` hub. With zero registered features the dispatch is a no-op, so this stage is a pure-addition regression gate. Backend uses Kun's custom `Router` (`router.add(method, path, handler)`) and the `createKunServeRuntime` composition root; GUI uses the `registerAppIpcHandlers` / `App` / versioned `AppSettings` seams.

**Tech Stack:** TypeScript, Zod, Vitest, Electron, React, Zustand, Kun custom HTTP Router.

## Global Constraints

- Extension code lives ONLY in `**/extensions/**` and dedicated domain dirs; never add logic to upstream files beyond the single seam call.
- Each seam call in an upstream file is marked `// EXT-SEAM: <name>`; on merge conflict keep this line.
- `KunConfigSchema` is `.strict()` — schema merge MUST rebuild the object shape, not append keys.
- Kun backend is NOT Express. Use `router.add('METHOD', '/path', handler)`; handlers return `Response | JsonResponse`.
- Config namespaces are nested: `KunConfig.<feature>`, `AppSettings.<feature>`. Never add flat top-level fields.
- Build gates: `npm run build:kun`, `npm run typecheck`, `npm run test`, `npm run build` must pass.
- New content stays ASCII.
- Commit after every green step (Angular-style: `feat(ext-seam): ...`).

---

## File Structure

**Backend seam hub (created this stage):**
- `kun/src/seam/types.ts` — `KunExtension`, `LoopHookBus`, `LoopHookName`, context types.
- `kun/src/seam/registry.ts` — `ExtensionRegistry` class: collects features, exposes dispatch methods.
- `kun/src/seam/index.ts` — singleton registry + the 5 backend dispatch functions the seams call.
- `kun/src/seam/features/index.ts` — the (initially empty) list of enabled features.

**Note:** `kun/src/extensions/` is the existing MCP extension platform (untouched). New "Kun Extension" seam uses `kun/src/seam/` to avoid namespace collision.

**Backend upstream seams (modified this stage, one line each):**
- `kun/src/server/routes/index.ts` — `registerExtensionRoutes(router, runtime)` at end of `buildRouter`.
- `kun/src/server/runtime-factory.ts` — `await initializeExtensions(config, runtime)` before final return.
- `kun/src/server/routes/server-runtime.ts` — add optional `extensions?: ExtensionRuntimeServices` field.
- `kun/src/loop/agent-loop.ts` — `await emitLoopHook('beforeLoop'|'afterTurn', ctx)` at defined points.
- `kun/src/config/kun-config.ts` — `mergeExtensionConfigSchemas(baseShape)` before `.strict()`.

**GUI seam hubs (created this stage):**
- `src/shared/extensions/types.ts` — `GuiExtensionSettings` merge contract + endpoint aggregation type.
- `src/shared/extensions/index.ts` — `mergeExtensionSettings`, `extensionEndpoints`.
- `src/renderer/src/extensions/panel-registry.ts` — panel/route registry.
- `src/renderer/src/extensions/index.ts` — `renderExtensionPanels()`, `extensionRoutes()`.
- `src/main/extensions/index.ts` — `registerExtensionIpc(options)`.

**GUI upstream seams (modified this stage, one line each):**
- `src/renderer/src/App.tsx` — render `renderExtensionPanels()`.
- `src/main/ipc/register-app-ipc-handlers.ts` — call `registerExtensionIpc(...)`.
- `src/shared/app-settings-types.ts` — apply `mergeExtensionSettings` to the settings type.
- `src/shared/kun-endpoints.ts` — spread `extensionEndpoints`.
- `src/main/kun-process.ts` — pass extension config namespaces + resource roots to `kun serve`.

**Docs (created this stage):**
- `docs/MIGRATION_INTEGRATION_POINTS.md` — the canonical list of the 10 seams.

---

### Task 1: Backend extension contract types

**Files:**
- Create: `kun/src/extensions/types.ts`
- Test: `kun/src/extensions/types.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `KunExtension`, `LoopHookName`, `LoopHookContext`, `LoopHookBus`, `ExtensionRuntimeServices`, `RouteRegistrar`.

- [ ] **Step 1: Write the failing test**

```typescript
// kun/src/extensions/types.test.ts
import { describe, it, expect } from 'vitest'
import { LOOP_HOOK_NAMES } from './types.js'

describe('extension loop hook names', () => {
  it('exposes the stable set of hook points', () => {
    expect(LOOP_HOOK_NAMES).toEqual(['beforeLoop', 'afterModelSelect', 'beforeToolCall', 'afterTurn'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix kun run test -- src/extensions/types.test.ts`
Expected: FAIL — cannot find module `./types.js` / `LOOP_HOOK_NAMES` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
// kun/src/extensions/types.ts
import type { z } from 'zod'
import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { KunConfig } from '../config/kun-config.js'

export const LOOP_HOOK_NAMES = ['beforeLoop', 'afterModelSelect', 'beforeToolCall', 'afterTurn'] as const
export type LoopHookName = (typeof LOOP_HOOK_NAMES)[number]

/** Mutable context passed through loop hooks. Kept intentionally open — features
 *  read/annotate only the fields they own. */
export type LoopHookContext = {
  threadId: string
  turnId: string
  [key: string]: unknown
}

export type LoopHookFn = (ctx: LoopHookContext) => Promise<void> | void

export interface LoopHookBus {
  on(name: LoopHookName, fn: LoopHookFn): void
  emit(name: LoopHookName, ctx: LoopHookContext): Promise<void>
}

/** Services a feature contributes to the runtime, keyed by feature id. */
export type ExtensionRuntimeServices = Record<string, unknown>

export type RouteRegistrar = (router: Router, runtime: ServerRuntime) => void

export interface KunExtension {
  id: string
  registerRoutes?: RouteRegistrar
  /** Reads its own slice from `extensionsConfig[id]`; validates with its own
   *  Zod schema. Returns services attached under `runtime.extensions[id]`. */
  initializeServices?(featureConfig: unknown, runtime: ServerRuntime): Promise<Record<string, unknown>>
  registerLoopHooks?(bus: LoopHookBus): void
  registerModelClients?(registry: unknown): void
}
```

Note: the config passthrough bag (`config.extensions[featureId]`) replaces any central schema merge. Each feature owns its config validation. Remove the now-unused `z` and `KunConfig` imports if the linter flags them; keep only what the remaining types reference.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix kun run test -- src/extensions/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add kun/src/extensions/types.ts kun/src/extensions/types.test.ts
git commit -m "feat(ext-seam): add backend extension contract types"
```

---

### Task 2: Extension registry + loop hook bus

**Files:**
- Create: `kun/src/extensions/registry.ts`
- Test: `kun/src/extensions/registry.test.ts`

**Interfaces:**
- Consumes: `KunExtension`, `LoopHookBus`, `LoopHookName`, `LoopHookContext` from Task 1.
- Produces: `ExtensionRegistry` with `register(ext)`, `collectRoutes(router, runtime)`, `initServices(extensionsConfig, runtime)`, `hookBus`, `mergeModelClients(registry)`.

- [ ] **Step 1: Write the failing test**

```typescript
// kun/src/extensions/registry.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ExtensionRegistry } from './registry.js'

describe('ExtensionRegistry', () => {
  it('is empty by default and emit is a no-op', async () => {
    const reg = new ExtensionRegistry()
    await expect(reg.hookBus.emit('beforeLoop', { threadId: 't', turnId: 'u' })).resolves.toBeUndefined()
  })

  it('runs registered loop hooks in registration order', async () => {
    const reg = new ExtensionRegistry()
    const calls: string[] = []
    reg.register({ id: 'a', registerLoopHooks: (bus) => bus.on('beforeLoop', () => { calls.push('a') }) })
    reg.register({ id: 'b', registerLoopHooks: (bus) => bus.on('beforeLoop', () => { calls.push('b') }) })
    await reg.hookBus.emit('beforeLoop', { threadId: 't', turnId: 'u' })
    expect(calls).toEqual(['a', 'b'])
  })

  it('rejects duplicate feature ids', () => {
    const reg = new ExtensionRegistry()
    reg.register({ id: 'dup' })
    expect(() => reg.register({ id: 'dup' })).toThrow(/dup/)
  })

  it('initializes services keyed by feature id, passing that feature slice', async () => {
    const reg = new ExtensionRegistry()
    let seen: unknown
    reg.register({
      id: 'svc',
      initializeServices: async (featureConfig) => {
        seen = featureConfig
        return { ping: () => 'pong' }
      }
    })
    const services = await reg.initServices({ svc: { tuned: true } }, {} as never)
    expect(services.svc).toBeDefined()
    expect(seen).toEqual({ tuned: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix kun run test -- src/extensions/registry.test.ts`
Expected: FAIL — cannot find `./registry.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// kun/src/extensions/registry.ts
import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type {
  KunExtension,
  LoopHookBus,
  LoopHookName,
  LoopHookContext,
  LoopHookFn
} from './types.js'

class HookBus implements LoopHookBus {
  private readonly handlers = new Map<LoopHookName, LoopHookFn[]>()
  on(name: LoopHookName, fn: LoopHookFn): void {
    const list = this.handlers.get(name) ?? []
    list.push(fn)
    this.handlers.set(name, list)
  }
  async emit(name: LoopHookName, ctx: LoopHookContext): Promise<void> {
    const list = this.handlers.get(name)
    if (!list) return
    for (const fn of list) await fn(ctx)
  }
}

export class ExtensionRegistry {
  private readonly features: KunExtension[] = []
  private readonly ids = new Set<string>()
  readonly hookBus = new HookBus()

  register(ext: KunExtension): void {
    if (this.ids.has(ext.id)) throw new Error(`duplicate extension id: ${ext.id}`)
    this.ids.add(ext.id)
    this.features.push(ext)
    if (ext.registerLoopHooks) ext.registerLoopHooks(this.hookBus)
  }

  collectRoutes(router: Router, runtime: ServerRuntime): void {
    for (const ext of this.features) ext.registerRoutes?.(router, runtime)
  }

  async initServices(extensionsConfig: Record<string, unknown>, runtime: ServerRuntime): Promise<Record<string, unknown>> {
    const services: Record<string, unknown> = {}
    for (const ext of this.features) {
      if (!ext.initializeServices) continue
      const featureConfig = extensionsConfig[ext.id]
      services[ext.id] = await ext.initializeServices(featureConfig, runtime)
    }
    return services
  }

  mergeModelClients(registry: unknown): void {
    for (const ext of this.features) ext.registerModelClients?.(registry)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix kun run test -- src/extensions/registry.test.ts`
Expected: PASS (4 tests: register, routes, hooks, init services).

- [ ] **Step 5: Commit**

```bash
git add kun/src/extensions/registry.ts kun/src/extensions/registry.test.ts
git commit -m "feat(ext-seam): add extension registry and loop hook bus"
```

---

### Task 3: Backend seam dispatch entry point (empty feature list)

**Files:**
- Create: `kun/src/extensions/features/index.ts`
- Create: `kun/src/extensions/index.ts`
- Test: `kun/src/extensions/index.test.ts`

**Interfaces:**
- Consumes: `ExtensionRegistry` (Task 2).
- Produces (called by the 5 backend seams):
  - `registerExtensionRoutes(router: Router, runtime: ServerRuntime): void`
  - `initializeExtensions(extensionsConfig: Record<string, unknown>, runtime: ServerRuntime): Promise<Record<string, unknown>>`
  - `emitLoopHook(name: LoopHookName, ctx: LoopHookContext): Promise<void>`
  - `registerExtensionModelClients(registry: unknown): void`
  - `ENABLED_EXTENSIONS: KunExtension[]` (empty this stage).

- [ ] **Step 1: Write the failing test**

```typescript
// kun/src/extensions/index.test.ts
import { describe, it, expect } from 'vitest'
import {
  ENABLED_EXTENSIONS,
  emitLoopHook
} from './index.js'

describe('extension seam entry point', () => {
  it('ships with no enabled features in stage 0', () => {
    expect(ENABLED_EXTENSIONS).toEqual([])
  })

  it('emitLoopHook is a no-op with no features', async () => {
    await expect(emitLoopHook('beforeLoop', { threadId: 't', turnId: 'u' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix kun run test -- src/extensions/index.test.ts`
Expected: FAIL — cannot find `./index.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// kun/src/extensions/features/index.ts
import type { KunExtension } from '../types.js'

/** The single place features are enabled. Stage 0 ships empty; each later
 *  stage adds one entry here. Adding a feature never touches upstream files. */
export const ENABLED_EXTENSIONS: KunExtension[] = []
```

```typescript
// kun/src/extensions/index.ts
import type { Router } from '../server/router.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { LoopHookName, LoopHookContext } from './types.js'
import { ExtensionRegistry } from './registry.js'
import { ENABLED_EXTENSIONS } from './features/index.js'

export { ENABLED_EXTENSIONS } from './features/index.js'

const registry = new ExtensionRegistry()
for (const ext of ENABLED_EXTENSIONS) registry.register(ext)

export function registerExtensionRoutes(router: Router, runtime: ServerRuntime): void {
  registry.collectRoutes(router, runtime)
}

export async function initializeExtensions(
  extensionsConfig: Record<string, unknown>,
  runtime: ServerRuntime
): Promise<Record<string, unknown>> {
  return registry.initServices(extensionsConfig, runtime)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix kun run test -- src/extensions/index.test.ts`
Expected: PASS (2 tests: empty features array, no-op hook emit).

- [ ] **Step 5: Commit**

```bash
git add kun/src/extensions/index.ts kun/src/extensions/features/index.ts kun/src/extensions/index.test.ts
git commit -m "feat(ext-seam): add backend seam dispatch entry point"
```

---

### Task 4: Seam #1 (routes) + ServerRuntime type field

**Files:**
- Modify: `kun/src/server/routes/server-runtime.ts` (add optional `extensions?` field)
- Modify: `kun/src/server/routes/index.ts:101-102` (`buildRouter` — append one seam call)
- Test: `kun/src/server/routes/extension-routes-seam.test.ts`

**Interfaces:**
- Consumes: `registerExtensionRoutes` (Task 3), `ExtensionRuntimeServices` (Task 1).
- Produces: `buildRouter` invokes `registerExtensionRoutes(router, runtime)` last; `ServerRuntime.extensions?: ExtensionRuntimeServices`.

- [ ] **Step 1: Write the failing test**

```typescript
// kun/src/server/routes/extension-routes-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('extension routes seam', () => {
  it('buildRouter calls the extension seam exactly once', () => {
    const src = readFileSync(join(here, 'index.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: routes')
    const count = src.split('registerExtensionRoutes(router, runtime)').length - 1
    expect(count).toBe(1)
  })

  it('ServerRuntime exposes an optional extensions field', () => {
    const src = readFileSync(join(here, 'server-runtime.ts'), 'utf8')
    expect(src).toMatch(/extensions\?:/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix kun run test -- src/server/routes/extension-routes-seam.test.ts`
Expected: FAIL — neither the seam comment nor the field exists yet.

- [ ] **Step 3a: Add the ServerRuntime field**

In `kun/src/server/routes/server-runtime.ts`, add an import near the top:

```typescript
import type { ExtensionRuntimeServices } from '../../extensions/types.js'
```

Then inside the `export type ServerRuntime = {` object (after `roles?: RolesConfig`), add:

```typescript
  /** EXT-SEAM: services contributed by enabled extensions, keyed by feature id. */
  extensions?: ExtensionRuntimeServices
```

- [ ] **Step 3b: Add the routes seam**

In `kun/src/server/routes/index.ts`, add to the import block near the other route imports:

```typescript
import { registerExtensionRoutes } from '../../extensions/index.js'
```

At the very end of `buildRouter`, immediately before `return router`, add:

```typescript
  // EXT-SEAM: routes
  registerExtensionRoutes(router, runtime)
```

- [ ] **Step 4: Run test + build to verify**

Run: `npm --prefix kun run test -- src/server/routes/extension-routes-seam.test.ts`
Expected: PASS (2 tests).
Run: `npm run build:kun`
Expected: build succeeds (no type errors).

- [ ] **Step 5: Commit**

```bash
git add kun/src/server/routes/server-runtime.ts kun/src/server/routes/index.ts kun/src/server/routes/extension-routes-seam.test.ts
git commit -m "feat(ext-seam): wire routes seam and ServerRuntime.extensions field"
```

---

### Task 5: Seam #2 (runtime-factory init) + Seam #4 (config passthrough bag)

**Files:**
- Modify: `kun/src/config/kun-config.ts:340-351` (add `extensions?: Record<string, unknown>`)
- Modify: `kun/src/cli/cli-options.ts` (ServeOptionsSchema — add same field)
- Modify: `kun/src/server/routes/runtime-factory.ts:850-900` (createKunServeRuntime — wire init + extract runtime const)
- Test: `kun/src/config/kun-config-extension-seam.test.ts`
- Test: `kun/src/server/routes/runtime-factory-init-seam.test.ts`

**Interfaces:**
- Consumes: `initializeExtensions(extensionsConfig, runtime)` (Task 3).
- Produces: 
  - `KunConfigSchema` with optional `extensions?: z.record(z.unknown())`
  - `ServeOptionsSchema` with matching field
  - `createKunServeRuntime` calls `initializeExtensions(options.extensions ?? {}, runtime)`, assigns result to `runtime.extensions`

- [ ] **Step 1: Write the failing tests**

```typescript
// kun/src/config/kun-config-extension-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { KunConfigSchema } from './kun-config.js'

const here = dirname(fileURLToPath(import.meta.url))

describe('kun-config extension passthrough bag', () => {
  it('adds an extensions field to the schema', () => {
    const src = readFileSync(join(here, 'kun-config.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: config')
    expect(src).toMatch(/extensions.*z\.record/)
  })

  it('parses a minimal upstream config unchanged', () => {
    const parsed = KunConfigSchema.parse({})
    expect(parsed.capabilities).toBeDefined()
    expect(parsed.extensions).toBeUndefined()
  })

  it('parses a config with extensions field', () => {
    const parsed = KunConfigSchema.parse({ extensions: { foo: 'bar' } })
    expect(parsed.extensions).toEqual({ foo: 'bar' })
  })

  })
})
```

```typescript
// kun/src/server/routes/runtime-factory-init-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('runtime-factory extension init seam', () => {
  it('calls initializeExtensions and assigns runtime.extensions', () => {
    const src = readFileSync(join(here, 'runtime-factory.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: init')
    expect(src).toContain('await initializeExtensions(')
    expect(src).toMatch(/runtime\.extensions\s*=/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix kun run test -- src/config/kun-config-extension-seam.test.ts src/server/routes/runtime-factory-init-seam.test.ts`
Expected: Both FAIL — seam comments/imports absent.

- [ ] **Step 3a: Add config passthrough bag**

In `kun/src/config/kun-config.ts`, inside the `KunConfigSchema` definition (after `roles` field), add:

```typescript
  /** EXT-SEAM: config — passthrough bag for extension-specific config. Each feature
   *  validates its own slice. No upstream edits required when adding features. */
  extensions: z.record(z.unknown()).optional(),
```

- [ ] **Step 3b: Add ServeOptions passthrough bag**

In `kun/src/cli/cli-options.ts`, add to the import block:

```typescript
import { z } from 'zod'
```

Then inside `ServeOptionsSchema` (after the `roles` field), add:

```typescript
  /** EXT-SEAM: config — mirrors KunConfigSchema.extensions */
  extensions: z.record(z.unknown()).optional(),
```

- [ ] **Step 3c: Wire runtime-factory init seam**

In `kun/src/server/routes/runtime-factory.ts`, add to the import block:

```typescript
import { initializeExtensions } from '../../extensions/index.js'
```

Find the inline `return { ... }` block (~line 881). Before it, extract the runtime to a const:

```typescript
  // EXT-SEAM: init
  const runtime: ServerRuntime = {
    config: activeOptions,
    assistantManager,
    stateManager,
    noticeManager,
    searchManager,
    telemetry,
    transcriptDir,
    taskManager,
    userMessage,
    userContext,
    projectInfo,
    projectMemory,
    tools,
    shellEnvironment: options.shellEnvironment,
    roles: options.roles
  }

  runtime.extensions = await initializeExtensions(
    options.extensions ?? {},
    runtime
  )

  return runtime
```

- [ ] **Step 4: Run tests + build to verify**

Run: `npm --prefix kun run test -- src/config/kun-config-extension-seam.test.ts src/server/routes/runtime-factory-init-seam.test.ts`
Expected: PASS (4 config tests + 1 runtime-factory test).
Run: `npm run build:kun`
Expected: build succeeds (no type errors).

- [ ] **Step 5: Commit**

```bash
git add kun/src/config/kun-config.ts kun/src/cli/cli-options.ts kun/src/server/routes/runtime-factory.ts kun/src/config/kun-config-extension-seam.test.ts kun/src/server/routes/runtime-factory-init-seam.test.ts
git commit -m "feat(ext-seam): wire config passthrough bag and runtime init seam"
```

---

### Task 6: Seam #3 (agent loop hooks) + Seam #5 (model clients)

**Files:**
- Modify: `kun/src/server/routes/agent-loop.ts:250-350` (loop lifecycle points)
- Modify: `kun/src/models/model-registry.ts` (add model client seam)
- Test: `kun/src/server/routes/agent-loop-hooks-seam.test.ts`
- Test: `kun/src/models/model-registry-seam.test.ts`

**Interfaces:**
- Consumes: `emitLoopHook(name, ctx)` (Task 3), `registerExtensionModelClients(registry)` (Task 3).
- Produces: Loop emits `beforeLoop`, `beforeTurn`, `afterTurn`, `afterLoop` at lifecycle points; model-registry calls extension seam once.

- [ ] **Step 1: Write the failing tests**

```typescript
// kun/src/server/routes/agent-loop-hooks-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('agent-loop hooks seam', () => {
  const hookPoints = ['beforeLoop', 'beforeTurn', 'afterTurn', 'afterLoop']
  
  for (const hook of hookPoints) {
    it(`emits ${hook} hook at the right lifecycle point`, () => {
      const src = readFileSync(join(here, 'agent-loop.ts'), 'utf8')
      expect(src).toContain(`// EXT-SEAM: ${hook}`)
      expect(src).toContain(`await emitLoopHook('${hook}',`)
    })
  }
})
```

```typescript
// kun/src/models/model-registry-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('model-registry extension seam', () => {
  it('calls registerExtensionModelClients once', () => {
    const src = readFileSync(join(here, 'model-registry.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: model clients')
    expect(src).toContain('registerExtensionModelClients(')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix kun run test -- src/server/routes/agent-loop-hooks-seam.test.ts src/models/model-registry-seam.test.ts`
Expected: Both FAIL — seam comments/imports absent.

- [ ] **Step 3a: Wire agent-loop hooks**

In `kun/src/server/routes/agent-loop.ts`, add to the import block:

```typescript
import { emitLoopHook } from '../../extensions/index.js'
```

Find the 4 lifecycle points and add seam calls:

1. **beforeLoop** — at the very start of the main loop function, right after function entry:

```typescript
  // EXT-SEAM: beforeLoop
  await emitLoopHook('beforeLoop', { threadId, turnId: '' })
```

2. **beforeTurn** — right after a new turn starts (after `turnId` is assigned):

```typescript
  // EXT-SEAM: beforeTurn
  await emitLoopHook('beforeTurn', { threadId, turnId })
```

3. **afterTurn** — right before the turn ends (after response is written, before loop continues):

```typescript
  // EXT-SEAM: afterTurn
  await emitLoopHook('afterTurn', { threadId, turnId })
```

4. **afterLoop** — at the very end of the loop, in the finally block or before function return:

```typescript
  // EXT-SEAM: afterLoop
  await emitLoopHook('afterLoop', { threadId, turnId: lastTurnId })
```

- [ ] **Step 3b: Wire model-registry seam**

In `kun/src/models/model-registry.ts`, add to the import block:

```typescript
import { registerExtensionModelClients } from '../extensions/index.js'
```

At the end of the registry initialization (after all built-in clients are registered), add:

```typescript
// EXT-SEAM: model clients
registerExtensionModelClients(registry)
```

- [ ] **Step 4: Run tests + build to verify**

Run: `npm --prefix kun run test -- src/server/routes/agent-loop-hooks-seam.test.ts src/models/model-registry-seam.test.ts`
Expected: PASS (4 hook tests + 1 model-registry test).
Run: `npm run build:kun`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add kun/src/server/routes/agent-loop.ts kun/src/models/model-registry.ts kun/src/server/routes/agent-loop-hooks-seam.test.ts kun/src/models/model-registry-seam.test.ts
git commit -m "feat(ext-seam): wire agent-loop hooks and model-registry seam"
```

---

### Task 7: Frontend seams (IPC handlers + App component + settings types)

**Files:**
- Modify: `kun-ui/src/main/app-ipc-handlers.ts` (add extension seam)
- Modify: `kun-ui/src/renderer/src/App.tsx` (add extension routes outlet)
- Modify: `kun-ui/src/types/app-settings-types.ts` (add extension settings union)
- Test: `kun-ui/src/main/app-ipc-handlers-seam.test.ts`
- Test: `kun-ui/src/renderer/src/App-seam.test.tsx`
- Test: `kun-ui/src/types/app-settings-types-seam.test.ts`

**Interfaces:**
- Consumes: Nothing (frontend seams are defined at the call-site, extensions will provide implementations in later stages).
- Produces: Three extension points ready for Stage 1+ to use.

- [ ] **Step 1: Write the failing tests**

```typescript
// kun-ui/src/main/app-ipc-handlers-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('app-ipc-handlers extension seam', () => {
  it('calls registerExtensionIpcHandlers after upstream handlers', () => {
    const src = readFileSync(join(here, 'app-ipc-handlers.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: ipc-handlers')
    expect(src).toContain('registerExtensionIpcHandlers(')
  })
})
```

```typescript
// kun-ui/src/renderer/src/App-seam.test.tsx
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('App component extension seam', () => {
  it('renders ExtensionRoutes outlet in the layout', () => {
    const src = readFileSync(join(here, 'App.tsx'), 'utf8')
    expect(src).toContain('// EXT-SEAM: routes')
    expect(src).toContain('<ExtensionRoutes')
  })
})
```

```typescript
// kun-ui/src/types/app-settings-types-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('app-settings-types extension seam', () => {
  it('unions ExtensionSettingsV1 into AppSettingsV1', () => {
    const src = readFileSync(join(here, 'app-settings-types.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: settings')
    expect(src).toMatch(/ExtensionSettingsV1/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix kun-ui run test -- src/main/app-ipc-handlers-seam.test.ts src/renderer/src/App-seam.test.tsx src/types/app-settings-types-seam.test.ts`
Expected: All FAIL — seam comments/imports absent.

- [ ] **Step 3a: Wire IPC handlers seam**

Create the empty extension registry file first:

```typescript
// kun-ui/src/extensions/index.ts
/** Stage 0: empty extension registry. Later stages register features here. */
export function registerExtensionIpcHandlers(_options: { ipcMain: any }): void {
  // No-op in Stage 0
}

/** Stage 0: no extension routes. Later stages add route elements here. */
export function ExtensionRoutes(): null {
  return null
}

export type ExtensionSettingsV1 = Record<string, never>
```

In `kun-ui/src/main/app-ipc-handlers.ts`, add to the import block:

```typescript
import { registerExtensionIpcHandlers } from '../extensions/index.js'
```

At the end of `registerAppIpcHandlers`, after all upstream handlers, add:

```typescript
  // EXT-SEAM: ipc-handlers
  registerExtensionIpcHandlers({ ipcMain })
```

- [ ] **Step 3b: Wire App component seam**

In `kun-ui/src/renderer/src/App.tsx`, add to the import block:

```typescript
import { ExtensionRoutes } from '../../extensions/index.js'
```

Inside the main layout (after the primary `<Routes>` block but before closing the layout container), add:

```typescript
        {/* EXT-SEAM: routes */}
        <ExtensionRoutes />
```

- [ ] **Step 3c: Wire settings types seam**

In `kun-ui/src/types/app-settings-types.ts`, add to the import block:

```typescript
import type { ExtensionSettingsV1 } from '../extensions/index.js'
```

Modify the `AppSettingsV1` type definition to union extension settings:

```typescript
// EXT-SEAM: settings
export type AppSettingsV1 = BaseAppSettingsV1 & ExtensionSettingsV1
```

- [ ] **Step 4: Run tests + build to verify**

Run: `npm --prefix kun-ui run test -- src/main/app-ipc-handlers-seam.test.ts src/renderer/src/App-seam.test.tsx src/types/app-settings-types-seam.test.ts`
Expected: PASS (3 tests).
Run: `npm run build:kun-ui`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add kun-ui/src/extensions/index.ts kun-ui/src/main/app-ipc-handlers.ts kun-ui/src/renderer/src/App.tsx kun-ui/src/types/app-settings-types.ts kun-ui/src/main/app-ipc-handlers-seam.test.ts kun-ui/src/renderer/src/App-seam.test.tsx kun-ui/src/types/app-settings-types-seam.test.ts
git commit -m "feat(ext-seam): wire frontend IPC/routes/settings seams"
```

---

### Task 8: Empty-Seam Regression Gate

**Files:**
- Test: `kun/src/extensions/empty-seam-regression.test.ts`
- Test: `kun-ui/src/extensions/empty-seam-regression.test.ts`

**Interfaces:**
- Consumes: All 10 seams (Tasks 1-7).
- Produces: A passing test suite that proves Stage 0 adds zero runtime overhead and changes no upstream behavior.

- [ ] **Step 1: Write the backend regression test**

```typescript
// kun/src/extensions/empty-seam-regression.test.ts
import { describe, it, expect } from 'vitest'
import { ENABLED_EXTENSIONS } from './features/index.js'
import { ExtensionRegistry } from './registry.js'

describe('empty-seam regression gate (Stage 0)', () => {
  it('ships with zero enabled features', () => {
    expect(ENABLED_EXTENSIONS).toEqual([])
  })

  it('registry operations are no-ops with empty feature list', () => {
    const reg = new ExtensionRegistry()
    expect(reg['features']).toHaveLength(0)
    
    const mockRouter = { add: vi.fn() }
    const mockRuntime = {} as any
    reg.collectRoutes(mockRouter as any, mockRuntime)
    expect(mockRouter.add).not.toHaveBeenCalled()
  })

  it('initServices returns an empty object', async () => {
    const reg = new ExtensionRegistry()
    const result = await reg.initServices({}, {} as any)
    expect(result).toEqual({})
  })

  it('hook bus emits complete immediately', async () => {
    const reg = new ExtensionRegistry()
    const start = Date.now()
    await reg.hookBus.emit('beforeLoop', { threadId: 't', turnId: 'u' })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5) // < 5ms = no async work
  })
})
```

- [ ] **Step 2: Write the frontend regression test**

```typescript
// kun-ui/src/extensions/empty-seam-regression.test.ts
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { registerExtensionIpcHandlers, ExtensionRoutes } from './index.js'

describe('empty-seam regression gate (Stage 0 frontend)', () => {
  it('registerExtensionIpcHandlers is a no-op', () => {
    const mockIpcMain = { handle: vi.fn() }
    registerExtensionIpcHandlers({ ipcMain: mockIpcMain })
    expect(mockIpcMain.handle).not.toHaveBeenCalled()
  })

  it('ExtensionRoutes renders nothing', () => {
    const { container } = render(<ExtensionRoutes />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 3: Run regression tests**

Run: `npm --prefix kun run test -- src/extensions/empty-seam-regression.test.ts`
Expected: PASS (4 backend tests).
Run: `npm --prefix kun-ui run test -- src/extensions/empty-seam-regression.test.ts`
Expected: PASS (2 frontend tests).

- [ ] **Step 4: Run full test suite**

Run: `npm run test` (both kun + kun-ui)
Expected: ALL tests pass — upstream behavior unchanged, seams verified.

- [ ] **Step 5: Commit**

```bash
git add kun/src/extensions/empty-seam-regression.test.ts kun-ui/src/extensions/empty-seam-regression.test.ts
git commit -m "test(ext-seam): add empty-seam regression gate (Stage 0 complete)"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-15-stage0-extension-seam-skeleton.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
  serve: KunServeConfigSchema.optional(),
  models: ModelConfigSchema.optional(),
  contextCompaction: ContextCompactionConfigSchema.optional(),
  runtime: RuntimeTuningConfigSchema.optional(),
  roles: RolesConfigSchema.optional(),
  capabilities: KunCapabilitiesConfig.default(DEFAULT_KUN_CAPABILITIES_CONFIG),
  hooks: HooksConfigSchema.optional(),
  quality: QualityConfigSchema.optional()
} as const

export const KunConfigSchema = z.object(mergeExtensionConfigSchemas({ ...BASE_KUN_CONFIG_SHAPE })).strict()
```

Note: `mergeExtensionConfigSchemas` returns a `z.ZodRawShape`; passing a shallow copy keeps the base immutable. With `ENABLED_EXTENSIONS` empty, the shape equals the upstream object, so `.strict()` behavior is unchanged.

- [ ] **Step 4: Run test + build**

Run: `npm --prefix kun run test -- src/config/kun-config-extension-seam.test.ts`
Expected: PASS (3 tests).
Run: `npm --prefix kun run test -- src/config`
Expected: existing kun-config tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add kun/src/config/kun-config.ts kun/src/config/kun-config-extension-seam.test.ts
git commit -m "feat(ext-seam): route KunConfigSchema through extension merge"
```

---

### Task 6: Seam #2 (runtime-factory service init)

**Files:**
- Modify: `kun/src/server/runtime-factory.ts` (`createKunServeRuntime` — before final `return`)
- Test: `kun/src/server/runtime-factory-extension-seam.test.ts`

**Interfaces:**
- Consumes: `initializeExtensions` (Task 3), `ServerRuntime.extensions` field (Task 4).
- Produces: the returned runtime carries `extensions` populated via `initializeExtensions(config, runtime)`. Empty object when no features.

- [ ] **Step 1: Write the failing test**

```typescript
// kun/src/server/runtime-factory-extension-seam.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('runtime-factory extension seam', () => {
  it('initializes extensions exactly once and attaches them', () => {
    const src = readFileSync(join(here, 'runtime-factory.ts'), 'utf8')
    expect(src).toContain('// EXT-SEAM: services')
    const count = src.split('initializeExtensions(').length - 1
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix kun run test -- src/server/runtime-factory-extension-seam.test.ts`
Expected: FAIL — seam marker absent.

- [ ] **Step 3: Add the service seam**

In `kun/src/server/runtime-factory.ts`, add to the imports:

```typescript
import { initializeExtensions } from '../extensions/index.js'
```

`createKunServeRuntime` builds a `runtime` object and returns it. Locate the final `const runtime: ServerRuntime = { ... }` (the object returned by `createKunServeRuntime`). Immediately after that object is constructed and before it is returned, add:

```typescript
  // EXT-SEAM: services
  runtime.extensions = await initializeExtensions(activeOptions.config ?? ({} as never), runtime)
```

If the returned object is an inline `return { ... }` rather than a named `const`, first extract it to `const runtime: ServerRuntime = { ... }`, then add the seam line, then `return runtime`. Use the actual `KunConfig` available in scope for the first argument (inspect what config value `createKunServeRuntime` already holds; if it is `activeOptions.models`-style rather than a full `KunConfig`, pass the nearest full config object the factory received — do not fabricate a new one).

- [ ] **Step 4: Run test + build**

Run: `npm --prefix kun run test -- src/server/runtime-factory-extension-seam.test.ts`
Expected: PASS.
Run: `npm run build:kun`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add kun/src/server/runtime-factory.ts kun/src/server/runtime-factory-extension-seam.test.ts
git commit -m "feat(ext-seam): initialize extension services in runtime factory"
```

---

<!-- PLACEHOLDER-TASKS -->






