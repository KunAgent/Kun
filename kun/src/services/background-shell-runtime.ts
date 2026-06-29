import type { BackgroundShellRecord, BackgroundShellStatus } from '../contracts/background-shell.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { TurnService } from './turn-service.js'
import type { BackgroundShellHooks } from '../adapters/tool/builtin-tool-types.js'
import {
  backgroundShellNoticeDisplayText,
  formatBackgroundShellCompletionNotice
} from './background-shell-notice.js'

export type BackgroundShellRuntimeDeps = {
  events: RuntimeEventRecorder
  threadStore: ThreadStore
  turns: TurnService
  nowIso: () => string
}

type RunTurnFn = (threadId: string, turnId: string) => Promise<unknown>

export class BackgroundShellRuntime {
  private readonly sessions = new Map<string, BackgroundShellRecord>()
  private readonly detachedIds = new Set<string>()
  private runTurn: RunTurnFn | null = null

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
    return filtered.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  getSession(sessionId: string): BackgroundShellRecord | null {
    return this.sessions.get(sessionId) ?? null
  }

  private stopHandler: ((sessionId: string) => Promise<boolean>) | null = null

  bindStopHandler(handler: (sessionId: string) => Promise<boolean>): void {
    this.stopHandler = handler
  }

  async stopSession(sessionId: string): Promise<boolean> {
    if (!this.stopHandler) return false
    return this.stopHandler(sessionId)
  }

  markDetached(sessionId: string): void {
    this.detachedIds.add(sessionId)
  }

  unmarkDetached(sessionId: string): void {
    this.detachedIds.delete(sessionId)
  }

  upsertSession(record: BackgroundShellRecord): void {
    this.sessions.set(record.id, record)
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.detachedIds.delete(sessionId)
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

  private async handleSessionStarted(record: BackgroundShellRecord): Promise<void> {
    this.sessions.set(record.id, record)
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
  }

  private async handleSessionUpdated(record: BackgroundShellRecord): Promise<void> {
    this.sessions.set(record.id, record)
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
    this.sessions.set(record.id, record)
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
    if (record.detached && record.status === 'completed' && record.exitCode === 0) {
      await this.notifyAgent(record)
    }
    if (record.status !== 'running') {
      this.detachedIds.delete(record.id)
    }
  }

  private async notifyAgent(record: BackgroundShellRecord): Promise<void> {
    const thread = await this.deps.threadStore.get(record.threadId)
    if (!thread) return
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
    const started = await this.deps.turns.startTurn({
      threadId: record.threadId,
      request: {
        prompt: notice,
        ...noticeMeta
      }
    })
    void this.runTurn(record.threadId, started.turnId)
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
