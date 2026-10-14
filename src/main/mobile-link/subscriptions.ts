import { randomUUID } from 'node:crypto'
import type { Frame } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
export class MobileSubscriptions {
  private streams = new Map<string, AbortController>()
  constructor(
    private deps: {
      lease(): Promise<ProtectedRuntimeRequestLease>
      send(frame: Frame): void
      fetch: typeof fetch
    }
  ) {}
  clear() {
    for (const c of this.streams.values()) c.abort()
    this.streams.clear()
  }
  async subscribe(device: string, input: unknown) {
    const p = input as {
      kind?: string
      id?: string
      since?: number
      active?: boolean
    }
    if (
      !p ||
      !['agent', 'code'].includes(p.kind ?? '') ||
      typeof p.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(p.id) ||
      !Number.isSafeInteger(p.since ?? 0) ||
      (p.since ?? 0) < 0
    )
      throw new Error('INVALID_SUBSCRIPTION')
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
    try {
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
          (p.since ?? 0),
        {
          headers: { Authorization: 'Bearer ' + lease.runtimeToken },
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
        payload: { kind: 'subscribed', resource: p.kind, resourceId: p.id }
      })
      const reader = response.body.getReader(),
        decoder = new TextDecoder()
      let text = ''
      try {
        while (!control.signal.aborted) {
          const { done, value } = await reader.read()
          if (control.signal.aborted) break
          if (done) throw new Error('STREAM_ENDED')
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
            this.deps.send({
              kind: 'event',
              id: randomUUID(),
              dst: device,
              payload: {
                resource: p.kind,
                resourceId: p.id,
                event: JSON.parse(data)
              }
            })
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
    } catch {
      if (!control.signal.aborted) {
        try {
          this.deps.send({
            kind: 'resync_required',
            id: randomUUID(),
            dst: device,
            payload: { resource: p.kind, resourceId: p.id }
          })
        } catch {}
      }
    } finally {
      if (this.streams.get(key) === control) this.streams.delete(key)
    }
  }
}
