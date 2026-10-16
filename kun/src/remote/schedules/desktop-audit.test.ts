import { describe, expect, it } from 'vitest'
import { DesktopScheduleAudit } from './desktop-audit.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
describe('Manager-owned desktop scheduler audit', () => {
  it('records only metadata, binds exact api request identity, and reads canonical terminal state without execution', async () => {
    const f = await remoteFixture(), audit = new DesktopScheduleAudit(f.runtime)
    try {
      const task = await f.code(), call: any = await f.h.turns.startTurn({ threadId: task.id, request: { prompt: 'private input', clientSurface: 'api', clientRequestId: 'scheduled_exact' } })
      const turnId = call.turnId, base = { id: 'run1', scheduleId: 'schedule1', clientRequestId: 'scheduled_exact', startedAt: new Date().toISOString() }
      await audit.record(base)
      expect((await audit.list({ scheduleId: 'schedule1' })).runs[0].status).toBe('needs_reconciliation')
      await expect(audit.record({ ...base, clientRequestId: 'different', threadId: task.id, turnId })).rejects.toThrow('AUDIT_CONFLICT')
      await audit.record({ ...base, threadId: task.id, turnId })
      await audit.record({ ...base, threadId: task.id, turnId })
      await f.h.turns.finishTurn({ threadId: task.id, turnId, status: 'completed' })
      const result = await audit.list({ scheduleId: 'schedule1' })
      expect(result.runs).toHaveLength(1)
      expect(result.runs[0]).toMatchObject({ id: 'run1', threadId: task.id, turnId, status: 'completed', coverage: 'recorded' })
      expect(JSON.stringify(result)).not.toContain('private input')
      expect((await f.h.threads.get(task.id))!.turns).toHaveLength(1)
      await expect(audit.record({ ...base, id: 'run2', clientRequestId: 'wrong', threadId: task.id, turnId })).rejects.toThrow('AUDIT_CONFLICT')
    } finally { await f.close() }
  })
  it('paginates all recorded attempts and rejects bodies containing prompts or paths', async () => {
    const f = await remoteFixture(), audit = new DesktopScheduleAudit(f.runtime)
    try {
      for (let i = 0; i < 3; i++) await audit.record({ id: 'run' + i, scheduleId: 'schedule1', clientRequestId: 'request' + i, startedAt: new Date().toISOString() })
      const first = await audit.list({ scheduleId: 'schedule1', limit: 2 })
      expect(first.hasMore).toBe(true)
      const second = await audit.list({ scheduleId: 'schedule1', limit: 2, beforeSeq: first.nextBeforeSeq })
      expect(second.hasMore).toBe(false)
      expect(new Set([...first.runs, ...second.runs].map((r) => r.id)).size).toBe(3)
      await expect(audit.record({ id: 'bad', scheduleId: 'schedule1', clientRequestId: 'request', startedAt: new Date().toISOString(), prompt: 'not metadata' })).rejects.toThrow()
      expect((await audit.list({ scheduleId: 'different' })).runs).toEqual([])
    } finally { await f.close() }
  })
})
