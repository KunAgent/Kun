import { randomUUID } from 'node:crypto'
import type { Frame } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { EventCoalescer } from './event-coalescer'
import { LiveHistory, type LiveKind } from './live-history'
export type SubscriptionAuthority = { accountId: string; deviceId: string; authorizationId: string; scopes: readonly string[] }
/** Runtime stream markers that never change a history page. */
const QUIET_EVENTS = new Set(['heartbeat', 'replay_synchronized'])
export class MobileSubscriptions {
  private streams = new Map<string, AbortController>()
  /** Live pages by `device:kind:id`, so a phone's own write can refresh the page it watches. */
  private lives = new Map<string, LiveHistory>()
  constructor(
    private deps: {
      lease(): Promise<ProtectedRuntimeRequestLease>
      send(frame: Frame): void
      fetch: typeof fetch
      /** Reads a history page for one phone; enables live subscriptions when present. */
      read?(device: string, authority: SubscriptionAuthority, method: string, params: Record<string, unknown>): Promise<unknown>
    }
  ) {}
  clear(device?: string) {
    for (const [key, control] of this.streams) if (!device || key.startsWith(device + ':')) {
      control.abort(); this.streams.delete(key)
    }
  }
  /** Re-reads a phone's live page soon, as if the runtime had reported a change. False when it watches no live page. */
  touch(device: string, kind: LiveKind, id: string): boolean {
    const live = this.lives.get(device + ':' + kind + ':' + id)
    live?.changed()
    return Boolean(live)
  }
  async subscribe(device: string, input: unknown, authority?: SubscriptionAuthority) {
    const p = input as {
      kind?: string
      id?: string
      since?: number
      active?: boolean
      live?: boolean
    }
    if (
      !p ||
      !['agent', 'code', 'group'].includes(p.kind ?? '') ||
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(p.id) ||
      !Number.isSafeInteger(p.since ?? 0) ||
      (p.since ?? 0) < 0 ||
      (p.live !== undefined && typeof p.live !== 'boolean')
    )
      throw new Error('INVALID_SUBSCRIPTION')
    if (p.kind === 'group' && !authority?.scopes.includes('groups.read')) throw new Error('REMOTE_SCOPE_REQUIRED')
    const key = device + ':' + p.kind + ':' + p.id
    this.streams.get(key)?.abort()
    this.streams.delete(key)
    if (p.active === false) return
    if (
      this.streams.size >= 16 ||
      [...this.streams.keys()].filter((k) => k.startsWith(device + ':'))
        .length >= 8
    )
      throw new Error('SUBSCRIPTION_LIMIT')
    const control = new AbortController()
    this.streams.set(key, control)
    let relay: EventCoalescer | undefined, live: LiveHistory | undefined, cancel = () => {}
    try {
      let since = p.since ?? 0
      const read = this.deps.read
      if (p.live === true && read && authority) {
        const history = live = new LiveHistory(device, p.kind as LiveKind, p.id, {
          send: (frame) => { if (!control.signal.aborted) this.deps.send(frame) },
          read: (method, params) => read(device, authority, method, params),
          // Ending the stream sends the resource's resync notice; the phone pulls or resubscribes.
          failed: () => cancel()
        })
        control.signal.addEventListener('abort', () => history.stop(), { once: true })
        this.lives.set(key, history)
        since = await history.start()
        if (control.signal.aborted) return
      }
      const lease = await this.deps.lease()
      if (control.signal.aborted) return
      if (!lease.baseUrl) throw new Error('RUNTIME_UNAVAILABLE')
      const response = await this.deps.fetch(
        lease.baseUrl +
          '/v1/remote/events/' +
          p.kind +
          '/' +
          p.id +
          '?since=' +
          since,
        {
          headers: { Authorization: 'Bearer ' + lease.runtimeToken, ...(authority ? {
            'X-Kun-Remote-Account': authority.accountId, 'X-Kun-Remote-Device': authority.deviceId,
            'X-Kun-Remote-Authorization': authority.authorizationId, 'X-Kun-Remote-Scopes': authority.scopes.join(',') } : {}) },
          signal: control.signal
        }
      )
      if (control.signal.aborted) {
        await response.body?.cancel().catch(() => {})
        return
      }
      if (!response.ok || !response.body) throw new Error('STREAM_UNAVAILABLE')
      this.deps.send({
        kind: 'event',
        id: randomUUID(),
        dst: device,
        payload: { kind: 'subscribed', resource: p.kind, resourceId: p.id, ...(live ? { live: true } : {}) }
      })
      const reader = response.body.getReader(),
        decoder = new TextDecoder()
      let ended = false
      cancel = () => { ended = true; void reader.cancel().catch(() => {}) }
      let text = ''
      const events = relay = new EventCoalescer((event) => {
        if (control.signal.aborted) return
        this.deps.send({
          kind: 'event',
          id: randomUUID(),
          dst: device,
          payload: { resource: p.kind, resourceId: p.id, event }
        })
      }, () => { void reader.cancel().catch(() => {}) })
      control.signal.addEventListener('abort', () => events.stop(), { once: true })
      try {
        while (!control.signal.aborted) {
          const { done, value } = await reader.read()
          if (control.signal.aborted) break
          if (done || ended) throw new Error('STREAM_ENDED')
          text += decoder.decode(value, { stream: true })
          if (Buffer.byteLength(text) > 4 * 1024 * 1024)
            throw new Error('STREAM_LIMIT')
          let end: number
          while ((end = text.indexOf('\n\n')) >= 0) {
            const block = text.slice(0, end)
            text = text.slice(end + 2)
            const data = block
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trimStart())
              .join('\n')
            if (!data) continue
            const event = JSON.parse(data)
            // Live phones get page changes, not raw runtime events.
            if (live) { if (!QUIET_EVENTS.has(event?.kind)) live.changed() }
            else events.push(event)
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
    } catch {
      if (!control.signal.aborted) {
        try { relay?.flush() } catch { /* the resync notice below still recovers */ }
        try {
          this.deps.send({
            kind: 'resync_required',
            id: randomUUID(),
            dst: device,
            payload: { resource: p.kind, resourceId: p.id }
          })
        } catch { /* best-effort resync notice */ }
      }
    } finally {
      relay?.stop()
      live?.stop()
      if (live && this.lives.get(key) === live) this.lives.delete(key)
      if (this.streams.get(key) === control) this.streams.delete(key)
    }
  }
}
