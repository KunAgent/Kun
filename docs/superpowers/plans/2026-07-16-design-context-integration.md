# Design Context Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move migrated Design systems, skills, components, and assets into the existing Design Context without duplicating the Design workflow or inflating the stable model prefix.

**Architecture:** Keep existing Kun Design services as searchable resource providers and add a `DesignContextContribution` slot. Persist workspace selections in `.kun-design/context.json`; inject bounded summaries and retrieve full details on demand.

**Tech Stack:** React, TypeScript, Zustand, Kun extension routes, existing Design workspace and `.kun-design` persistence, Vitest.

---

### Task 1: Define Design Context Contributions

**Files:**
- Modify: `src/renderer/src/seam/index.ts`
- Modify: `src/renderer/src/seam/features/design/index.tsx`
- Create: `src/renderer/src/design/context/design-context-contribution.ts`
- Test: `src/renderer/src/design/context/design-context-contribution.test.ts`

- [ ] **Step 1: Write a failing contribution aggregation test**

```typescript
expect(registry.list('design-system').map((item) => item.id)).toEqual(['system:ant'])
expect(() => registry.register(duplicateId)).toThrow(/duplicate design context contribution/i)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/design/context/design-context-contribution.test.ts
```

Expected: FAIL because no contribution registry exists.

- [ ] **Step 3: Implement the stable slot**

```typescript
export type DesignContextContribution = {
  id: string
  kind: 'design-system' | 'skill' | 'component' | 'asset'
  title: string
  summary: string
  version: string
  loadDetail: () => Promise<unknown>
}
```

The Design seam registers contributions; Design Context consumes only this public shape.

- [ ] **Step 4: Run registry tests**

```powershell
npx vitest run src/renderer/src/design/context/design-context-contribution.test.ts src/renderer/src/seam
```

Expected: PASS.

- [ ] **Step 5: Commit the contribution slot**

```powershell
git add src/renderer/src/design/context src/renderer/src/seam/index.ts src/renderer/src/seam/features/design/index.tsx
git commit -m "feat(design): register context contributions"
```

### Task 2: Persist Workspace Selections

**Files:**
- Create: `src/renderer/src/design/context/design-context-selection.ts`
- Test: `src/renderer/src/design/context/design-context-selection.test.ts`
- Modify: `src/renderer/src/design/design-document-persistence.ts`

- [ ] **Step 1: Write failing versioned persistence tests**

```typescript
expect(await store.load(workspace)).toEqual({ version: 1, selected: [] })
await store.save(workspace, { version: 1, selected: [{ contributionId: 'skill:a11y', version: '1', enabled: true }] })
expect(JSON.parse(await readFile(join(workspace, '.kun-design/context.json'), 'utf8')).version).toBe(1)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/design/context/design-context-selection.test.ts
```

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement atomic workspace storage**

```typescript
const DesignContextSelectionSchema = z.object({
  version: z.literal(1),
  selected: z.array(z.object({ contributionId: z.string().min(1), version: z.string().min(1), enabled: z.boolean() }))
})
```

Use the existing renderer-to-main workspace file boundary; write a temporary file and rename atomically.

- [ ] **Step 4: Run persistence tests**

