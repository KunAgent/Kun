# Collaboration Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete local meeting and reception-employee workbench against the current local Kun service before enabling network transport.

**Architecture:** Add Collaboration as a `WorkbenchModeContribution`, with a two-section left rail and route-driven detail stage. Use dedicated human meeting/task/reception contracts and a local adapter so later encrypted network transport can replace the adapter without changing UI state machines.

**Tech Stack:** React, Zustand, TypeScript, Zod, Kun local HTTP/SSE, existing Automation reception employee records, Vitest, Playwright/Electron.

---

### Task 1: Define Human Collaboration Contracts

**Files:**
- Create: `src/shared/collaboration/contracts.ts`
- Create: `src/shared/collaboration/contracts.test.ts`
- Create: `src/shared/collaboration/api.ts`
- Modify: `src/shared/seam/index.ts`

- [ ] **Step 1: Write failing entity and transition tests**

```typescript
expect(MeetingSchema.parse(meeting).status).toBe('active')
expect(() => transitionTask(completedTask, 'accept')).toThrow(/invalid transition/i)
expect(EmployeeInvocationSchema.parse(invocation).status).toBe('awaiting_owner')
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/shared/collaboration/contracts.test.ts
```

Expected: FAIL because human Collaboration contracts do not exist.

- [ ] **Step 3: Define separate namespaces and state machines**

```typescript
export type HumanCollaborationEventKind =
  | `meeting_${string}`
  | `human_task_${string}`
  | `employee_invocation_${string}`
```

Define `Meeting`, `MeetingMember`, `HumanCollaborationTask`, `TaskParticipant`, `ReceptionEmployeePublication`, `EmployeeInvocation`, `Delivery`, and stable error envelopes. Do not reuse expert `CollaborationPlan/Task`.

- [ ] **Step 4: Run contracts**

```powershell
npx vitest run src/shared/collaboration/contracts.test.ts
```

Expected: PASS with all legal and illegal transitions covered.

- [ ] **Step 5: Commit contracts**

```powershell
git add src/shared/collaboration src/shared/seam/index.ts
git commit -m "feat(collaboration): define human workspace contracts"
```

### Task 2: Add a Local Collaboration Adapter

**Files:**
- Create: `src/main/collaboration/local-collaboration-store.ts`
- Test: `src/main/collaboration/local-collaboration-store.test.ts`
- Create: `src/main/collaboration/local-collaboration-service.ts`
- Test: `src/main/collaboration/local-collaboration-service.test.ts`
- Modify: `src/main/seam/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Write failing persistence/idempotency tests**

```typescript
const first = await service.createMeeting({ commandId: 'cmd-1', title: 'Release' })
const replay = await service.createMeeting({ commandId: 'cmd-1', title: 'Release' })
expect(replay.id).toBe(first.id)
expect((await restarted.listMeetings()).map((item) => item.id)).toContain(first.id)
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/local-collaboration-store.test.ts src/main/collaboration/local-collaboration-service.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement atomic local projection and typed IPC**

```typescript
export interface CollaborationClient {
  listMeetings(): Promise<Meeting[]>
  dispatch(command: HumanCollaborationCommand): Promise<HumanCollaborationCommandResult>
  subscribe(listener: (event: HumanCollaborationEvent) => void): () => void
}
```

Store versioned local fixtures under Kun dataDir, enforce command IDs and optimistic versions, and expose only parsed DTOs through `window.kunGui`.

- [ ] **Step 4: Run main/preload tests**

```powershell
npx vitest run src/main/collaboration src/main/seam src/preload
```

Expected: PASS.

- [ ] **Step 5: Commit local adapter**

```powershell
git add src/main/collaboration src/main/seam/index.ts src/preload/index.ts
git commit -m "feat(collaboration): add local workspace adapter"
```

### Task 3: Register Collaboration as a Top-Level Workbench Mode

**Files:**
- Modify: `src/renderer/src/seam/index.ts`
- Modify: `src/renderer/src/seam/features/collaboration/index.tsx`
- Modify: `src/renderer/src/components/workbench/WorkbenchLeftSidebar.tsx`
- Modify: `src/renderer/src/components/workbench/WorkbenchStageRouter.tsx`
- Modify: `src/renderer/src/components/workbench/useWorkbenchNavigationController.ts`
- Test: `src/renderer/src/components/workbench/WorkbenchStageRouter.test.tsx`

- [ ] **Step 1: Write a failing mode registration test**

```typescript
expect(listWorkbenchModes().map((mode) => mode.id)).toContain('collaboration')
expect(resolveStage({ mode: 'collaboration', entity: 'meeting', id: 'm1' })).toEqual(expect.objectContaining({ key: 'collaboration:meeting:m1' }))
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/components/workbench/WorkbenchStageRouter.test.tsx src/renderer/src/seam
```

Expected: FAIL because Collaboration is currently an Agent-capabilities panel.

- [ ] **Step 3: Add `WorkbenchModeContribution`**

```typescript
export type WorkbenchModeContribution = { id: string; label: string; icon: LucideIcon; renderSidebar: ComponentType; renderStage: ComponentType }
```

