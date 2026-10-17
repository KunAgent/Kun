import { z } from 'zod'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { Router } from '../../server/router.js'
import { authorize } from '../../server/routes/route-auth.js'
import { readJsonBody } from '../../server/read-json-body.js'
import { jsonResponse } from '../../server/response.js'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const Audit = z.object({ id: Id, scheduleId: Id, clientRequestId: Id, startedAt: z.string().datetime(),
  threadId: Id.optional(), turnId: Id.optional() }).strict()
type Audit = z.infer<typeof Audit>
/** Local-owner metadata ledger only. Reading/reconciling never starts or retries a task. */
export class DesktopScheduleAudit {
  constructor(private runtime: ServerRuntime) {}
  async record(raw: unknown) {
    const input = Audit.parse(raw), rooms = this.runtime.rooms!
    return rooms.exclusive(async () => {
      const old = await rooms.deps.store.get<Audit>('desktop_schedule_run', input.id)
      if (old && (old.value.scheduleId !== input.scheduleId || old.value.clientRequestId !== input.clientRequestId ||
          old.value.startedAt !== input.startedAt || old.value.turnId && old.value.turnId !== input.turnId ||
          old.value.threadId && old.value.threadId !== input.threadId)) throw new Error('AUDIT_CONFLICT')
      if (old && JSON.stringify(old.value) === JSON.stringify(input)) return { recorded: true }
      if (input.threadId && input.turnId) {
        const turn = await this.runtime.turnService.getTurn(input.threadId, input.turnId)
        if (!turn || turn.clientRequestId !== input.clientRequestId || turn.clientSurface !== 'api') throw new Error('AUDIT_CONFLICT')
      }
      await rooms.deps.store.commit({ requestId: input.id + (input.turnId ? '-bound' : '-begin'),
        checks: [{ kind: 'desktop_schedule_run', id: input.id, expectedRevision: old?.revision ?? null }],
        puts: [{ kind: 'desktop_schedule_run', id: input.id, taskId: input.scheduleId, value: input }] })
      return { recorded: true }
    })
  }
  async list(raw: unknown) {
    const p = z.object({ scheduleId: Id, beforeSeq: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(50).default(20) }).strict().parse(raw)
    const rows = await this.runtime.rooms!.deps.store.list<Audit>('desktop_schedule_run', { taskId: p.scheduleId,
      beforeSeq: p.beforeSeq, limit: p.limit + 1 })
    const runs = await Promise.all(rows.slice(0, p.limit).map(async ({ value }) => {
      const turn = value.threadId && value.turnId ? await this.runtime.turnService.getTurn(value.threadId, value.turnId) : null
      const verified = turn?.clientRequestId === value.clientRequestId && turn?.clientSurface === 'api'
      return { id: value.id, scheduleId: value.scheduleId, startedAt: value.startedAt,
        status: verified ? turn!.status : 'needs_reconciliation',
        ...(verified ? { threadId: value.threadId, turnId: value.turnId, finishedAt: turn!.finishedAt } : {}), coverage: 'recorded' as const }
    }))
    return { runs, hasMore: rows.length > p.limit, nextBeforeSeq: rows.length > p.limit ? rows[p.limit - 1]!.seq : undefined }
  }
}
export function registerDesktopScheduleAudit(router: Router, runtime: ServerRuntime) {
  const audit = new DesktopScheduleAudit(runtime)
  for (const [path, call] of [['record', (p: unknown) => audit.record(p)], ['list', (p: unknown) => audit.list(p)]] as const)
    router.add('POST', '/v1/remote/desktop-schedule-audit/' + path, async (request) => {
      if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
      const body = await readJsonBody(request, 16384)
      if (!body.ok) return body.response
      try { return jsonResponse(await call(body.value)) }
      catch { return jsonResponse({ code: 'AUDIT_UNAVAILABLE' }, 409) }
    })
}
