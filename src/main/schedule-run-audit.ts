import { createHash, randomUUID } from 'node:crypto'
import type { AppSettingsV1, ScheduleRunResult } from '../shared/app-settings'
import type { ScheduleRuntimeDeps } from './schedule-runtime-helpers'
export const desktopScheduleId = (id: string) => 'schedule_' + createHash('sha256').update(id).digest('hex')
/** Audit faults never feed the task queue or retry a started model request. */
export async function runAuditedSchedule(deps: ScheduleRuntimeDeps, settings: AppSettingsV1, taskId: string,
  run: (clientRequestId: string) => Promise<ScheduleRunResult>): Promise<ScheduleRunResult> {
  const id = 'schedule_run_' + randomUUID().replaceAll('-', ''), clientRequestId = 'scheduled_' + randomUUID().replaceAll('-', '')
  const metadata = { id, scheduleId: desktopScheduleId(taskId), clientRequestId, startedAt: new Date().toISOString() }
  const record = async (extra = {}) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000)
    try {
      const result = await Promise.race([deps.runtimeRequest(settings, '/v1/remote/desktop-schedule-audit/record', {
        method: 'POST', body: JSON.stringify({ ...metadata, ...extra }), signal: controller.signal }),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('AUDIT_TIMEOUT')), { once: true }))])
      if (!result.ok) throw new Error('AUDIT_UNAVAILABLE')
    } catch { try { deps.logError('schedule-audit', 'SCHEDULE_AUDIT_UNAVAILABLE') } catch { /* Diagnostics cannot change task behavior. */ } }
    finally { clearTimeout(timer) }
  }
  await record()
  const result = await run(clientRequestId)
  if (result.ok && result.threadId && result.turnId) await record({ threadId: result.threadId, turnId: result.turnId })
  return result
}
