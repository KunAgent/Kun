# Expert Conversation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five-item expert/team activation queues, immutable expert execution profiles, Composer selection, observable parallel team execution, and real interruption/recovery.

**Architecture:** Extend the existing experts feature and collaboration orchestrator instead of creating a new runtime. Persist activation and task state under Kun dataDir; snapshot rules into versioned thread metadata and connect orchestration cancellation to Kun turn interruption.

**Tech Stack:** TypeScript, Zod, Kun HTTP/SSE, existing Thread/Turn services, React, Zustand, Vitest.

---

### Task 1: Add Versioned Execution Profiles

**Files:**
- Modify: `kun/src/contracts/threads.ts`
- Modify: `kun/src/domain/thread.ts`
- Modify: `kun/src/domain/thread-extension-metadata.test.ts`
- Modify: `src/renderer/src/store/chat-store-types.ts`

- [ ] **Step 1: Write failing normal/expert/team schema tests**

```typescript
expect(ConversationExecutionProfileSchema.parse({ kind: 'normal', version: 1 })).toEqual({ kind: 'normal', version: 1 })
expect(() => ConversationExecutionProfileSchema.parse({ kind: 'expert', version: 1, expertId: 'x' })).toThrow()
```

- [ ] **Step 2: Run the contract tests and observe failure**

```powershell
npx vitest run kun/src/domain/thread-extension-metadata.test.ts
```

Expected: FAIL because the discriminated profile and digest are not defined.

- [ ] **Step 3: Define the schema and migration function**

```typescript
const ExpertRuleSnapshotSchema = z.object({
  expertId: z.string().min(1), version: z.string().min(1), roleDefinition: z.string().min(1),
  behaviorRules: z.string(), outputPreferences: z.string(), allowedToolNames: z.array(z.string())
})
const ExpertTeamRuleSnapshotSchema = z.object({
  teamId: z.string().min(1), version: z.string().min(1), workflow: z.string().min(1),
  deliverableSpec: z.string().min(1), members: z.array(ExpertRuleSnapshotSchema).min(1)
})
export const ConversationExecutionProfileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('normal'), version: z.literal(1) }),
  z.object({ kind: z.literal('expert'), version: z.literal(1), expertId: z.string().min(1), snapshot: ExpertRuleSnapshotSchema, digest: z.string().min(1) }),
  z.object({ kind: z.literal('expert_team'), version: z.literal(1), teamId: z.string().min(1), snapshot: ExpertTeamRuleSnapshotSchema, digest: z.string().min(1) })
])
```

`normalizeConversationExecutionProfile()` reads legacy fields once and defaults ambiguous combinations to normal.

- [ ] **Step 4: Run contract and store tests**

