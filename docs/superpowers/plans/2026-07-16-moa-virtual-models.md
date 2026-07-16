# MoA Virtual Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved MoA presets behave as normal selectable models while adding bounded parallel references, acting-model aggregation, multimodal planning, degradation, accounting, and effectiveness evaluation.

**Architecture:** Keep the existing `MoaDispatchModelClient` as virtual provider `moa`, but replace ad hoc model strings with stable `moa:<presetId>` catalog entries. Reference calls are no-tool advisor requests; the aggregator uses the original acting request and standard Kun streaming/tool/interrupt contracts.

**Tech Stack:** TypeScript, Zod, Kun ModelClient, Provider settings, SSE, Vitest, JSONL evaluation fixtures.

---

### Task 1: Version the Preset Contract and Validate Existing Models

**Files:**
- Modify: `kun/src/moa/contracts/moa-types.ts`
- Modify: `kun/src/moa/adapters/moa-config.ts`
- Modify: `kun/src/moa/adapters/moa-config.test.ts`
- Modify: `src/shared/seam/api.ts`

- [ ] **Step 1: Write failing recursive, missing-model, and modality tests**

```typescript
expect(validatePreset(recursivePreset, catalog).issues).toContainEqual(expect.objectContaining({ code: 'moa_recursive_reference' }))
expect(validatePreset(imagePreset, textOnlyCatalog).issues).toContainEqual(expect.objectContaining({ code: 'moa_aggregator_modality_mismatch' }))
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run kun/src/moa/adapters/moa-config.test.ts
```

Expected: FAIL because the current layered string schema cannot express stable account/model slots or modality policy.

- [ ] **Step 3: Add the versioned preset schema**

```typescript
const MoaModelSlotSchema = z.object({
  providerId: z.string().min(1), accountId: z.string().min(1), modelId: z.string().min(1),
  role: z.enum(['reference', 'aggregator']), reasoningEffort: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(), maxOutputTokens: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive(), modalityPolicy: z.enum(['native', 'derived_text', 'skip'])
})
```

Add preset concurrency, reference cap, context budget, fan-out cadence, failure policy, verification metadata, and migrate legacy layer presets deterministically.

- [ ] **Step 4: Run contract/config tests**

```powershell
npx vitest run kun/src/moa/contracts kun/src/moa/adapters/moa-config.test.ts src/shared/seam/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit preset contracts**

```powershell
git add kun/src/moa/contracts/moa-types.ts kun/src/moa/adapters/moa-config.ts kun/src/moa/adapters/moa-config.test.ts src/shared/seam/api.ts
git commit -m "feat(moa): version virtual model presets"
```

### Task 2: Publish MoA Through the Normal Model Catalog

**Files:**
- Modify: `kun/src/seam/types.ts`
- Modify: `kun/src/seam/registry.ts`
- Modify: `kun/src/seam/features/moa.feature.ts`
- Modify: `src/shared/default-composer-models.ts`
- Modify: `src/renderer/src/components/chat/composer-model-selection.ts`
- Modify: `src/renderer/src/components/chat/composer-model-selection.test.ts`

- [ ] **Step 1: Write a failing grouped-catalog test**

```typescript
expect(groups.find((group) => group.providerId === 'moa')?.models).toContainEqual(
  expect.objectContaining({ id: 'moa:balanced', providerId: 'moa' })
)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/components/chat/composer-model-selection.test.ts kun/src/seam/registry.test.ts
```

Expected: FAIL because extensions cannot yet contribute model catalog entries.

- [ ] **Step 3: Add `ModelCatalogEntry` contribution**

```typescript
export type ModelCatalogEntry = {
  providerId: string
  modelId: string
  label: string
  capabilities: { input: Array<'text' | 'image' | 'video'>; contextWindowTokens: number }
  source: 'configured' | 'extension'
}
```

Register enabled, valid presets as `providerId: 'moa'`, `modelId: 'moa:<id>'`; invalid presets remain in settings with issues but do not enter the picker.

- [ ] **Step 4: Run seam and picker tests**

```powershell
npx vitest run kun/src/seam src/renderer/src/components/chat/composer-model-selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit catalog contribution**

```powershell
git add kun/src/seam src/shared/default-composer-models.ts src/renderer/src/components/chat/composer-model-selection.ts src/renderer/src/components/chat/composer-model-selection.test.ts
git commit -m "feat(moa): expose presets as selectable models"
```

### Task 3: Make References Bounded No-Tool Advisors

**Files:**
- Modify: `kun/src/moa/adapters/moa-model-client.ts`
- Modify: `kun/src/moa/adapters/moa-model-client.test.ts`
- Modify: `kun/src/moa/adapters/moa-dispatch.test.ts`

- [ ] **Step 1: Write failing no-tool, concurrency, cancellation, and partial-failure tests**

```typescript
expect(referenceRequests.every((request) => request.tools.length === 0)).toBe(true)
expect(maxObservedConcurrency).toBeLessThanOrEqual(2)
expect(successfulAggregation.references).toEqual(['answer-a', 'answer-c'])
expect(abortObservedByAllRunningReferences).toBe(true)
```

- [ ] **Step 2: Verify failures**

```powershell
npx vitest run kun/src/moa/adapters/moa-model-client.test.ts kun/src/moa/adapters/moa-dispatch.test.ts
```

Expected: FAIL because references inherit the acting request tools and failure is handled at the whole-run level.

