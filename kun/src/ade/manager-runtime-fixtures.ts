import type { Turn } from '../contracts/turns.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
export const managerRuntimeFixtureNow = '2026-09-26T00:00:00.000Z'
const NOW = managerRuntimeFixtureNow

export function turnRecord(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 'turn_w1',
    threadId: 'wrk_1',
    status: 'running',
    orchestration: 'direct',
    prompt: 'p',
    steering: [],
    createdAt: NOW,
    items: [],
    attachmentIds: [],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedDirectiveIds: [],
    injectedDirectiveSummaries: [],
    injectedInstructionSources: [],
    ...overrides
  }
}

export function childRunRecord(overrides: Partial<ChildRunRecord> = {}): ChildRunRecord {
  return {
    id: 'wrk_1',
    parentThreadId: 'thr_mgr',
    parentTurnId: 'turn_mgr_1',
    prompt: 'assignment',
    approvalReviewer: 'user',
    status: 'running',
    returnFormat: 'summary',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

export function workspaceRecord(state: TaskWorkspaceRecord['state']): TaskWorkspaceRecord {
  return {
    workspaceId: 'tws_1',
    ownerThreadId: 'thr_mgr',
    unitId: 'wrk_1',
    label: 'fix login',
    isolation: 'worktree',
    sourceRoot: '/repo',
    repositoryRoot: '/repo',
    path: '/repo/.worktrees/fix-login',
    startFrom: { kind: 'default-branch' },
    state,
    setup: { status: 'skipped', steps: [] },
    changedFiles: [],
    createdAt: NOW,
    updatedAt: NOW
  } as TaskWorkspaceRecord
}