Register Collaboration next to Code/Write/Design and remove its duplicate capabilities panel route.

- [ ] **Step 4: Run navigation tests**

```powershell
npx vitest run src/renderer/src/components/workbench src/renderer/src/seam
```

Expected: PASS.

- [ ] **Step 5: Commit workbench registration**

```powershell
git add src/renderer/src/seam src/renderer/src/components/workbench
git commit -m "feat(collaboration): add top-level workbench mode"
```

### Task 4: Build the Two-Section Collaboration Sidebar

**Files:**
- Create: `src/renderer/src/collaboration/CollaborationSidebar.tsx`
- Test: `src/renderer/src/collaboration/CollaborationSidebar.test.tsx`
- Create: `src/renderer/src/collaboration/collaboration-store.ts`
- Test: `src/renderer/src/collaboration/collaboration-store.test.ts`

- [ ] **Step 1: Write failing list/selection/empty-state tests**

```typescript
expect(screen.getByRole('heading', { name: '会议' })).toBeTruthy()
expect(screen.getByRole('heading', { name: '接待数字员工' })).toBeTruthy()
fireEvent.click(screen.getByRole('button', { name: '发布评审会' }))
expect(store.getState().selection).toEqual({ kind: 'meeting', id: 'm1' })
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/collaboration/CollaborationSidebar.test.tsx src/renderer/src/collaboration/collaboration-store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement stable two-section layout**

Use fixed minimum/maximum section heights, scroll each list independently, display connection/sync badges without color-only meaning, and provide icon actions with tooltips for create/import/refresh.

- [ ] **Step 4: Run sidebar/store tests**

```powershell
npx vitest run src/renderer/src/collaboration/CollaborationSidebar.test.tsx src/renderer/src/collaboration/collaboration-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit sidebar**

```powershell
git add src/renderer/src/collaboration
git commit -m "feat(collaboration): build meeting and employee sidebar"
```

### Task 5: Build the Meeting Workspace Interactions

**Files:**
- Create: `src/renderer/src/collaboration/MeetingWorkspace.tsx`
- Test: `src/renderer/src/collaboration/MeetingWorkspace.test.tsx`
- Create: `src/renderer/src/collaboration/HumanTaskRoom.tsx`
- Test: `src/renderer/src/collaboration/HumanTaskRoom.test.tsx`
- Create: `src/renderer/src/collaboration/MeetingCreateDialog.tsx`

- [ ] **Step 1: Write failing create/task/decision/progress tests**

```typescript
fireEvent.click(screen.getByRole('button', { name: '创建会议' }))
expect(await screen.findByText('发布评审会')).toBeTruthy()
fireEvent.click(screen.getByRole('button', { name: '接受任务' }))
expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'human_task_accept' }))
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/renderer/src/collaboration/MeetingWorkspace.test.tsx src/renderer/src/collaboration/HumanTaskRoom.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement complete local meeting flows**

Include timeline, member/role management, structured target mentions, target-only accept/decline, task and participant dual status, local thread binding, explicit progress publication, review/revision/waive/complete, and keyboard/ARIA status announcements.

- [ ] **Step 4: Run meeting tests**

```powershell
npx vitest run src/renderer/src/collaboration src/shared/collaboration src/main/collaboration
```

Expected: PASS.

- [ ] **Step 5: Commit meeting workspace**

```powershell
git add src/renderer/src/collaboration
git commit -m "feat(collaboration): complete local meeting interactions"
```

### Task 6: Integrate Reception Employees and Local Kun Execution

**Files:**
- Create: `src/renderer/src/collaboration/ReceptionEmployeeDetail.tsx`
- Test: `src/renderer/src/collaboration/ReceptionEmployeeDetail.test.tsx`
- Create: `src/main/collaboration/reception-invocation-gateway.ts`
- Test: `src/main/collaboration/reception-invocation-gateway.test.ts`
- Create: `src/shared/automation-digital-employees.ts`

- [ ] **Step 1: Write failing publish/invoke/interrupt tests**

```typescript
expect(await gateway.invoke(request)).toMatchObject({ status: 'running', ownerDeviceId: 'local' })
expect(toolHost.allowedToolNames).toEqual(['read', 'grep'])
await gateway.interrupt(invocationId)
expect(turnService.interruptTurn).toHaveBeenCalled()
```

- [ ] **Step 2: Verify failure**

```powershell
npx vitest run src/main/collaboration/reception-invocation-gateway.test.ts src/renderer/src/collaboration/ReceptionEmployeeDetail.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement the local gateway and details**

Reuse Automation V2 employee records, create an isolated `receptionSessionContext`, intersect configured tools with local permission policy, require approvals, cap budget/timeout, stream sanitized progress, and connect interrupt to the real turn.

- [ ] **Step 4: Run local workbench verification**

```powershell
npx vitest run src/shared/collaboration src/main/collaboration src/renderer/src/collaboration
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit reception interactions**

```powershell
git add src/main/collaboration src/renderer/src/collaboration src/shared/automation-digital-employees.ts
git commit -m "feat(collaboration): invoke reception employees locally"
```
