# Extension Seam Integration Points

This document records all upstream file modifications for the Extension Seam system. These seams enable staged feature migrations from Kun into the Extension system without modifying each feature's code.

## Overview

The seam system provides 8 integration points across backend (Kun) and frontend (Electron GUI) that allow:
- Experts migration (Stage 1)
- Design system migration (Stage 2)
- Other subsystems to be extracted as extensions

Each seam is marked with `// EXT-SEAM` comments in the source for easy location during upstream merges.

---

## Backend Seams (kun/)

### Seam #1: Routes
**File:** `kun/src/server/routes/index.ts`

**Purpose:** Register extension-provided API routes

**Integration Point:**
```typescript
// EXT-SEAM: routes
registerExtensionRoutes(router, runtime)
```

**Behavior:**
- Called during server initialization
- Extensions register `/v1/experts/*`, `/v1/design/*`, etc.
- Stage 0: `registerExtensionRoutes` is a no-op (no extensions)
- Stage 1: Experts extension registers `/v1/experts/...` routes

**Merge Conflict Strategy:**
- Locate the `registerExtensionRoutes` call
- Merge surrounding route setup from upstream
- Preserve the extension hook

---

### Seam #2: Runtime Services
**File:** `kun/src/server/runtime-factory.ts`

**Purpose:** Initialize extension-provided backend services

**Integration Point:**
```typescript
// EXT-SEAM: runtime services
await initializeExtensionServices(config.extensions || {}, runtime)
```

**Behavior:**
- Called after core runtime is created
- Extensions initialize background services, workers, data stores
- Stage 0: No-op (no extensions)
- Stage 1: Experts extension initializes expert registry, memory store

**Merge Conflict Strategy:**
- Locate the `initializeExtensionServices` call
- Merge surrounding service initialization from upstream
- Preserve the extension hook

---

### Seam #3: Agent Loop Hooks (4 locations)
**File:** `kun/src/loop/agent-loop.ts`

**Purpose:** Emit lifecycle hooks for extensions to observe/augment agent execution

**Integration Points:**
```typescript
// EXT-SEAM: onBeforeLoop
await emitLoopHook('onBeforeLoop', { iteration, context })

// EXT-SEAM: onBeforeThink
await emitLoopHook('onBeforeThink', { thought, context })

// EXT-SEAM: onBeforeAct
await emitLoopHook('onBeforeAct', { action, context })

// EXT-SEAM: onAfterLoop
await emitLoopHook('onAfterLoop', { result, context })
```

**Behavior:**
- Called at agent loop lifecycle points
- Extensions listen and react (e.g., log expert metadata, track design decisions)
- All hooks are awaited; extensions can perform async operations
- Stage 0: Hook emission is silent (no listeners)
- Stage 1: Experts extension listens to log expert selection

**Merge Conflict Strategy:**
- Locate each `emitLoopHook` call
- Merge surrounding loop logic from upstream
- Preserve all hook calls in order

---

### Seam #4: Config Passthrough
**Files:**
- `kun/src/config/kun-config.ts` — core config interface
- `kun/src/cli/cli-options.ts` — CLI option parsing

**Purpose:** Pass extension configuration from CLI/config files to runtime

**Integration Point (kun-config.ts):**
```typescript
extensions?: Record<string, unknown>
// EXT-SEAM: feature configs
```

**Integration Point (cli-options.ts):**
```typescript
// EXT-SEAM: feature configs
const extensions = parseExtensionConfigs(yargs, configFile)
```

**Behavior:**
- CLI and config files can specify `--extension.experts.enabled=true`, etc.
- Config is passed to `initializeExtensionServices`
- Stage 0: No extension configs parsed
- Stage 1: `extensions.experts` config is parsed and used

**Merge Conflict Strategy:**
- Locate the `extensions` field
- Merge surrounding config fields from upstream
- Preserve the extension field

---

### Seam #5: Model Clients
**File:** `kun/src/server/runtime-factory.ts`

**Purpose:** Register extension-provided LLM clients (anthropic, openai-compatible, etc.)

**Integration Point:**
```typescript
// EXT-SEAM: model clients
registerExtensionModelClients(modelClient)
```

**Behavior:**
- Called after model client factory is created
- Extensions register custom clients (e.g., Experts uses Claude for expert selection)
- Stage 0: No-op
- Stage 1: Experts registers internal Claude client

**Merge Conflict Strategy:**
- Locate the `registerExtensionModelClients` call
- Merge surrounding model setup from upstream
- Preserve the extension hook

---

## Frontend Seams (src/)

### Seam #6: App Panels & Routes
**File:** `src/renderer/src/App.tsx`

**Purpose:** Render extension-provided UI panels and route handlers

**Integration Points:**
```typescript
// EXT-SEAM
{renderExtensionPanels()}

// EXT-SEAM
{extensionRoutes()}
```

**Behavior:**
- Extensions register React components for new panels/pages
- Routes are composed into the main router
- Stage 0: No extension panels
- Stage 1: Experts extension renders expert browser panel

**Merge Conflict Strategy:**
- Locate both `renderExtensionPanels()` and `extensionRoutes()` calls
- Merge surrounding app shell and route logic from upstream
- Preserve both extension calls

---