```powershell
npx vitest run src/renderer/src/design/context/design-context-selection.test.ts src/renderer/src/design/design-document-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit selection persistence**

```powershell
git add src/renderer/src/design/context src/renderer/src/design/design-document-persistence.ts
git commit -m "feat(design): persist selected design context"
```

### Task 3: Integrate the Design System UI

**Files:**
- Modify: `src/renderer/src/components/design/DesignWorkspaceView.tsx`
- Create: `src/renderer/src/components/design/DesignContextPanel.tsx`
- Test: `src/renderer/src/components/design/DesignContextPanel.test.tsx`
- Modify: `src/renderer/src/seam/features/design/DesignLibraryBrowser.tsx`

- [ ] **Step 1: Write failing navigation and selection tests**

```typescript
fireEvent.click(screen.getByRole('tab', { name: '设计上下文' }))
fireEvent.click(screen.getByRole('tab', { name: '设计系统' }))
expect(screen.getByRole('tab', { name: '组件' })).toBeTruthy()
expect(screen.getByRole('tab', { name: 'Skills' })).toBeTruthy()
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/components/design/DesignContextPanel.test.tsx
```

Expected: FAIL because migrated resources are still rendered as a standalone capability page.

- [ ] **Step 3: Implement the integrated panel**

Use tabs for systems/skills/components/assets, compact searchable lists, checkboxes for selection, detail drawer for full content, and explicit missing/version-mismatch states. Do not nest cards or recreate the canvas.

- [ ] **Step 4: Run Design UI tests**

```powershell
npx vitest run src/renderer/src/components/design/DesignContextPanel.test.tsx src/renderer/src/seam/features/design src/renderer/src/design
```

Expected: PASS.

- [ ] **Step 5: Commit Design Context UI**

```powershell
git add src/renderer/src/components/design src/renderer/src/seam/features/design/DesignLibraryBrowser.tsx
git commit -m "feat(design): integrate resources into design context"
```

### Task 4: Remove the Standalone Capability Surface

**Files:**
- Modify: `src/renderer/src/seam/features/design/index.tsx`
- Modify: `src/renderer/src/seam/features/index.ts`
- Modify: `src/renderer/src/seam/ExtensionFeaturesView.tsx`
- Modify: `src/renderer/src/seam/ExtensionFeaturesView.test.ts`
- Modify: `src/renderer/src/components/workbench/useWorkbenchNavigationController.ts`

- [ ] **Step 1: Write a failing absence/redirect test**

```typescript
expect(screen.queryByRole('tab', { name: /Design System/i })).toBeNull()
expect(resolveLegacyExtensionRoute('/design-library')).toEqual({ mode: 'design', panel: 'context', tab: 'system' })
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/seam/ExtensionFeaturesView.test.ts
```

Expected: FAIL because Design is registered as a capability panel/route.

- [ ] **Step 3: Remove panel registration and add one-version redirect**

```typescript
export const designFeature = { id: 'design', designContextContributions: createDesignContributions }
```

Keep backend services and endpoints; remove only the duplicate renderer panel and route.

- [ ] **Step 4: Run seam/navigation tests**

```powershell
npx vitest run src/renderer/src/seam src/renderer/src/components/workbench
```

Expected: PASS.

- [ ] **Step 5: Commit route integration**

```powershell
git add src/renderer/src/seam src/renderer/src/components/workbench/useWorkbenchNavigationController.ts
git commit -m "refactor(design): remove standalone capability page"
```

### Task 5: Inject Only Bounded Selected Summaries

**Files:**
- Modify: `src/renderer/src/design/design-context.ts`
- Modify: `src/renderer/src/design/design-context.test.ts`
- Modify: `src/renderer/src/design/design-composer-context.ts`
- Modify: `src/renderer/src/design/design-composer-context.test.ts`
- Modify: `src/renderer/src/design/design-turn-prompt/design-mode-context.ts`

- [ ] **Step 1: Write failing bounded-summary tests**

```typescript
expect(prompt).toContain('skill:a11y')
expect(prompt).not.toContain(fullSkillBody)
expect(estimateTokens(prompt)).toBeLessThanOrEqual(2_000)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/design/design-context.test.ts src/renderer/src/design/design-composer-context.test.ts
```

Expected: FAIL until the selection contribution is included with a hard budget.

- [ ] **Step 3: Add bounded rendering and detail handles**

```typescript
type SelectedDesignContextSummary = { id: string; kind: string; version: string; summary: string; detailToolHandle: string }
```

Sort by kind/ID, cap each summary and total tokens, and keep it in dynamic turn context after the stable prefix.

- [ ] **Step 4: Run Design and loop regressions**

```powershell
npx vitest run src/renderer/src/design kun/src/loop/design-mode.test.ts kun/src/hooks/builtins/design-quality-hook.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit bounded injection**

```powershell
git add src/renderer/src/design
git commit -m "feat(design): inject bounded selected context"
```