```powershell
npx vitest run kun/src/domain/thread-extension-metadata.test.ts src/renderer/src/store/chat-store-thread-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit profile contracts**

```powershell
git add kun/src/contracts/threads.ts kun/src/domain/thread.ts kun/src/domain/thread-extension-metadata.test.ts src/renderer/src/store/chat-store-types.ts
git commit -m "feat(experts): version conversation execution profiles"
```

### Task 2: Persist Two Five-Item Activation Queues

**Files:**
- Modify: `kun/src/experts/services/expert-status-store.ts`
- Modify: `kun/src/experts/services/expert-status-store.test.ts`
- Modify: `kun/src/experts/services/expert-service.ts`
- Modify: `kun/src/experts/contracts/experts.ts`

- [ ] **Step 1: Write failing queue behavior tests**

```typescript
for (const id of ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']) await store.activate('expert', id)
expect((await store.snapshot()).activeExpertIds).toEqual(['e2', 'e3', 'e4', 'e5', 'e6'])
await store.activate('expert', 'e3')
expect((await store.snapshot()).activeExpertIds).toEqual(['e2', 'e4', 'e5', 'e6', 'e3'])
expect((await store.snapshot()).activeTeamIds).toEqual([])
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run kun/src/experts/services/expert-status-store.test.ts
```

Expected: FAIL because current status is boolean, not ordered queues.

- [ ] **Step 3: Implement ordered queue persistence**

```typescript
const MAX_ACTIVE_PER_KIND = 5
function activate(queue: string[], id: string): string[] {
  return [...queue.filter((value) => value !== id), id].slice(-MAX_ACTIVE_PER_KIND)
}
```

Persist `{ version: 2, activeExpertIds, activeTeamIds }` atomically; migrate legacy enabled data with stable `updatedAt`/ID ordering.

- [ ] **Step 4: Run status and expert integration tests**

```powershell
npx vitest run kun/src/experts/services/expert-status-store.test.ts kun/src/experts/services/expert-service.integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit queue behavior**

```powershell
git add kun/src/experts/services/expert-status-store.ts kun/src/experts/services/expert-status-store.test.ts kun/src/experts/services/expert-service.ts kun/src/experts/contracts/experts.ts
git commit -m "feat(experts): cap activation queues at five"
```

### Task 3: Expose CRUD, Templates, Activation, and Snapshots

**Files:**
- Modify: `kun/src/experts/services/collaboration-routes.ts`
- Modify: `kun/src/seam/features/experts.feature.ts`
- Modify: `src/shared/seam/api.ts`
- Modify: `src/shared/seam/api.test.ts`
- Modify: `src/renderer/src/seam/features/experts/ExpertsPlaza.tsx`
- Create: `src/renderer/src/seam/features/experts/ExpertEditorDialog.tsx`
- Test: `src/renderer/src/seam/features/experts/ExpertsPlaza.test.tsx`

- [ ] **Step 1: Write failing route and UI tests**

```typescript
expect(await expertsApi.activate('team', 'team-1')).toMatchObject({ activeTeamIds: ['team-1'] })
expect(screen.getByRole('button', { name: '选择专家样例' })).toBeTruthy()
```

- [ ] **Step 2: Run tests and verify missing endpoints/editor**

```powershell
npx vitest run src/shared/seam/api.test.ts src/renderer/src/seam/features/experts/ExpertsPlaza.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Add typed APIs and template-backed editor**

```typescript
type ExpertTemplate = { id: string; kind: 'expert' | 'team'; name: string; draft: CreateCustomExpertRequest | CreateCustomExpertTeamRequest }
```

Add list/detail/create/update/delete/activate/deactivate/snapshot routes and an editor that pre-fills one selected template, validates before submit, and never edits bundled resources in place.

- [ ] **Step 4: Run route, API, and UI tests**

```powershell
npx vitest run kun/src/experts src/shared/seam/api.test.ts src/renderer/src/seam/features/experts
```

Expected: PASS.

- [ ] **Step 5: Commit expert management UI**

```powershell
git add kun/src/experts/services/collaboration-routes.ts kun/src/seam/features/experts.feature.ts src/shared/seam src/renderer/src/seam/features/experts
git commit -m "feat(experts): add activation and template editor"
```

### Task 4: Add Composer Expert Mode

**Files:**
- Create: `src/renderer/src/components/chat/FloatingComposerConversationModePicker.tsx`
- Test: `src/renderer/src/components/chat/FloatingComposerConversationModePicker.test.tsx`
- Modify: `src/renderer/src/components/chat/FloatingComposer.tsx`
- Modify: `src/renderer/src/components/chat/FloatingComposer.test.ts`
- Modify: `src/renderer/src/store/chat-store-thread-actions.ts`

- [ ] **Step 1: Write failing mode and five-item rendering tests**

```typescript
expect(screen.getByRole('button', { name: '对话模式' })).toBeTruthy()
fireEvent.click(screen.getByRole('menuitemradio', { name: '专家模式' }))
expect(screen.getAllByTestId('active-expert-option')).toHaveLength(5)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/components/chat/FloatingComposerConversationModePicker.test.tsx src/renderer/src/components/chat/FloatingComposer.test.ts
```

Expected: FAIL because the control is absent.

- [ ] **Step 3: Implement picker and send payload**

```typescript
type ConversationModeSelection =
  | { kind: 'normal' }
  | { kind: 'expert'; targetKind: 'expert' | 'team'; targetId: string }
```

Render it immediately after `FloatingComposerExecutionPicker`; resolve the selected target to an immutable profile before creating/sending the thread turn.

- [ ] **Step 4: Run Composer and thread-action tests**

```powershell
npx vitest run src/renderer/src/components/chat/FloatingComposerConversationModePicker.test.tsx src/renderer/src/components/chat/FloatingComposer.test.ts src/renderer/src/store/chat-store-thread-actions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Composer mode**

```powershell
git add src/renderer/src/components/chat/FloatingComposerConversationModePicker.tsx src/renderer/src/components/chat/FloatingComposerConversationModePicker.test.tsx src/renderer/src/components/chat/FloatingComposer.tsx src/renderer/src/components/chat/FloatingComposer.test.ts src/renderer/src/store/chat-store-thread-actions.ts
git commit -m "feat(chat): add expert conversation mode"
```

### Task 5: Enforce Snapshot Rules in the Agent Loop

**Files:**
- Modify: `kun/src/experts/loop/expert-context-hook.ts`
- Modify: `kun/src/experts/loop/expert-context-hook.test.ts`
- Modify: `kun/src/loop/model-step-service.ts`

- [ ] **Step 1: Write failing immutable snapshot tests**

```typescript
expect(context.dynamicInstructions).toContain(snapshot.roleDefinition)
expect(context.dynamicInstructions).not.toContain(updatedExpert.roleDefinition)
expect(context.systemPrompt).toBe(stableSystemPrompt)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run kun/src/experts/loop/expert-context-hook.test.ts
```

Expected: FAIL if the hook resolves mutable records or changes the stable prefix.

- [ ] **Step 3: Inject verified snapshots as dynamic context**

```typescript
if (profile.kind !== 'normal') {
  verifyRuleDigest(profile.snapshot, profile.digest)
  ctx.dynamicInstructions.push(renderExpertRules(profile.snapshot))
}
```

- [ ] **Step 4: Run loop and cache regression tests**

```powershell
npx vitest run kun/src/experts/loop/expert-context-hook.test.ts kun/src/loop/model-step-service.test.ts kun/src/prompt
```

Expected: PASS; immutable system-prefix tests remain unchanged.

- [ ] **Step 5: Commit strict execution**

```powershell
git add kun/src/experts/loop/expert-context-hook.ts kun/src/experts/loop/expert-context-hook.test.ts kun/src/loop/model-step-service.ts
git commit -m "feat(experts): enforce immutable expert rules"
```

### Task 6: Add Real Team Abort, Progress, and Recovery

**Files:**
- Modify: `kun/src/experts/contracts/collaboration.ts`
- Modify: `kun/src/experts/services/collaboration-orchestrator.ts`
- Modify: `kun/src/experts/services/collaboration-task-service.ts`
- Modify: `kun/src/experts/services/collaboration-store.ts`
- Modify: `kun/src/experts/services/collaboration-routes.ts`
- Create: `kun/src/experts/services/collaboration-orchestrator.test.ts`
- Create: `src/renderer/src/seam/features/experts/ExpertTeamProgressDrawer.tsx`
- Test: `src/renderer/src/seam/features/experts/ExpertTeamProgressDrawer.test.tsx`

- [ ] **Step 1: Write failing abort and restart tests**

```typescript
await orchestrator.start(planId)
await orchestrator.interruptTask(taskId)
expect(turnService.interruptTurn).toHaveBeenCalledWith({ threadId, turnId })
expect((await restartedStore.getTask(taskId)).status).toBe('interrupted')
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run kun/src/experts/services/collaboration-orchestrator.test.ts
```

Expected: FAIL because cancellation does not reach the live turn and running restart state is not recoverable.

- [ ] **Step 3: Connect controllers, checkpoints, and idempotent commands**

```typescript
type CollaborationTaskControl = { commandId: string; action: 'pause' | 'continue' | 'interrupt' | 'retry' }
```

Persist child `threadId`, `turnId`, dependency revision, last event sequence, attempt, and checkpoint. On startup normalize `running` to `interrupted`. Continue the same turn only when the runtime can resume it; otherwise start a linked attempt.

- [ ] **Step 4: Add the progress drawer**

```typescript
type ExpertProgressRow = { taskId: string; expertId: string; status: CollaborationTaskStatus; summary: string; elapsedMs: number }
```

Use existing SSE events, icon buttons with tooltips, per-task controls, and team-wide controls. Do not poll while SSE is healthy.

- [ ] **Step 5: Run orchestration and UI tests**

```powershell
npx vitest run kun/src/experts src/renderer/src/seam/features/experts
npm run typecheck
npm run build:kun
```

Expected: PASS.

- [ ] **Step 6: Commit recoverable team execution**

```powershell
git add kun/src/experts src/renderer/src/seam/features/experts
git commit -m "feat(experts): make team execution recoverable"
```
