import { randomUUID } from 'node:crypto'
import { validateHistorySyncSubscription, type Frame, type HistorySyncSubscription } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import type { SubscriptionAuthority } from './subscriptions'

/** This bridge carries only the Runtime's already-authorized public projection. */
export async function forwardCodeSync(input: { id: string; sync: HistorySyncSubscription }, authority: SubscriptionAuthority,
  signal: AbortSignal, deps: { lease(): Promise<ProtectedRuntimeRequestLease>; fetch: typeof fetch; send(frame: Frame): void }) {
  const sync = validateHistorySyncSubscription(input.sync)
  const send = (value: unknown) => {
    if (!signal.aborted) deps.send({ kind: 'event', id: randomUUID(), dst: authority.deviceId,
      payload: { resource: 'code', resourceId: input.id, sync: value } })
  }
  try {
    const lease = await deps.lease()
    if (signal.aborted) return
    if (!lease.baseUrl) throw new Error('RUNTIME_UNAVAILABLE')
    const response = await deps.fetch(lease.baseUrl + '/v1/remote/code-sync/' + encodeURIComponent(input.id), {
      method: 'POST', body: JSON.stringify(sync), signal,
      headers: { Authorization: 'Bearer ' + lease.runtimeToken, 'Content-Type': 'application/json',
        'X-Kun-Remote-Account': authority.accountId, 'X-Kun-Remote-Device': authority.deviceId,
        'X-Kun-Remote-Authorization': authority.authorizationId, 'X-Kun-Remote-Scopes': authority.scopes.join(','),
        'X-Kun-Remote-Sync-Key': authority.syncKey ?? authority.authorizationId }
    })
    if (!response.ok || !response.body) throw new Error('SYNC_UNAVAILABLE')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    const abort = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    let text = ''
    try {
      while (!signal.aborted) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('SYNC_ENDED')
        text += decoder.decode(chunk.value, { stream: true })
        if (Buffer.byteLength(text) > 512 * 1024) throw new Error('SYNC_LIMIT')
        let end: number
        while ((end = text.indexOf('\n\n')) >= 0) {
          const block = text.slice(0, end); text = text.slice(end + 2)
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5)).join('\n')
          if (!data) continue
          const frame = JSON.parse(data)
          if (frame.subscriptionId !== sync.subscriptionId) throw new Error('SYNC_ID_MISMATCH')
          send(frame)
          if (frame.kind === 'reset') return
        }
      }
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}) }
  } catch {
    send({ kind: 'reset', subscriptionId: sync.subscriptionId, reason: 'SYNC_UNAVAILABLE' })
  }
}
