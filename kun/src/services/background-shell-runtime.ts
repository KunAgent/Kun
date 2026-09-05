import type { BackgroundShellRecord, BackgroundShellStatus } from '../contracts/background-shell.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from './turn-service.js'
import type { BackgroundShellHooks } from '../adapters/tool/builtin-tool-types.js'
import {
  backgroundShellNoticeDisplayText,
  formatBackgroundShellCompletionNotice
} from './background-shell-notice.js'
import { resolveTurnClientSurface } from '../loop/turn-context-resolver.js'
import { existsSync } from 'node:fs'
import { BACKGROUND_SHELL_OUTPUT_EXPIRED_NOTICE } from './background-shell-output.js'

export type BackgroundShellRuntimeDeps = {
  events: RuntimeEventRecorder
  threadStore: ThreadStore
  turns: TurnService
  nowIso: () => string
}

type RunTurnFn = (threadId: string, turnId: string) => Promise<unknown>

export const MAX_BACKGROUND_SHELL_SESSIONS = 512
export const BACKGROUND_SHELL_UPDATE_CHECKPOINT_INTERVAL_MS = 5_000

type UpdateCheckpoint = {
  lastPersistedAt: number
  pending?: BackgroundShellRecord
  timer?: NodeJS.Timeout
  writeInFlight?: Promise<void>
}

export class BackgroundShellRuntime {
  private readonly sessions = new Map<string, BackgroundShellRecord>()
  private readonly detachedIds = new Set<string>()
  private readonly updateCheckpoints = new Map<string, UpdateCheckpoint>()
  private runTurn: RunTurnFn | null = null
  private shuttingDown = false

  constructor(private readonly deps: BackgroundShellRuntimeDeps) {}

  bindAgentLoop(input: { runTurn: RunTurnFn }): void {
    this.runTurn = input.runTurn
  }

  bashHooks(): BackgroundShellHooks {
    return {
      onSessionStarted: (record) => this.handleSessionStarted(record),
      onSessionUpdated: (record) => this.handleSessionUpdated(record),
      onSessionSettled: (record) => this.handleSessionSettled(record),
      isDetachedSession: (sessionId) => this.detachedIds.has(sessionId)
    }
  }

