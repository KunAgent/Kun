# Extension Resource Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore expert and Design data in development and packaged Kun while preventing tests or stale settings from overriding managed resource roots.

**Architecture:** Add one pure `ExtensionResourceLocator` in Electron Main. Pass its result to the existing managed runtime config service for both cold start and hot apply; managed roots override persisted values while additional user expert roots are preserved.

**Tech Stack:** TypeScript, Electron `app`/`process.resourcesPath`, Node path/fs, Zod, Vitest, electron-builder `extraResources`.

---

### Task 1: Define the Pure Resource Locator

**Files:**
- Create: `src/main/runtime/extension-resource-locator.ts`
- Test: `src/main/runtime/extension-resource-locator.test.ts`

- [ ] **Step 1: Write failing development and packaged path tests**

```typescript
expect(resolveExtensionResources({ isPackaged: false, appPath: 'D:/soft/Kun', resourcesPath: 'D:/ignored' }).managedRoot)
  .toBe(resolve('D:/soft/Kun'))
expect(resolveExtensionResources({ isPackaged: true, appPath: 'D:/app/app.asar', resourcesPath: 'D:/app/resources' }).managedRoot)
  .toBe(resolve('D:/app/resources/kun-extensions'))
```

- [ ] **Step 2: Verify the test fails**

```powershell
npx vitest run src/main/runtime/extension-resource-locator.test.ts
```

Expected: FAIL because `resolveExtensionResources` does not exist.

- [ ] **Step 3: Implement the locator value object**

```typescript
export type ExtensionResources = {
  managedRoot: string
  expertPluginRoot: string
  designLibrariesRoot: string
  designRuntimeSkillsRoot: string
  designStaticSkillsRoot: string
}

export function resolveExtensionResources(input: LocatorInput): ExtensionResources {
  const managedRoot = resolve(input.isPackaged ? join(input.resourcesPath, 'kun-extensions') : input.appPath)
  return {
    managedRoot,
    expertPluginRoot: join(managedRoot, 'experts', 'plugins'),
    designLibrariesRoot: join(managedRoot, 'design', 'design_libraries'),
    designRuntimeSkillsRoot: join(managedRoot, 'design', 'runtime-skills'),
    designStaticSkillsRoot: join(managedRoot, 'design', 'skills')
  }
}
```

- [ ] **Step 4: Run the locator tests**

```powershell
npx vitest run src/main/runtime/extension-resource-locator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the pure locator**

```powershell
git add src/main/runtime/extension-resource-locator.ts src/main/runtime/extension-resource-locator.test.ts
git commit -m "fix(runtime): centralize extension resource paths"
```

### Task 2: Protect Managed Roots and Preserve User Roots

**Files:**
- Modify: `src/main/runtime/kun-runtime-config-service.ts`
- Modify: `src/main/runtime/kun-runtime-config-service.test.ts`

- [ ] **Step 1: Write failing stale-root and user-root tests**

```typescript
expect(config.serve.extensions.experts.pluginRoots).toEqual([
  resources.expertPluginRoot,
  resolve('D:/user/custom-experts')
])
expect(config.serve.extensions.design.librariesRoot).toBe(resources.designLibrariesRoot)
```

Seed the existing config with `\\tmp\\deepseek-gui-test-app` managed roots and one existing user root.

- [ ] **Step 2: Verify the focused test fails**

```powershell
npx vitest run src/main/runtime/kun-runtime-config-service.test.ts -t "repairs stale managed extension roots"
```

Expected: FAIL because persisted feature fields currently override managed defaults.

- [ ] **Step 3: Change the managed config signature and merge order**

```typescript
function managedExtensionConfig(dataDir: string, resources: ExtensionResources, existing: Record<string, unknown>) {
  const extraRoots = userExpertRoots(objectValue(existing.experts).pluginRoots, resources.expertPluginRoot)
  return {
    ...existing,
    experts: { ...objectValue(existing.experts), pluginRoots: [resources.expertPluginRoot, ...extraRoots], customExpertsDir: join(dataDir, 'experts', 'custom') },
    design: { ...objectValue(existing.design), librariesRoot: resources.designLibrariesRoot, runtimeSkillsRoot: resources.designRuntimeSkillsRoot, staticSkillsRoot: resources.designStaticSkillsRoot }
  }
}
```

- [ ] **Step 4: Run config tests**

```powershell
npx vitest run src/main/runtime/kun-runtime-config-service.test.ts
```

Expected: PASS, including config round-trip and stale-root repair.

- [ ] **Step 5: Commit managed config repair**

```powershell
git add src/main/runtime/kun-runtime-config-service.ts src/main/runtime/kun-runtime-config-service.test.ts
git commit -m "fix(runtime): repair managed extension roots"
```

### Task 3: Use the Locator on Cold Start and Hot Apply

**Files:**
- Modify: `src/main/kun-process.ts`
- Modify: `src/main/kun-process.test.ts`
- Modify: `src/main/runtime/kun-runtime-config-service.ts`

- [ ] **Step 1: Add a failing cold/hot equality test**

```typescript
expect(coldStartExtensions).toEqual(hotAppliedExtensions)
expect(readsOutsideTemporaryDataDir).toEqual([])
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/kun-process.test.ts -t "uses isolated dataDir and identical extension resources"
```

Expected: FAIL because tests fall through to the default user data directory and call sites pass a raw root.

- [ ] **Step 3: Inject locator results and temporary dataDir**

```typescript
const resources = resolveExtensionResources({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath })
await syncGuiManagedKunConfig(dataDir, runtime, { extensionResources: resources, scheduleMcp })
```

Make every `kun-process.test.ts` settings fixture set `agents.kun.dataDir` to its per-test temporary directory.

- [ ] **Step 4: Run process and config tests**

```powershell
npx vitest run src/main/kun-process.test.ts src/main/runtime/kun-runtime-config-service.test.ts
```

Expected: PASS; no test accesses the real Kun config.

- [ ] **Step 5: Commit call-site and isolation changes**

```powershell
git add src/main/kun-process.ts src/main/kun-process.test.ts src/main/runtime/kun-runtime-config-service.ts
git commit -m "test(runtime): isolate managed Kun configuration"
```

### Task 4: Package and Verify Managed Resources

**Files:**
- Modify: `electron-builder.config.cjs`
- Create: `scripts/extension-resources-package.test.mjs`

- [ ] **Step 1: Write the failing packaging config test**

```javascript
assert.deepEqual(resourceTargets, ['kun-extensions/design', 'kun-extensions/experts'])
```

- [ ] **Step 2: Verify failure**

```powershell
node --test scripts/extension-resources-package.test.mjs
```

Expected: FAIL because `extraResources` only contains Whisper.

- [ ] **Step 3: Add filtered resources**

```javascript
{ from: 'experts', to: 'kun-extensions/experts', filter: ['plugins/**/*'] },
{ from: 'design', to: 'kun-extensions/design', filter: ['design_libraries/**/*', 'runtime-skills/**/*', 'skills/**/*'] }
```

- [ ] **Step 4: Run packaging and runtime verification**

```powershell
node --test scripts/extension-resources-package.test.mjs
npx vitest run src/main/runtime/extension-resource-locator.test.ts src/main/runtime/kun-runtime-config-service.test.ts src/main/kun-process.test.ts
npm run typecheck
npm run build:kun
```

Expected: PASS.

- [ ] **Step 5: Commit packaging recovery**

```powershell
git add electron-builder.config.cjs scripts/extension-resources-package.test.mjs
git commit -m "fix(packaging): ship Kun capability resources"
```
