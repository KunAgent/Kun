import { describe, expect, it, vi } from 'vitest'
import type { BackgroundShellRecord } from '../contracts/background-shell.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { workbenchExecutionControl } from './runtime-workbench-execution.js'

function fixture() {
  const thread = createThreadRecord({ id: 'task-thread', title: 'Task', workspace: '/workspace', model: 'model' })
  const cancelled = createTurnRecord({ id: 'cancelled-turn', threadId: thread.id, prompt: 'Task', status: 'aborted' })
  thread.turns.push(cancelled)
  const background: BackgroundShellRecord[] = []
  const events: RuntimeEvent[] = []
  const executorActive = new Set<string>()
  const lease: { current: ThreadExecutionLease | null } = { current: null }
  const threads = { getMetadata: vi.fn(async (): Promise<typeof thread | null> => thread) }
  const shells = {
    listSessions: vi.fn((threadId?: string) => background.filter((entry) => !threadId || entry.threadId === threadId)),
    stopSession: vi.fn(async (id: string) => {
      const session = background.find((entry) => entry.id === id)
      if (session) session.status = 'stopped'
      return Boolean(session)
    }),
    stopThread: vi.fn(async (threadId: string) => {
      const sessions = background.filter((entry) => entry.threadId === threadId && entry.status === 'running')
      for (const session of sessions) session.status = 'stopped'
      return sessions.length
    })
  }
  const sessions = { highestSeq: vi.fn(async () => 2000), loadEventsSince: vi.fn(async () => events) }
  const control = workbenchExecutionControl({ threads, sessions, backgroundShells: shells,
    turns: { isTurnExecutionActive: (turnId) => executorActive.has(turnId) }, executionLeases: { owner: async () => lease.current } })
  const claim = (turnId: string) => {
    lease.current = { threadId: thread.id, turnId, ownerFlavor: 'production', ownerInstanceId: 'runtime', fencingToken: 1,
      acquiredAt: '2026-10-07T00:00:00.000Z', expiresAt: '2026-10-07T00:01:00.000Z' }
  }
  const shell = (id: string, turnId = cancelled.id) => background.push({ id, threadId: thread.id, turnId, command: 'sleep 60',
    cwd: '/workspace', shell: 'sh', status: 'running', startedAt: '2026-10-07T00:00:00.000Z', exitCode: null, output: '', detached: true })
  return { thread, cancelled, background, events, executorActive, lease, threads, shells, sessions, control, claim, shell }
}

describe('production Workbench cancellation execution proof', () => {
  it('allows another user turn to continue while confirming only the cancelled task stopped', async () => {
    const f = fixture()
    f.thread.turns.push(createTurnRecord({ id: 'user-turn', threadId: f.thread.id, prompt: 'Continue independently', status: 'running' }))
    f.claim('user-turn'); f.executorActive.add('user-turn'); f.shell('user-shell', 'user-turn')
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(true)
    expect(await f.control.proveStopped(f.thread.id, f.cancelled.id)).toBe(false)
  })

  it('requires the exact executor, lease, shell and turn to have stopped', async () => {
    const f = fixture()
    f.executorActive.add(f.cancelled.id)
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(false)
    f.executorActive.clear(); f.claim(f.cancelled.id)
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(false)
    f.lease.current = null; f.shell('task-shell')
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(false)
    await f.control.stopBackgroundExecution(f.thread.id, f.cancelled.id)
    f.cancelled.status = 'queued'
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(false)
    f.cancelled.status = 'aborted'
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(true)
  })

  it('stops only the cancelled turn shells and preserves the existing whole-thread stop API', async () => {
    const f = fixture()
    f.shell('task-shell'); f.shell('user-shell', 'user-turn')
    await f.control.stopBackgroundExecution(f.thread.id, f.cancelled.id)
    expect(f.shells.stopSession).toHaveBeenCalledExactlyOnceWith('task-shell')
    expect(f.shells.stopThread).not.toHaveBeenCalled()
    expect(f.background.find((entry) => entry.id === 'user-shell')?.status).toBe('running')
    await f.control.stopBackgroundExecution(f.thread.id)
    expect(f.shells.stopThread).toHaveBeenCalledExactlyOnceWith(f.thread.id)
  })

  it('uses durable terminal evidence for missing metadata without guessing from lease absence', async () => {
    const f = fixture()
    f.threads.getMetadata.mockResolvedValue(null)
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(false)
    f.events.push({ kind: 'turn_aborted', threadId: f.thread.id, turnId: 'other-turn', seq: 1800,
      timestamp: '2026-10-07T00:00:00.000Z' })
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(false)
    f.events.push({ ...f.events[0], turnId: f.cancelled.id, seq: 1900 })
    expect(await f.control.proveTurnStopped(f.thread.id, f.cancelled.id)).toBe(true)
    expect(f.sessions.loadEventsSince).toHaveBeenLastCalledWith(f.thread.id, 1000)
  })
})