  listSessions(threadId?: string): BackgroundShellRecord[] {
    const all = [...this.sessions.values()]
    const filtered = threadId ? all.filter((session) => session.threadId === threadId) : all
    return filtered
      .map((session) => this.visibleSession(session))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  getSession(sessionId: string): BackgroundShellRecord | null {
    const session = this.sessions.get(sessionId)
    return session ? this.visibleSession(session) : null
  }

  private stopHandler: ((sessionId: string) => Promise<boolean>) | null = null

  bindStopHandler(handler: (sessionId: string) => Promise<boolean>): void {
    this.stopHandler = handler
  }

  async stopSession(sessionId: string): Promise<boolean> {
    if (!this.stopHandler) return false
    return this.stopHandler(sessionId)
  }

  /**
   * Stop every live shell owned by one thread. Thread deletion uses this
   * before its lifecycle fence drains, so a detached command cannot outlive
   * the conversation that authorized it.
   */
  async stopThread(threadId: string): Promise<number> {
    const runningIds = [...this.sessions.values()]
      .filter((session) => session.threadId === threadId && session.status === 'running')
      .map((session) => session.id)
    await Promise.allSettled(runningIds.map((sessionId) => this.stopSession(sessionId)))
    return runningIds.length
  }

  /** Stop this runtime's active shells and prevent completion auto-turns. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const runningIds = [...this.sessions.values()]
      .filter((session) => session.status === 'running')
      .map((session) => session.id)
    await Promise.allSettled(runningIds.map((sessionId) => this.stopSession(sessionId)))
    await Promise.allSettled(
      [...this.updateCheckpoints.keys()].map((sessionId) => this.discardUpdateCheckpoint(sessionId))
    )
  }

  markDetached(sessionId: string): void {
    this.detachedIds.add(sessionId)
  }

  unmarkDetached(sessionId: string): void {
    this.detachedIds.delete(sessionId)
  }

  upsertSession(record: BackgroundShellRecord): void {
    this.rememberSession(record)
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.detachedIds.delete(sessionId)
    void this.discardUpdateCheckpoint(sessionId)
  }

  private sessionEventOutput(record: BackgroundShellRecord): {
    output: string
    outputTruncated?: true
    outputFilePath?: string
  } {
    return {
      output: record.output,
      ...(record.outputTruncated ? { outputTruncated: true as const } : {}),
      ...(record.outputFilePath ? { outputFilePath: record.outputFilePath } : {})
    }
  }

  private visibleSession(record: BackgroundShellRecord): BackgroundShellRecord {
    if (
      record.status === 'running' ||
      !record.outputFilePath ||
      existsSync(record.outputFilePath)
    ) return record
    return {
      ...record,
      output: BACKGROUND_SHELL_OUTPUT_EXPIRED_NOTICE,
      outputTruncated: true,
      outputFilePath: undefined
    }
  }

  private async handleSessionStarted(record: BackgroundShellRecord): Promise<void> {
    await this.discardUpdateCheckpoint(record.id)
    this.rememberSession(record)
    if (record.detached) this.detachedIds.add(record.id)
    await this.deps.events.record({
      kind: 'bash_session_started',
      threadId: record.threadId,
      turnId: record.turnId,
      sessionId: record.id,
      command: record.command,
      cwd: record.cwd,
      shell: record.shell,
      status: record.status,
      startedAt: record.startedAt,
      detached: record.detached,
      ...this.sessionEventOutput(record)
    })
    this.updateCheckpoints.set(record.id, { lastPersistedAt: Date.now() })
  }

  private async handleSessionUpdated(record: BackgroundShellRecord): Promise<void> {
    this.rememberSession(record)
    const checkpoint = this.updateCheckpoints.get(record.id) ?? {
      lastPersistedAt: Date.now()
    }
    checkpoint.pending = record
    this.updateCheckpoints.set(record.id, checkpoint)
    this.scheduleUpdateCheckpoint(record.id, checkpoint)
  }

  private scheduleUpdateCheckpoint(sessionId: string, checkpoint: UpdateCheckpoint): void {
    if (checkpoint.timer || checkpoint.writeInFlight) return
    const elapsed = Math.max(0, Date.now() - checkpoint.lastPersistedAt)
    const delay = Math.max(0, BACKGROUND_SHELL_UPDATE_CHECKPOINT_INTERVAL_MS - elapsed)
    checkpoint.timer = setTimeout(() => {
      checkpoint.timer = undefined
      void this.flushUpdateCheckpoint(sessionId, checkpoint).catch(() => undefined)
    }, delay)
    checkpoint.timer.unref?.()
  }

  private async flushUpdateCheckpoint(sessionId: string, checkpoint: UpdateCheckpoint): Promise<void> {
    if (this.updateCheckpoints.get(sessionId) !== checkpoint) return
    const record = checkpoint.pending
    if (!record) return
    checkpoint.pending = undefined
    checkpoint.lastPersistedAt = Date.now()
    const write = this.recordSessionUpdate(record)
    checkpoint.writeInFlight = write
    try {
      await write
    } catch (error) {
      if (this.updateCheckpoints.get(sessionId) === checkpoint && !checkpoint.pending) {
        checkpoint.pending = record
      }
      throw error
    } finally {
      if (checkpoint.writeInFlight === write) checkpoint.writeInFlight = undefined
      if (this.updateCheckpoints.get(sessionId) === checkpoint && checkpoint.pending) {
        this.scheduleUpdateCheckpoint(sessionId, checkpoint)
      }
    }
  }

  private async recordSessionUpdate(record: BackgroundShellRecord): Promise<void> {
    await this.deps.events.record({
      kind: 'bash_session_updated',
      threadId: record.threadId,
      turnId: record.turnId,
      sessionId: record.id,
      command: record.command,
      cwd: record.cwd,
      shell: record.shell,
      status: record.status,
      startedAt: record.startedAt,
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      exitCode: record.exitCode,
      detached: record.detached,
      ...this.sessionEventOutput(record),
      ...(record.error ? { error: record.error } : {})
    })
  }

  private async handleSessionSettled(record: BackgroundShellRecord): Promise<void> {
    await this.discardUpdateCheckpoint(record.id)
    this.rememberSession(record)
    await this.deps.events.record({
      kind: 'bash_session_completed',
      threadId: record.threadId,
      turnId: record.turnId,
      sessionId: record.id,
      command: record.command,
      cwd: record.cwd,
      shell: record.shell,
      status: record.status,
      startedAt: record.startedAt,
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      exitCode: record.exitCode,
      detached: record.detached,
      ...this.sessionEventOutput(record),
      ...(record.error ? { error: record.error } : {})
    })
    // A detached shell owns unfinished work even when it exits unsuccessfully
    // or is stopped. Always wake the agent for a terminal result so it can
    // inspect the output and report the real outcome without asking the user
    // to send a manual "continue" message (KunAgent/Kun#1031).
    if (!this.shuttingDown && record.detached && record.status !== 'running') {
      // Serialize per-thread wake-ups: two detached shells finishing at the
      // same moment would otherwise both observe "no running turn", one
      // startTurn would win, and the loser's completion notice would be lost
      // after its event was already persisted.
      await this.enqueueAgentNotice(record)
    }
    if (record.status !== 'running') {
      this.detachedIds.delete(record.id)
    }
  }

  private readonly agentNoticeQueues = new Map<string, Promise<void>>()

  private enqueueAgentNotice(record: BackgroundShellRecord): Promise<void> {
    const previous = this.agentNoticeQueues.get(record.threadId) ?? Promise.resolve()
    const task = previous.then(
      () => this.notifyAgent(record),
      () => this.notifyAgent(record)
    )
    const drained = task.catch(() => undefined).then(() => {
      if (this.agentNoticeQueues.get(record.threadId) === drained) {
        this.agentNoticeQueues.delete(record.threadId)
      }
    })
    this.agentNoticeQueues.set(record.threadId, drained)
    return task
  }

  private async discardUpdateCheckpoint(sessionId: string): Promise<void> {
    const checkpoint = this.updateCheckpoints.get(sessionId)
    if (!checkpoint) return
    this.updateCheckpoints.delete(sessionId)
    checkpoint.pending = undefined
    if (checkpoint.timer) {
      clearTimeout(checkpoint.timer)
      checkpoint.timer = undefined
    }
    await checkpoint.writeInFlight?.catch(() => undefined)
  }

  private async notifyAgent(record: BackgroundShellRecord): Promise<void> {
    if (this.shuttingDown) return
    const thread = await this.deps.threadStore.get(record.threadId)
    if (!thread || thread.status === 'archived') return
    const notice = formatBackgroundShellCompletionNotice(record)
    const displayText = backgroundShellNoticeDisplayText(record.id)
    const noticeMeta = {
      displayText,
      messageSource: 'background_shell' as const
    }
    if (thread.status === 'running') {
      const runningTurn = [...thread.turns].reverse().find((turn) => turn.status === 'running')
      if (runningTurn) {
        await this.deps.turns.steerTurn({
          threadId: record.threadId,
          turnId: runningTurn.id,
          text: notice,
          ...noticeMeta
        })
        return
      }
    }
    if (!this.runTurn) return
    const sourceTurn = thread.turns.find((turn) => turn.id === record.turnId) ?? thread.turns.at(-1)
    try {
      const started = await this.deps.turns.startTurn({
        threadId: record.threadId,
        request: {
          prompt: notice,
          ...(sourceTurn ? { clientSurface: resolveTurnClientSurface(sourceTurn) } : {}),
          ...(sourceTurn?.disableUserInput ? { disableUserInput: true } : {}),
          ...noticeMeta
        }
      })
      void this.runTurn(record.threadId, started.turnId)
    } catch {
      // A concurrent startTurn on the same thread won the race. Re-read the
      // thread and steer the completion notice into the running turn so the
      // persisted settlement still reaches the agent (#5).
      const current = await this.deps.threadStore.get(record.threadId)
      const runningTurn = current && current.status !== 'archived'
        ? [...current.turns].reverse().find((turn) => turn.status === 'running')
        : undefined
      if (runningTurn) {
        await this.deps.turns.steerTurn({
          threadId: record.threadId,
          turnId: runningTurn.id,
          text: notice,
          ...noticeMeta
        })
        return
      }
      throw new Error(
        `background shell ${record.id} completion could not reach the agent: startTurn conflicted and no running turn exists`
      )
    }
  }

  private rememberSession(record: BackgroundShellRecord): void {
    this.sessions.delete(record.id)
    this.sessions.set(record.id, record)
    let settled = [...this.sessions.values()].filter((session) => session.status !== 'running').length
    if (settled <= MAX_BACKGROUND_SHELL_SESSIONS) return
    for (const [id, session] of this.sessions) {
      if (session.status === 'running') continue
      this.sessions.delete(id)
      settled -= 1
      if (settled <= MAX_BACKGROUND_SHELL_SESSIONS) return
    }
  }
}

export function toBackgroundShellRecord(input: {
  id: string
  threadId: string
  turnId: string
  command: string
  cwd: string
  shell: string
  status: BackgroundShellStatus
  startedAt: string
  finishedAt?: string
  exitCode: number | null
  output: string
  outputTruncated?: boolean
  outputFilePath?: string
  error?: string
  detached: boolean
}): BackgroundShellRecord {
  return {
    id: input.id,
    threadId: input.threadId,
    turnId: input.turnId,
    command: input.command,
    cwd: input.cwd,
    shell: input.shell,
    status: input.status,
    startedAt: input.startedAt,
    ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
    exitCode: input.exitCode,
    output: input.output,
    ...(input.outputTruncated ? { outputTruncated: true } : {}),
    ...(input.outputFilePath ? { outputFilePath: input.outputFilePath } : {}),
    ...(input.error ? { error: input.error } : {}),
    detached: input.detached
  }
}
