import { describe, expect, it, vi } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { PRIVATE_RESTART_RECOVERY_GRACE_MS, resumeStalledPrivateQueue } from './agent-direct-queue.js'

const turn = (id: string, status: Turn['status'], extra: Partial<Turn> = {}) => ({ id, status, ...extra }) as Turn
const thread = (turns: Turn[], extra: Partial<ThreadRecord> = {}) => ({ id: 'agent-chat-1', status: 'running', turns, ...extra }) as ThreadRecord
const deps = () => ({ turns: { resumeQueuedTurns: vi.fn(async () => undefined), notifyTurnQueued: vi.fn() } })

describe('resumeStalledPrivateQueue', () => {
  it('resumes a private message queued behind a stopped turn', async () => {
    const queued = turn('turn-2', 'queued')
    const d = deps()
    const resumed = await resumeStalledPrivateQueue(d as never, thread([turn('turn-1', 'aborted'), queued], {
      queueControl: { reason: 'user_stop', sourceTurnId: 'turn-1', pausedAt: new Date().toISOString() } }), queued)
    expect(resumed).toBe(true)
    expect(d.turns.resumeQueuedTurns).toHaveBeenCalledWith('agent-chat-1')
    expect(d.turns.notifyTurnQueued).toHaveBeenCalledWith('agent-chat-1')
  })

  it('resumes a message queued behind a turn orphaned by a restart', async () => {
    const queued = turn('turn-2', 'queued')
    const d = deps()
    expect(await resumeStalledPrivateQueue(d as never, thread([turn('turn-1', 'failed', { terminalCode: 'orphaned_after_restart' }), queued]), queued)).toBe(true)
  })

  it('leaves a queue that is only waiting for a running turn', async () => {
    const queued = turn('turn-2', 'queued')
    const d = deps()
    expect(await resumeStalledPrivateQueue(d as never, thread([turn('turn-1', 'running'), queued]), queued)).toBe(false)
    expect(await resumeStalledPrivateQueue(d as never, thread([turn('turn-1', 'completed'), queued]), queued)).toBe(false)
    expect(d.turns.resumeQueuedTurns).not.toHaveBeenCalled()
  })

  it('gives restart recovery its grace window first', async () => {
    const queued = turn('turn-2', 'queued')
    const d = deps()
    const now = Date.now()
    const paused = thread([turn('turn-1', 'failed', { terminalCode: 'orphaned_after_restart' }), queued], {
      queueControl: { reason: 'restart_recovery', sourceTurnId: 'turn-1', pausedAt: new Date(now).toISOString() } })
    expect(await resumeStalledPrivateQueue(d as never, paused, queued, now + 1000)).toBe(false)
    expect(await resumeStalledPrivateQueue(d as never, paused, queued, now + PRIVATE_RESTART_RECOVERY_GRACE_MS + 1)).toBe(true)
  })

  it('ignores turns that are not queued or still admitting', async () => {
    const d = deps()
    const stopped = { queueControl: { reason: 'user_stop' as const, sourceTurnId: 'turn-1', pausedAt: new Date().toISOString() } }
    const pending = turn('turn-2', 'queued', { admissionPending: true })
    expect(await resumeStalledPrivateQueue(d as never, thread([turn('turn-1', 'aborted'), pending], stopped), pending)).toBe(false)
    const done = turn('turn-2', 'completed')
    expect(await resumeStalledPrivateQueue(d as never, thread([turn('turn-1', 'aborted'), done], stopped), done)).toBe(false)
  })
})
