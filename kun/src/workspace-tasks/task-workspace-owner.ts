import type { CreateTaskWorkspaceRequest, TaskWorkspaceRecord } from '../contracts/task-workspace.js'

/** A top-level task has one physical workspace owner; workers have their own unit ids. */
export function existingTaskWorkspaceOwner(
  records: readonly TaskWorkspaceRecord[],
  input: CreateTaskWorkspaceRequest
): TaskWorkspaceRecord | undefined {
  if (input.unitId) return undefined
  const current = records.find((record) => !record.unitId && record.state !== 'removed')
  if (!current) return undefined
  if (current.sourceRoot !== input.sourceRoot || current.isolation !== input.isolation ||
    JSON.stringify(current.startFrom ?? null) !== JSON.stringify(input.startFrom ?? null)) {
    throw new Error('This task already owns a workspace. Reuse it or create a new task.')
  }
  return current
}
