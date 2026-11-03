import type { AssistantTaskSource, AssistantTaskView } from '../../shared/assistant-mailbox'
import type { AssistantTaskStore } from './task-store'

type Session = { owner: string; tasks: AssistantTaskStore }
export type AssistantContinuationBridge = {
  verify(input: { taskId: string; owner: string; source: AssistantTaskSource }): Promise<{ goalCreatedAt: string; sourceFingerprint: string }>
  enqueue(input: { taskId: string; owner: string; source: AssistantTaskSource; resultId: string; goalCreatedAt: string; sourceFingerprint: string }): Promise<'queued' | 'ignored'>
  status?(input: { taskId: string; owner: string; source: AssistantTaskSource; resultId: string; goalCreatedAt: string; sourceFingerprint: string }): Promise<'queued' | 'completed' | 'failed' | 'revoked'>
}
export class AssistantContinuations {
  constructor(private readonly deps: {
    current(): Promise<Session | null>
    enabled(): Promise<boolean> | boolean
    membership(owner: string): Promise<void>
    bridge?: AssistantContinuationBridge
  }) {}
  async set(session: Session, taskId: string, enabled: boolean): Promise<AssistantTaskView> {
    const task = await session.tasks.task(taskId)
    if (!task) throw new Error('TASK_NOT_FOUND')
    if (!task.source || !this.deps.bridge) throw new Error('CONTINUATION_SOURCE_UNAVAILABLE')
    let goalCreatedAt: string | undefined, sourceFingerprint: string | undefined
    if (enabled) {
      if (!await this.deps.enabled()) throw new Error('CONTINUATION_FEATURE_DISABLED')
      await this.deps.membership(session.owner)
      const verified = await this.deps.bridge.verify({ taskId, owner: session.owner, source: task.source })
      goalCreatedAt = verified.goalCreatedAt; sourceFingerprint = verified.sourceFingerprint
      if ((await this.deps.current()) !== session) throw new Error('ACCOUNT_CHANGED')
    }
    return session.tasks.setContinuation(taskId, enabled, goalCreatedAt, sourceFingerprint)
  }
  async authority(input: { taskId: string; owner: string; source: AssistantTaskSource; resultId: string; goalCreatedAt: string; sourceFingerprint: string }) {
    if (!await this.deps.enabled()) return { authorized: false }
    const session = await this.deps.current()
    if (!session || session.owner !== input.owner) return { authorized: false }
    try { await this.deps.membership(session.owner) } catch (error) {
      const code = (error as { code?: string; message?: string })?.code ?? (error as { message?: string })?.message
      return ['vip_personal_assistant_required', 'LOGIN_REQUIRED', 'ACCOUNT_CHANGED'].includes(code ?? '')
        ? { authorized: false } : { authorized: false, unavailable: true }
    }
    if (!await this.deps.enabled() || (await this.deps.current()) !== session) return { authorized: false }
    const task = await session.tasks.task(input.taskId), result = await session.tasks.continuationResult(input.taskId)
    if (!task?.source || !task.continuation?.enabled || task.status !== 'done' || !result || result.id !== input.resultId
      || task.continuation.goalCreatedAt !== input.goalCreatedAt || task.continuation.sourceFingerprint !== input.sourceFingerprint || task.source.threadId !== input.source.threadId || task.source.turnId !== input.source.turnId || task.source.callId !== input.source.callId) return { authorized: false }
    return { authorized: true, result }
  }
  async flush(session: Session): Promise<void> {
    if (!this.deps.bridge) return
    if (this.deps.bridge.status) for (const task of await session.tasks.queuedContinuations()) {
      if (!task.source || !task.terminalResultId || !task.continuation?.goalCreatedAt || !task.continuation.sourceFingerprint) continue
      try {
        const state = await this.deps.bridge.status({ taskId: task.id, owner: session.owner, source: task.source, resultId: task.terminalResultId,
          goalCreatedAt: task.continuation.goalCreatedAt, sourceFingerprint: task.continuation.sourceFingerprint })
        if (state !== 'queued') await session.tasks.markContinuation(task.id, state)
      } catch { /* Keep status pending when the runtime is temporarily unavailable. */ }
    }
    for (const task of await session.tasks.pendingContinuations()) {
      if (!task.source || !task.terminalResultId || !task.continuation?.goalCreatedAt || !task.continuation.sourceFingerprint) continue
      const input = { taskId: task.id, owner: session.owner, source: task.source, resultId: task.terminalResultId, goalCreatedAt: task.continuation.goalCreatedAt, sourceFingerprint: task.continuation.sourceFingerprint }
      try {
        const authority = await this.authority(input)
        if (!authority.authorized) {
          if (!authority.unavailable) await session.tasks.markContinuation(task.id, 'revoked', 'authorization_changed')
          continue
        }
        const outcome = await this.deps.bridge.enqueue(input)
        await session.tasks.markContinuation(task.id, outcome === 'queued' ? 'queued' : 'revoked', outcome === 'ignored' ? 'source_unavailable' : undefined)
      } catch { /* Runtime unavailable: keep the durable pending intent for the next sync. */ }
    }
  }
}