- [ ] **Step 3: Implement bounded reference execution**

```typescript
const advisorRequest = { ...request, tools: [], toolChoice: 'none', providerId: slot.providerId, model: slot.modelId }
const settled = await runBounded(slots, preset.maxConcurrency, request.abortSignal, executeAdvisor)
const usable = settled.filter(isFulfilledNonEmpty)
```

If no reference succeeds, call the aggregator with the original request and no injected reference section. Preserve deterministic slot order.

- [ ] **Step 4: Run model client tests**

```powershell
npx vitest run kun/src/moa/adapters/moa-model-client.test.ts kun/src/moa/adapters/moa-dispatch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit bounded advisors**

```powershell
git add kun/src/moa/adapters/moa-model-client.ts kun/src/moa/adapters/moa-model-client.test.ts kun/src/moa/adapters/moa-dispatch.test.ts
git commit -m "feat(moa): bound no-tool reference execution"
```

### Task 4: Add Context and Multimodal Planning

**Files:**
- Create: `kun/src/moa/services/moa-context-planner.ts`
- Test: `kun/src/moa/services/moa-context-planner.test.ts`
- Modify: `kun/src/moa/adapters/moa-model-client.ts`
- Modify: `kun/src/loop/turn-attachment-service.ts`

- [ ] **Step 1: Write failing budget and modality matrix tests**

```typescript
expect(plan.preserved.latestUserMessage).toBe(true)
expect(plan.referenceActions).toEqual(['native', 'derived_text', 'skip'])
expect(plan.estimatedTokens).toBeLessThanOrEqual(32_000)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run kun/src/moa/services/moa-context-planner.test.ts
```

Expected: FAIL because no planner exists.

- [ ] **Step 3: Implement deterministic planning**

```typescript
export type MoaContextPlan = {
  referenceInputs: PlannedReferenceInput[]
  aggregationBudgetTokens: number
  skipped: Array<{ slotId: string; reason: string }>
}
```

Budget stable system instructions and latest user input first, then reference summaries by configured priority. Pass native attachments when supported; otherwise use registered OCR/transcript/keyframe derivatives or skip explicitly.

- [ ] **Step 4: Run planner, attachment, and client tests**

```powershell
npx vitest run kun/src/moa kun/src/loop/turn-attachment-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit multimodal planning**

```powershell
git add kun/src/moa/services kun/src/moa/adapters/moa-model-client.ts kun/src/loop/turn-attachment-service.ts
git commit -m "feat(moa): plan bounded multimodal context"
```

### Task 5: Add Per-Slot Usage and Preset Editor

**Files:**
- Modify: `kun/src/moa/contracts/moa-types.ts`
- Modify: `kun/src/moa/adapters/moa-model-client.ts`
- Modify: `src/renderer/src/seam/features/moa/MoaPresets.tsx`
- Create: `src/renderer/src/seam/features/moa/MoaPresetEditor.tsx`
- Test: `src/renderer/src/seam/features/moa/MoaPresetEditor.test.tsx`

- [ ] **Step 1: Write failing usage and save tests**

```typescript
expect(trace.slots[0]).toMatchObject({ providerId: 'p1', inputTokens: 10, outputTokens: 20 })
expect(await savePreset(validDraft)).toMatchObject({ modelId: 'moa:review-board', valid: true })
```

- [ ] **Step 2: Verify failures**

```powershell
npx vitest run kun/src/moa src/renderer/src/seam/features/moa/MoaPresetEditor.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement accounting and editor controls**

Use provider/account/model menus from existing settings, segmented modality policies, numeric inputs for limits, and inline schema issues. Store no credentials in the preset.

- [ ] **Step 4: Run MoA UI/runtime tests**

```powershell
npx vitest run kun/src/moa src/renderer/src/seam/features/moa src/renderer/src/components/chat/composer-model-selection.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit configuration and accounting**

```powershell
git add kun/src/moa src/renderer/src/seam/features/moa
git commit -m "feat(moa): configure and account virtual models"
```

### Task 6: Build the A/B Evaluation Harness

**Files:**
- Create: `kun/src/moa/eval/moa-eval-runner.ts`
- Create: `kun/src/moa/eval/moa-eval-runner.test.ts`
- Create: `kun/src/moa/eval/fixtures/core.jsonl`
- Modify: `kun/package.json`

- [ ] **Step 1: Write a failing paired-score test**

```typescript
expect(report).toMatchObject({ sampleCount: 4, blinded: true })
expect(report.qualityDelta.confidenceLow).toBeGreaterThan(0)
expect(report.withinBudget).toBe(true)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run kun/src/moa/eval/moa-eval-runner.test.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement seeded paired evaluation**

Randomize answer order with a fixed seed, compare the preset against the strongest configured single model, record judge/human rubric, cost, p50/p95 latency, common failures, bootstrap confidence interval, and verification decision.

- [ ] **Step 4: Run tests and a fixture evaluation**

```powershell
npx vitest run kun/src/moa/eval/moa-eval-runner.test.ts
npm --prefix kun run eval:moa -- --fixture src/moa/eval/fixtures/core.jsonl --dry-run
```

Expected: tests PASS and dry-run validates the dataset without network calls.

- [ ] **Step 5: Commit the eval harness**

```powershell
git add kun/src/moa/eval kun/package.json
git commit -m "test(moa): add paired effectiveness evaluation"
```
