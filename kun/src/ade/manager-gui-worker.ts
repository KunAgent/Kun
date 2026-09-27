import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import { DEFAULT_APPROVAL_POLICY } from '../contracts/policy.js'
import { authorityFromTurn } from './permission-clamp.js'
import type { ManagerRuntime, ManagerRuntimeDeps, ManagerToolContext } from './manager-runtime.js'
import type { WorkerCreateResult } from './manager-runtime.js'

/**
 * GUI-originated worker create (11 §4.4 'new-worker' review target): the
 * manager thread is the task workspace's owner; no caller turn exists, so
 * authority projects from the thread alone and escalation declines closed.
 */
export async function guiCreateWorker(
  deps: ManagerRuntimeDeps,
  createWorker: ManagerRuntime['createWorker'],
  workspace: TaskWorkspaceRecord,
  input: { label: string; task: string; harnessId?: string },
  signal?: AbortSignal
): Promise<WorkerCreateResult> {
  const thread = await deps.threads.get(workspace.ownerThreadId).catch(() => null)
  const abortSignal = signal ?? new AbortController().signal
  const ctx: ManagerToolContext = {
    threadId: workspace.ownerThreadId,
    turnId: thread?.turns.at(-1)?.id ?? 'gui',
    workspace: workspace.sourceRoot,
    authority: thread
      ? authorityFromTurn(thread, undefined)
      : { kunPermissionMode: 'ask-for-approval', interactive: false },
    signal: abortSignal,
    awaitApproval: async () => 'deny'
  }
  return createWorker(
    ctx,
    {
      label: input.label,
      task: input.task,
      ...(input.harnessId ? { agent: { harnessId: input.harnessId } } : {}),
      workspace: { reuseTaskWorkspaceId: workspace.workspaceId }
    },
    {
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      workspace: workspace.sourceRoot,
      approvalPolicy: thread?.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
      abortSignal,
      awaitApproval: ctx.awaitApproval
    }
  )
}
