import { stat } from 'node:fs/promises'
import type { AppSettingsV1, ScheduleRunResult } from '../shared/app-settings'
import { KUN_TASK_WORKSPACES_PATH, kunTaskWorkspacePath } from '../shared/kun-endpoints'
import type { ScheduledTaskHarnessV1 } from '../shared/schedule-task-harness'
import type { TaskWorkspaceRecord } from '../shared/task-workspace'
import {
  asString,
  nestedRecord,
  parseJsonObject,
  runtimeErrorMessage,
  sleep,
  type RuntimeRequestFn
} from './schedule-runtime-helpers'

const WORKSPACE_READY_TIMEOUT_MS = 5 * 60_000
const WORKSPACE_POLL_MS = 1_000

export type ExternalPlanBuildRunOptions = {
  harness: ScheduledTaskHarnessV1
  prompt: string
  title: string
  displayText: string
  workspaceRoot: string
  clientRequestId?: string
  signal?: AbortSignal
}

/**
 * Scheduled handoff of a plan to an external Agent, the headless twin of the
 * renderer's interactive handoff: a fresh ADE conversation, a host task
 * worktree from the checkout's current HEAD, the thread bound to it once
 * ready, then one `planBuild` turn so Kun admission keeps the isolation rule.
 */
export async function runExternalPlanBuildViaRuntime(
  deps: { runtimeRequest: RuntimeRequestFn },
  settings: AppSettingsV1,
  options: ExternalPlanBuildRunOptions
): Promise<ScheduleRunResult> {
  const { harness, signal } = options
  const request = (path: string, method: string, body?: unknown) => deps.runtimeRequest(settings, path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {})
  })
  const workspace = options.workspaceRoot.trim()
  try {
    if (!(await stat(workspace)).isDirectory()) return { ok: false, message: `Workspace is not a directory: ${workspace}` }
  } catch {
    return { ok: false, message: `Workspace directory is unavailable: ${workspace}` }
  }
  const nativeLogin = harness.credentialMode === 'native-login'
  const route = {
    harnessId: harness.id,
    ...(harness.credentialMode ? { credentialMode: harness.credentialMode } : {}),
    ...(harness.providerId && !nativeLogin ? { providerId: harness.providerId } : {}),
    ...(harness.accountId && !nativeLogin ? { accountId: harness.accountId } : {})
  }

  const created = await request('/v1/threads', 'POST', {
    workspace,
    title: options.title,
    titleAuto: false,
    agentSurface: 'code',
    workspaceMode: 'ade',
    mode: 'agent',
    model: harness.model || 'default',
    ...route
  })
  if (!created.ok) return { ok: false, message: runtimeErrorMessage(created, 'Failed to create the build conversation.') }
  const threadId = asString(parseJsonObject(created.body)?.id)
  if (!threadId) return { ok: false, message: 'Failed to create the build conversation: missing thread id.' }

  const prepared = await request(KUN_TASK_WORKSPACES_PATH, 'POST', {
    ownerThreadId: threadId,
    sourceRoot: workspace,
    isolation: 'worktree',
    label: options.title,
    startFrom: { kind: 'current-head' }
  })
  if (!prepared.ok) {
    return { ok: false, message: runtimeErrorMessage(prepared, 'Failed to create the task worktree.') }
  }
  let record = nestedRecord(parseJsonObject(prepared.body)?.record) as Partial<TaskWorkspaceRecord>
  const workspaceId = asString(record.workspaceId)
  if (!workspaceId) return { ok: false, message: 'Failed to create the task worktree: missing id.' }
  const deadline = Date.now() + WORKSPACE_READY_TIMEOUT_MS
  while (record.state !== 'ready') {
    if (record.state === 'failed' || record.state === 'removed' || record.state === 'orphaned') {
      return { ok: false, message: `Task worktree ${record.state}.` }
    }
    if (Date.now() > deadline) return { ok: false, message: 'Task worktree was not ready in time.' }
    await sleep(WORKSPACE_POLL_MS, signal)
    const polled = await request(kunTaskWorkspacePath(workspaceId), 'GET')
    if (!polled.ok) return { ok: false, message: runtimeErrorMessage(polled, 'Failed to read the task worktree.') }
    const body = parseJsonObject(polled.body)
    record = nestedRecord(body?.record ?? body) as Partial<TaskWorkspaceRecord>
  }
  const path = asString(record.path)
  if (!path) return { ok: false, message: 'Task worktree is ready but has no path.' }
  const bound = await request(`/v1/threads/${encodeURIComponent(threadId)}`, 'PATCH', { workspace: path, taskWorkspaceId: workspaceId })
  if (!bound.ok) return { ok: false, message: runtimeErrorMessage(bound, 'Failed to bind the task worktree.') }

  const turn = await request(`/v1/threads/${encodeURIComponent(threadId)}/turns`, 'POST', {
    prompt: options.prompt,
    displayText: options.displayText,
    mode: 'agent',
    clientSurface: 'api',
    planBuild: true,
    // Headless: nobody is watching to answer a user_input prompt.
    disableUserInput: true,
    ...(options.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
    ...(harness.model ? { model: harness.model } : {}),
    ...(harness.reasoningEffort && harness.reasoningEffort !== 'auto' ? { reasoningEffort: harness.reasoningEffort } : {}),
    ...route
  })
  if (!turn.ok) return { ok: false, message: runtimeErrorMessage(turn, 'Failed to start the build.') }
  const parsedTurn = parseJsonObject(turn.body)
  const turnId = asString(nestedRecord(parsedTurn?.turn).id) || asString(parsedTurn?.turnId)
  if (!turnId) return { ok: false, message: 'Failed to start the build: missing turn id.' }
  return { ok: true, threadId, turnId, message: 'Started' }
}