### Seam #7: IPC Handlers
**File:** `src/main/ipc/register-app-ipc-handlers.ts`

**Purpose:** Register extension-provided IPC message handlers

**Integration Point:**
```typescript
// EXT-SEAM: extension IPC
registerExtensionIpc(ipcMain)
```

**Behavior:**
- Extensions register Electron IPC handlers (main → renderer communication)
- Handler names follow convention: `extension:{extensionName}:{handler}`
- Stage 0: No-op
- Stage 1: Experts extension registers IPC handlers for expert browser, settings sync

**Merge Conflict Strategy:**
- Locate the `registerExtensionIpc` call
- Merge surrounding IPC setup from upstream
- Preserve the extension hook

---

### Seam #8: Settings Types & Merging
**File:** `src/shared/app-settings-types.ts`

**Purpose:** Allow extensions to augment the app settings type and merge extension-specific settings

**Integration Points:**
```typescript
import { mergeExtensionSettings } from './seam/index.js'  // EXT-SEAM

export type AppSettingsWithExtensions = ReturnType<typeof mergeExtensionSettings>  // EXT-SEAM
```

**Behavior:**
- `mergeExtensionSettings(base: AppSettingsV1): AppSettingsV1`
- Accepts base settings, returns settings with extension fields merged
- Called during settings load/normalization
- Stage 0: No-op; just returns base
- Stage 1: Experts extension adds `settings.experts.enabled`, `settings.experts.profiles`, etc.

**Merge Conflict Strategy:**
- Locate the `mergeExtensionSettings` import and usage
- Merge surrounding settings type and normalization logic from upstream
- Preserve the extension merge call

---

## Staged Activation Pattern

Each seam follows the same activation pattern:

### Stage 0 (Current)
- All ENABLED_FEATURES arrays are **empty**: `[]`
- All seam calls exist but are no-ops
- Build/test status matches upstream baseline
- System is in "pristine seam" state — ready for feature extraction

### Stage 1 (Experts Migration)
- `ENABLED_FEATURES.push('experts')`
- Experts extension is activated
- Seams route requests to experts subsystem
- Old `kun/src/experts/` code is removed after migration is verified

### Stage 2+ (Design & Other Subsystems)
- Additional extensions are activated as their migration is complete
- Each extension follows the same seam interface

---

## Merge Conflict Resolution

When upstream changes affect seam files:

1. **Pull upstream changes** (e.g., `git pull origin main`)
2. **Locate seam markers** in the merge conflict:
   ```
   <<<<<<< HEAD
   // ... our seam marker: // EXT-SEAM
   registerExtensionRoutes(router, runtime)
   =======
   // ... upstream changes to surrounding code
   ======= >>>>>>>
   ```
3. **Preserve the seam call** — it should always remain
4. **Merge surrounding context** from upstream into the file
5. **Verify build and tests pass:**
   ```bash
   npm run typecheck
   npm run test
   npm run build
   ```

---

## File Locations Quick Reference

| Seam | File | Line Marker |
|------|------|------------|
| 1. Routes | `kun/src/server/routes/index.ts` | `// EXT-SEAM: routes` |
| 2. Runtime Services | `kun/src/server/runtime-factory.ts` | `// EXT-SEAM: runtime services` |
| 3a. onBeforeLoop | `kun/src/loop/agent-loop.ts` | `// EXT-SEAM: onBeforeLoop` |
| 3b. onBeforeThink | `kun/src/loop/agent-loop.ts` | `// EXT-SEAM: onBeforeThink` |
| 3c. onBeforeAct | `kun/src/loop/agent-loop.ts` | `// EXT-SEAM: onBeforeAct` |
| 3d. onAfterLoop | `kun/src/loop/agent-loop.ts` | `// EXT-SEAM: onAfterLoop` |
| 4. Config | `kun/src/config/kun-config.ts` + `kun/src/cli/cli-options.ts` | `// EXT-SEAM: feature configs` |
| 5. Model Clients | `kun/src/server/runtime-factory.ts` | `// EXT-SEAM: model clients` |
| 6. App Panels | `src/renderer/src/App.tsx` | `// EXT-SEAM` |
| 7. IPC Handlers | `src/main/ipc/register-app-ipc-handlers.ts` | `// EXT-SEAM: extension IPC` |
| 8. Settings | `src/shared/app-settings-types.ts` + `src/shared/seam/index.ts` | `// EXT-SEAM` |

---

## Implementation Status

| Seam | Status | Notes |
|------|--------|-------|
| 1. Routes | ✓ Complete | Routes registered; no handlers yet |
| 2. Runtime Services | ✓ Complete | Services initialized; no listeners yet |
| 3. Loop Hooks | ✓ Complete | 4 hooks emitted; no subscribers yet |
| 4. Config | ✓ Complete | Extensions config passthrough active |
| 5. Model Clients | ✓ Complete | Model clients registered; none yet |
| 6. App Panels | ✓ Complete | Panels rendered; empty list |
| 7. IPC Handlers | ✓ Complete | IPC registered; no handlers yet |
| 8. Settings | ✓ Complete | Settings merged; no extension fields yet |

All 8 seams are implemented and verified to be no-ops with empty ENABLED_FEATURES arrays. Ready for Stage 1.
