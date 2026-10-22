import { createHash } from 'node:crypto'
import { CreateThreadRequest, type ThreadRecord } from '../contracts/threads.js'
import { StartTurnRequest } from '../contracts/turns.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type {
  TaskSuggestionFailure,
  TaskSuggestionIntent,
  TaskSuggestionResult,
  TaskSuggestionTask
} from '../contracts/task-suggestions.js'
import type { ThreadService } from '../services/thread-service.js'
import type { TurnService } from '../services/turn-service.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { SubagentProfileConfig } from '../contracts/capabilities.js'
import type { AgentRoster } from './agent-roster.js'

const WORKTREE_POLL_MS = 400
const WORKTREE_TIMEOUT_MS = 180_000
const SUMMARY_CHARS = 1_200

export type TaskSuggestionLauncherDeps = {
  threads: Pick<ThreadService, 'getMetadata' | 'get' | 'create' | 'update' | 'fork'>
  turns: Pick<TurnService, 'enqueueTurn'>
  taskWorkspaces?: Pick<TaskWorkspaceService, 'create' | 'get'>
  /** Resolves a card route's `profileId` into the session's role. */
  roster?: Pick<AgentRoster, 'resolve'>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** Ids written while a launch progresses, so a restart resumes the same thread and worktree. */
export type TaskLaunchProgress = Partial<Pick<TaskSuggestionTask, 'threadId' | 'taskWorkspaceId' | 'branch'>>

export type TaskLaunchOutcome = {
  threadId: string
  turnId: string
  taskWorkspaceId?: string
  branch?: string
}

export type TaskTurnInspection =
  | { status: 'missing' }
  | { status: 'queued' | 'running' }
  | { status: 'completed' | 'failed' | 'aborted'; result: TaskSuggestionResult }

/** A start failure with the code the card turns into a recovery action. */
export class TaskLaunchError extends Error {
  constructor(readonly failure: TaskSuggestionFailure) {
    super(failure.message)
    this.name = 'TaskLaunchError'
  }
}

export function classifyTaskLaunchError(error: unknown): TaskSuggestionFailure {
  if (error instanceof TaskLaunchError) return error.failure
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
  if (/ENOSPC|no space left|disk (is )?full|not enough (disk )?space/i.test(message)) return { code: 'disk_space', message }
  if (/already exists|already checked out|is already used by worktree|worktree .*(locked|exists)|branch .* exists/i.test(message)) {
    return { code: 'worktree_conflict', message }
  }
  if (/quota|rate.?limit|\b429\b|insufficient (balance|credit|quota)|usage limit/i.test(message)) return { code: 'quota', message }
  if (/harness|not installed|not logged in|unknown agent|agent .*unavailable|login required|not authenticated|credential/i.test(message)) {
    return { code: 'agent_unavailable', message }
  }
  return { code: 'runtime', message }
}

/** Deterministic per attempt: a crash mid-launch reaches the same thread and turn again. */
export function taskThreadId(intentId: string, taskId: string, attempt: number): string {
  return `thr_task_${createHash('sha256').update(`${intentId}\0${taskId}\0${attempt}`).digest('hex').slice(0, 24)}`
}

export const taskTurnRequestId = (intentId: string, taskId: string, attempt: number): string =>
  `task-${intentId}-${taskId}-${attempt}`.slice(0, 256)

/** The brief the task session starts from; also what the user sees as the first message. */
export function taskBriefText(task: TaskSuggestionTask, position: { index: number; total: number }): string {
  const lines = [`## ${position.index}/${position.total} · ${task.title}`]
  if (task.area) lines.push(`_${task.area}_`)
  lines.push('', '### Goal', task.brief.goal)
  if (task.brief.scope.length) lines.push('', '### Scope', ...task.brief.scope.map((entry) => `- ${entry}`))
  if (task.brief.done.length) lines.push('', '### Done when', ...task.brief.done.map((entry) => `- ${entry}`))
  return lines.join('\n')
}

/** The same brief as the user sees it: user messages render as plain text. */
export function taskBriefDisplayText(task: TaskSuggestionTask, position: { index: number; total: number }): string {
  const lines = [`${position.index}/${position.total} · ${task.title}`]
  if (task.area) lines.push(task.area)
  lines.push('', 'Goal', task.brief.goal)
  if (task.brief.scope.length) lines.push('', 'Scope', ...task.brief.scope.map((entry) => `• ${entry}`))
  if (task.brief.done.length) lines.push('', 'Done when', ...task.brief.done.map((entry) => `• ${entry}`))
  return lines.join('\n')
}

/** A roster role the task session plays. */
type TaskRole = { id: string; profile: SubagentProfileConfig }

function taskPrompt(
  task: TaskSuggestionTask,
  position: { index: number; total: number },
  parentTitle: string,
  branch?: string,
  role?: TaskRole
): string {
  // A created session carries the role as its persona; a forked one keeps the
  // source conversation's thread, so its role travels in the brief instead.
  const roleBrief = role
    ? task.inheritContext && role.profile.systemPrompt?.trim()
      ? ['### Role', `${role.profile.name ?? role.id}`, role.profile.systemPrompt.trim(), '']
      : [`Role: ${role.profile.name ?? role.id}`, '']
    : []
  return [
    ...roleBrief,
    taskBriefText(task, position),
    '',
    `This task was split off from the conversation "${parentTitle}" and runs in its own session` +
      (branch ? ` inside an isolated git worktree on branch \`${branch}\`.` : '.') +
      ' Work on it as you normally would. Finish with a short summary of what changed, how you verified it, and anything left open.'
  ].join('\n')
}

export class TaskSuggestionLauncher {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(private readonly deps: TaskSuggestionLauncherDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.now = deps.now ?? Date.now
  }

  async launch(
    intent: TaskSuggestionIntent,
    task: TaskSuggestionTask,
    persist: (progress: TaskLaunchProgress) => Promise<void>
  ): Promise<TaskLaunchOutcome> {
    const { threads } = this.deps
    const parent = await threads.getMetadata(intent.source.threadId)
    if (!parent) throw new TaskLaunchError({ code: 'runtime', message: 'The suggesting conversation no longer exists.' })
    const index = intent.tasks.findIndex((entry) => entry.id === task.id) + 1
    const position = { index, total: intent.tasks.length }
    const role = await this.taskRole(task, parent.workspace)
    let thread = await this.ensureThread(intent, task, parent, position, role)
    if (thread.id !== task.threadId) await persist({ threadId: thread.id })
    let branch = task.branch
    if (task.worktree && !thread.taskWorkspaceId) {
      const record = await this.ensureWorktree(task, thread, parent.workspace, persist)
      thread = await threads.update(thread.id, { taskWorkspaceId: record.workspaceId, workspace: record.path })
      branch = record.branch
      if (branch) await persist({ branch })
    } else if (thread.taskWorkspaceId && !branch) {
      branch = this.deps.taskWorkspaces?.get(thread.taskWorkspaceId)?.branch
    }
    const clientRequestId = taskTurnRequestId(intent.intentId, task.id, task.attempt)
    const fresh = await threads.getMetadata(thread.id) ?? thread
    const existing = fresh.turns.find((turn) => turn.clientRequestId === clientRequestId)
    const outcome = (turnId: string): TaskLaunchOutcome => ({
      threadId: thread.id, turnId,
      ...(thread.taskWorkspaceId ? { taskWorkspaceId: thread.taskWorkspaceId } : {}),
      ...(branch ? { branch } : {})
    })
    if (existing) return outcome(existing.id)
    const route = task.route
    const admitted = await this.deps.turns.enqueueTurn({ threadId: thread.id, request: StartTurnRequest.parse({
      prompt: taskPrompt(task, position, parent.title, branch, role),
      displayText: taskBriefDisplayText(task, position),
      clientRequestId,
      model: route.model || parent.model,
      ...(route.providerId ? { providerId: route.providerId } : {}),
      ...(route.agentId !== 'kun' ? { harnessId: route.agentId } : {}),
      ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}),
      agentSurface: 'code', mode: 'agent', enqueueIfBusy: true,
      attachmentIds: [], composerContexts: [], fileReferences: []
    }) })
    return outcome(admitted.turnId)
  }

  /**
   * The suggesting turn's route and workspace; new task sessions inherit them.
   * Returns null for threads that cannot own cards (task, side, room, worker).
   */
  async describeSource(threadId: string, turnId: string): Promise<
    { workspace: string; route: TaskSuggestionTask['route'] } | { refused: string }
  > {
    const thread = await this.deps.threads.getMetadata(threadId)
    if (!thread) return { refused: 'This conversation is not available.' }
    const relation = thread.relation ?? 'primary'
    if (relation === 'task' || relation === 'side' || thread.roomContext || thread.executionUnit) {
      return { refused: 'Only a top-level conversation can suggest task sessions; finish this work here instead.' }
    }
    const turn = thread.turns.find((entry) => entry.id === turnId)
    const harness = turn?.harnessId ?? thread.harnessId
    return { workspace: thread.workspace, route: {
      agentId: harness && harness !== 'kun' ? harness : 'kun',
      ...((turn?.model ?? thread.model) ? { model: turn?.model ?? thread.model } : {}),
      ...((turn?.providerId ?? thread.providerId) ? { providerId: turn?.providerId ?? thread.providerId } : {}),
      ...(turn?.credentialMode ? { credentialMode: turn.credentialMode } : {})
    } }
  }

  /** Where the first task turn stands, with a result once it settled. */
  async inspect(task: TaskSuggestionTask): Promise<TaskTurnInspection> {
    if (!task.threadId || !task.turnId) return { status: 'missing' }
    const thread = await this.deps.threads.get(task.threadId)
    const turn = thread?.turns.find((entry) => entry.id === task.turnId)
    if (!thread || !turn) return { status: 'missing' }
    if (turn.status === 'queued' || turn.status === 'running') return { status: turn.status }
    const lastText = [...turn.items].reverse().find((item) => item.kind === 'assistant_text')
    const lastError = [...turn.items].reverse().find((item) => item.kind === 'error')
    const workspace = thread.taskWorkspaceId ? this.deps.taskWorkspaces?.get(thread.taskWorkspaceId) : undefined
    const summary = lastText && 'text' in lastText ? lastText.text.trim() : ''
    const error = lastError && 'message' in lastError ? String(lastError.message).trim() : ''
    return { status: turn.status, result: {
      turnStatus: turn.status,
      ...(summary ? { summary: clip(summary, SUMMARY_CHARS) } : {}),
      ...(turn.status !== 'completed' && error ? { error: clip(error, 2_000) } : {}),
      ...(workspace && workspace.changedFiles.length ? { changedFiles: workspace.changedFiles.length } : {})
    } }
  }

  /** The roster role a card row names; a delegation-only role cannot lead a session. */
  private async taskRole(task: TaskSuggestionTask, workspace: string): Promise<TaskRole | undefined> {
    const profileId = task.route.profileId?.trim()
    if (!profileId) return undefined
    if (!this.deps.roster) {
      throw new TaskLaunchError({ code: 'agent_unavailable', message: 'The agent roster is unavailable; pick only an engine for this task.' })
    }
    const resolution = await this.deps.roster.resolve(profileId, {
      lane: 'conversation',
      workspace,
      engineOverridden: true
    })
    if (!resolution.ok) throw new TaskLaunchError({ code: 'agent_unavailable', message: resolution.message })
    if (resolution.profile.mode === 'subagent') {
      throw new TaskLaunchError({
        code: 'agent_unavailable',
        message: `${resolution.profile.name ?? profileId} is a delegation-only role and cannot lead a task session.`
      })
    }
    return { id: resolution.id, profile: resolution.profile }
  }

  private async ensureThread(
    intent: TaskSuggestionIntent,
    task: TaskSuggestionTask,
    parent: ThreadRecord,
    position: { index: number; total: number },
    role?: TaskRole
  ): Promise<ThreadRecord> {
    const { threads } = this.deps
    const taskOrigin = { intentId: intent.intentId, taskId: task.id, ...position }
    if (task.threadId) {
      const known = await threads.getMetadata(task.threadId)
      if (known) return known
    }
    const id = taskThreadId(intent.intentId, task.id, task.attempt)
    const existing = await threads.getMetadata(id)
    if (existing) return existing
    const route = task.route
    const harnessId = route.agentId !== 'kun' ? route.agentId : undefined
    if (task.inheritContext) {
      // Forks receive a fresh id; the caller persists it before any later step.
      const fork = await threads.fork(parent.id, { relation: 'task', title: task.title })
      return threads.update(fork.id, { taskOrigin, ...(harnessId ? { harnessId } : {}) })
    }
    return threads.create(CreateThreadRequest.parse({
      title: task.title, titleAuto: false, workspace: parent.workspace,
      model: route.model || parent.model,
      ...(route.providerId ? { providerId: route.providerId } : {}),
      ...(harnessId ? { harnessId } : {}),
      ...(route.credentialMode ? { credentialMode: route.credentialMode } : {}),
      ...(role ? { agentId: role.id } : {}),
      ...(role?.profile.systemPrompt?.trim() ? { systemPrompt: role.profile.systemPrompt.trim() } : {}),
      agentSurface: 'code', mode: 'agent',
      approvalPolicy: parent.approvalPolicy, sandboxMode: parent.sandboxMode, approvalReviewer: parent.approvalReviewer
    }), { id, title: task.title, relation: 'task', parentThreadId: parent.id, taskOrigin })
  }

  private async ensureWorktree(
    task: TaskSuggestionTask,
    thread: ThreadRecord,
    sourceRoot: string,
    persist: (progress: TaskLaunchProgress) => Promise<void>
  ): Promise<TaskWorkspaceRecord> {
    const workspaces = this.deps.taskWorkspaces
    if (!workspaces) throw new TaskLaunchError({ code: 'runtime', message: 'Isolated worktrees are unavailable in this runtime.' })
    let record = task.taskWorkspaceId ? workspaces.get(task.taskWorkspaceId) : undefined
    if (!record) {
      record = workspaces.create({ ownerThreadId: thread.id, sourceRoot, isolation: 'worktree',
        label: task.title.slice(0, 120), startFrom: { kind: 'current-head' } })
      await persist({ taskWorkspaceId: record.workspaceId })
    }
    const deadline = this.now() + WORKTREE_TIMEOUT_MS
    for (;;) {
      const current = workspaces.get(record.workspaceId)
      if (!current) throw new TaskLaunchError({ code: 'runtime', message: 'The isolated worktree was removed before the task started.' })
      if (current.state === 'ready') return current
      if (current.state === 'failed' || current.state === 'conflict') {
        throw new TaskLaunchError(classifyTaskLaunchError(new Error(current.lastError ?? 'Creating the isolated worktree failed.')))
      }
      if (this.now() > deadline) throw new TaskLaunchError({ code: 'runtime', message: 'Preparing the isolated worktree timed out.' })
      await this.sleep(WORKTREE_POLL_MS)
    }
  }
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
