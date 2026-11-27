import { sessionOperation } from './lifecycle'
import type { RemoteApi } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
type Intent = { eventId: string; resourceKind: 'agent' | 'code'; resourceId: string; kind: 'completed' | 'failed' | 'approval' | 'input'; title?: string }
const REQUIRED_KEYS = ['eventId', 'kind', 'resourceId', 'resourceKind']
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'title'])
function validTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value.trim()).length <= 80 && !/\p{Cc}/u.test(value)
}
function intent(raw: unknown): Intent {
  const p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object' || Array.isArray(p) || REQUIRED_KEYS.some((key) => !Object.hasOwn(p, key)) ||
    Object.keys(p).some((key) => !ALLOWED_KEYS.has(key)) ||
    typeof p.eventId !== 'string' || typeof p.resourceId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(p.eventId) || !/^[A-Za-z0-9_-]{1,128}$/.test(p.resourceId) ||
    !['agent', 'code'].includes(String(p.resourceKind)) || !['completed', 'failed', 'approval', 'input'].includes(String(p.kind)) ||
    (Object.hasOwn(p, 'title') && p.title !== undefined && !validTitle(p.title))) throw new Error('INVALID_NOTIFICATION')
  const title = typeof p.title === 'string' ? p.title.trim() : undefined
  return { eventId: p.eventId, resourceKind: p.resourceKind as Intent['resourceKind'], resourceId: p.resourceId,
    kind: p.kind as Intent['kind'], ...(title ? { title } : {}) }
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms); timer.unref?.(); signal.addEventListener('abort', finish, { once: true })
  })
}
/** One opt-in-capability subscription per current enable session, independent of phone foreground WSS. */
export class MobileNotifications {
  private active?: { api: RemoteApi; control: AbortController; capabilities?: (value: any) => void; checkedAt: number; checking: boolean }
  private cursor?: string
  private seen = new Set<string>()
  constructor(private deps: { lease(): Promise<ProtectedRuntimeRequestLease>; fetch: typeof fetch;
    diagnostic?(code: string): void }) {}
  stop() {
    this.active?.control.abort(); this.active = undefined
    this.cursor = undefined; this.seen.clear()
  }
  start(api: RemoteApi, eligible: () => boolean, capabilities?: (value: any) => void) {
    if (this.active?.api === api) {
      const active = this.active; active.capabilities = capabilities
      if (capabilities && !active.checking && Date.now() - active.checkedAt > 300000) {
        active.checking = true
        void api.request('/capabilities', 'GET', undefined, false, active.control.signal).then(value => {
          if (this.active === active && eligible()) { active.checkedAt = Date.now(); active.capabilities?.(value) }
        }).catch(() => {}).finally(() => { active.checking = false })
      }
      return
    }
    this.stop()
    const active = { api, control: new AbortController(), capabilities, checkedAt: Date.now(), checking: false }
    this.active = active
    const current = () => this.active === active && !active.control.signal.aborted && eligible()
    void this.run(api, active.control.signal, current).catch(() => {
      if (current()) this.deps.diagnostic?.('NOTIFICATIONS_UNAVAILABLE')
    })
  }
  private async run(api: RemoteApi, signal: AbortSignal, current: () => boolean) {
    // The relay api lives for the whole session: keep checking so a transient failure or the
    // server enabling notifications later starts the stream without restarting phone access.
    for (let check = 0; ; check++) {
      let capabilities: any
      try { capabilities = await api.request('/capabilities', 'GET', undefined, false, signal) } catch { capabilities = undefined }
      if (!current()) return
      if (capabilities && this.active?.api === api) { this.active.checkedAt = Date.now(); this.active.capabilities?.(capabilities) }
      if (capabilities?.notifications?.available === true) break
      await delay(capabilities ? 600000 : Math.min(300000, 5000 * 2 ** Math.min(check, 6)), signal)
      if (!current()) return
    }
    let attempt = 0
    while (current()) {
      const connection = new AbortController(), abort = () => connection.abort()
      signal.addEventListener('abort', abort, { once: true })
      let headerTimer: ReturnType<typeof setTimeout> | undefined
      let idleTimer: ReturnType<typeof setInterval> | undefined
      try {
        const lease = await sessionOperation(() => this.deps.lease(), signal)
        if (!current()) return
        if (!lease.baseUrl) throw new Error('NOTIFICATION_STREAM_UNAVAILABLE')
        headerTimer = setTimeout(abort, 15000); headerTimer.unref?.()
        const response = await sessionOperation(async () => { const result = await this.deps.fetch(lease.baseUrl + '/v1/remote/notification-events' +
          (this.cursor ? '?cursor=' + encodeURIComponent(this.cursor) : ''), {
          headers: { Authorization: 'Bearer ' + lease.runtimeToken, Accept: 'text/event-stream' }, signal: connection.signal })
          if (connection.signal.aborted) { await result.body?.cancel().catch(() => {}); throw new Error('ABORTED') }
          return result
        }, connection.signal)
        clearTimeout(headerTimer)
        if (!current()) { await response.body?.cancel().catch(() => {}); return }
        if (!response.ok || !response.body) throw new Error('NOTIFICATION_STREAM_UNAVAILABLE')
        let lastTraffic = Date.now()
        idleTimer = setInterval(() => { if (Date.now() - lastTraffic > 35000) abort() }, 10000); idleTimer.unref?.()
        const reader = response.body.getReader(), decoder = new TextDecoder()
        const cancelReader = () => { void reader.cancel().catch(() => {}) }
        connection.signal.addEventListener('abort', cancelReader, { once: true })
        let text = ''
        try {
          while (current() && !connection.signal.aborted) {
            const part = await reader.read()
            if (part.done) throw new Error('NOTIFICATION_STREAM_ENDED')
            lastTraffic = Date.now(); text += decoder.decode(part.value, { stream: true })
            if (Buffer.byteLength(text) > 65536) throw new Error('NOTIFICATION_STREAM_LIMIT')
            let boundary: number
            while ((boundary = text.indexOf('\n\n')) >= 0) {
              const block = text.slice(0, boundary); text = text.slice(boundary + 2)
              const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
              if (!data) continue
              const value = JSON.parse(data)
              if (typeof value.cursor !== 'string' || value.cursor.length > 2048) throw new Error('INVALID_NOTIFICATION')
              if (value.event) {
                const event = intent(value.event)
                if (!this.seen.has(event.eventId)) {
                  let payload: Intent = event
                  for (let retry = 0; retry < 3 && current(); retry++) {
                    try { await api.request('/notifications/events', 'POST', payload, false, signal); break }
                    catch (error) {
                      if (payload.title && (error as { status?: number })?.status === 400) {
                        const { title: _title, ...legacy } = payload
                        payload = legacy
                        try { await api.request('/notifications/events', 'POST', payload, false, signal); break }
                        catch { /* Retry the title-free payload with the same backoff and failure reporting below. */ }
                      }
                      if (retry === 2) this.deps.diagnostic?.('NOTIFICATION_POST_FAILED'); else await delay(2000, signal)
                    }
                  }
                  if (!current()) return
                  this.seen.add(event.eventId)
                  while (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!)
                }
              }
              if (!current()) return
              this.cursor = value.cursor; attempt = 0
            }
          }
        } finally { connection.signal.removeEventListener('abort', cancelReader); await reader.cancel().catch(() => {}) }
      } catch {
        if (current()) this.deps.diagnostic?.('NOTIFICATION_STREAM_RETRY')
      } finally {
        clearTimeout(headerTimer); clearInterval(idleTimer)
        signal.removeEventListener('abort', abort); connection.abort()
      }
      if (current()) await delay(Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)), signal)
    }
  }
}
