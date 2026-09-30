import { describe, expect, it } from 'vitest'
import { existingTaskWorkspaceOwner } from './task-workspace-owner.js'
import type { CreateTaskWorkspaceRequest, TaskWorkspaceRecord } from '../contracts/task-workspace.js'
const input: CreateTaskWorkspaceRequest = { ownerThreadId: 't', sourceRoot: '/repo', isolation: 'worktree', startFrom: { kind: 'default-branch' } }
const record = { ...input, workspaceId: 'w', state: 'creating' } as TaskWorkspaceRecord

describe('task workspace ownership', () => {
  it('returns the same owner while preparing and after completion', () => {
    expect(existingTaskWorkspaceOwner([record], input)).toBe(record)
    const ready = { ...record, state: 'ready' as const }
    expect(existingTaskWorkspaceOwner([ready], input)).toBe(ready)
  })
  it('rejects a second physical workspace with different intent', () => {
    expect(() => existingTaskWorkspaceOwner([record], { ...input, sourceRoot: '/elsewhere' })).toThrow('already owns')
  })
  it('preserves unit workspaces and permits replacement after explicit removal', () => {
    expect(existingTaskWorkspaceOwner([record], { ...input, unitId: 'worker' })).toBeUndefined()
    expect(existingTaskWorkspaceOwner([{ ...record, state: 'removed' }], input)).toBeUndefined()
  })
})
