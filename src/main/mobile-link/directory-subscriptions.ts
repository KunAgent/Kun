import { randomUUID } from 'node:crypto'
import type { Frame } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import type { SubscriptionAuthority } from './subscriptions'

const RESOURCES = ['agent', 'code', 'project', 'group']
type Dependencies = { lease(): Promise<ProtectedRuntimeRequestLease>; fetch: typeof fetch; send(frame: Frame): void }

/** A phone opts into one metadata stream for all lists; it does not open per-task histories. */
export class MobileDirectorySubscriptions {
  private streams = new Map<string, AbortController>()
  constructor(private deps: Dependencies) {}

  clear(device?: string) {
    for (const [peer, control] of this.streams) if (!device || peer === device) {
      control.abort(); this.streams.delete(peer)
    }
  }

  async subscribe(device: string, input: unknown, authority?: SubscriptionAuthority) {
    const p = input as { kind?: unknown; id?: unknown; active?: unknown; since?: unknown }
    if (!p || Array.isArray(p) || p.kind !== 'directory' || p.id !== 'all' ||
      (p.active !== undefined && typeof p.active !== 'boolean') ||
      (p.since !== undefined && (!Number.isSafeInteger(p.since) || Number(p.since) < 0)))
      throw new Error('INVALID_SUBSCRIPTION')
    if (!authority || authority.deviceId !== device || !authority.scopes.includes('personal'))
      throw new Error('REMOTE_SCOPE_REQUIRED')
    this.clear(device)
    if (p.active === false) return
    if (this.streams.size >= 16) throw new Error('SUBSCRIPTION_LIMIT')
    const control = new AbortController()
    this.streams.set(device, control)
    const send = (payload: Record<string, unknown>, kind: 'event' | 'resync_required' = 'event') => {
      if (!control.signal.aborted) this.deps.send({ kind, id: randomUUID(), dst: device,
        payload: { resource: 'directory', resourceId: 'all', ...payload } })
    }
    try {
      const lease = await this.deps.lease()
      if (control.signal.aborted) return
      if (!lease.baseUrl) throw new Error('RUNTIME_UNAVAILABLE')
      const response = await this.deps.fetch(lease.baseUrl + '/v1/remote/directory-events', {
        headers: { Authorization: 'Bearer ' + lease.runtimeToken,
          'X-Kun-Remote-Account': authority.accountId, 'X-Kun-Remote-Device': authority.deviceId,
          'X-Kun-Remote-Authorization': authority.authorizationId, 'X-Kun-Remote-Scopes': authority.scopes.join(',') },
        signal: control.signal
      })
      if (control.signal.aborted) { await response.body?.cancel().catch(() => {}); return }
      if (!response.ok || !response.body) throw new Error('STREAM_UNAVAILABLE')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      const cancel = () => { void reader.cancel().catch(() => {}) }
      control.signal.addEventListener('abort', cancel, { once: true })
      let text = '', synchronized = false
      try {
        while (!control.signal.aborted) {
          const { done, value } = await reader.read()
          if (control.signal.aborted) break
          if (done) throw new Error('STREAM_ENDED')
          text += decoder.decode(value, { stream: true })
          if (text.length > 65536) throw new Error('STREAM_LIMIT')
          let end: number
          while ((end = text.indexOf('\n\n')) >= 0) {
            const block = text.slice(0, end); text = text.slice(end + 2)
            const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
            if (!data) continue
            const event = JSON.parse(data) as { kind?: unknown; resources?: unknown }
            if (!Array.isArray(event.resources)) throw new Error('INVALID_DIRECTORY_EVENT')
            const resources = [...new Set(event.resources.filter((resource): resource is string =>
              typeof resource === 'string' && RESOURCES.includes(resource) && (resource !== 'group' || authority.scopes.includes('groups.read'))))]
            if (event.kind === 'synchronized' && !synchronized) {
              synchronized = true
              send({ kind: 'subscribed', resources })
            } else if (event.kind === 'directory_changed' && synchronized && resources.length) {
              send({ kind: 'directory_changed', resources })
            }
          }
        }
      } finally {
        control.signal.removeEventListener('abort', cancel)
        await reader.cancel().catch(() => {})
      }
    } catch {
      try { send({}, 'resync_required') } catch { /* The phone has already disconnected. */ }
    } finally {
      if (this.streams.get(device) === control) this.streams.delete(device)
    }
  }
}
