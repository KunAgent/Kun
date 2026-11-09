import { randomUUID } from 'node:crypto'
import { validateHistorySyncSubscription, type HistorySyncFrame } from '@kun/remote-protocol'
import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { authorize } from '../../server/routes/route-auth.js'
import { readJsonBody } from '../../server/read-json-body.js'
import { jsonResponse } from '../../server/response.js'
import { Envelope, RemoteId } from '../contracts.js'
import type { RemoteFacade } from '../facade.js'
import { requireCode } from '../code/access.js'
import { CodeHistorySync } from './code-sync.js'
import { codeSourceReplay } from './code-source.js'
import type { CodePage } from './code-events.js'

const IDLE_MS = 120000
type Entry = { sync: CodeHistorySync; version: string | undefined; idle?: ReturnType<typeof setTimeout> }
export function registerCodeSyncRoutes(router: Router, runtime: ServerRuntime, facade: RemoteFacade) {
  const entries = new Map<string, Entry>()
  const remove = (key: string) => {
    const entry = entries.get(key)
    if (entry) { entries.delete(key); clearTimeout(entry.idle); entry.sync.close() }
  }
  runtime.registerRemoteCleanup?.(async () => { for (const key of entries.keys()) remove(key) })
  const budget = () => {
    let total = [...entries.values()].reduce((sum, entry) => sum + entry.sync.bytes, 0)
    for (const entry of entries.values()) {
      if (total <= 32 * 1024 * 1024) break
      const before = entry.sync.bytes
      entry.sync.clearReplay(); total -= before - entry.sync.bytes
    }
  }
  router.add('POST', '/v1/remote/code-sync/:id', async (request, { params }) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    const body = await readJsonBody(request, 4096)
    if (!body.ok) return body.response
    try {
      const threadId = RemoteId.parse(params.id)
      const input = validateHistorySyncSubscription(body.value)
      const scope = Envelope.pick({ accountId: true, deviceId: true, authorizationId: true, scopes: true }).parse({
        accountId: request.headers.get('X-Kun-Remote-Account'), deviceId: request.headers.get('X-Kun-Remote-Device'),
        authorizationId: request.headers.get('X-Kun-Remote-Authorization'),
        scopes: (request.headers.get('X-Kun-Remote-Scopes') ?? 'personal').split(',')
      })
      if (!scope.scopes.includes('personal')) throw new Error('REMOTE_SCOPE_REQUIRED')
      await requireCode(runtime, threadId)
      const identity = RemoteId.parse(request.headers.get('X-Kun-Remote-Sync-Key') ?? scope.authorizationId)
      const key = JSON.stringify([scope.accountId, scope.deviceId, identity, [...scope.scopes].sort(), threadId])
      const version = await runtime.sessionStore.itemHistoryVersion?.(threadId)
      let entry = entries.get(key)
      if (entry && (!entry.sync.valid || entry.version !== version)) { remove(key); entry = undefined }
      if (!entry) {
        if (entries.size >= 16) {
          const idle = [...entries].find(([, value]) => !value.sync.observers)
          if (idle) remove(idle[0]); else throw new Error('SUBSCRIPTION_LIMIT')
        }
        const load = async () => {
          await requireCode(runtime, threadId)
          const call = async (method: string) => facade.execute({ ...scope,
            call: { method, requestId: randomUUID(), expiresAt: Date.now() + 60000, params: { threadId } } })
          const [page, approvals] = await Promise.all([call('code.history'), call('approval.list')])
          return { ...page as CodePage, liveApprovals: approvals }
        }
        entry = { version, sync: new CodeHistorySync({ load,
          subscribe: listener => runtime.eventBus.subscribe(threadId, listener),
          version: () => runtime.sessionStore.itemHistoryVersion?.(threadId) ?? Promise.resolve(undefined),
          replay: (floor, buffered) => codeSourceReplay(runtime, threadId, floor, buffered)
        }, budget) }
        entries.set(key, entry)
        // Rejection is handled when attaching the HTTP consumer, without an unhandled promise.
        void entry.sync.initialized.catch(() => {})
      }
      clearTimeout(entry.idle)
      const current = entry
      const encoder = new TextEncoder()
      let off = () => {}, heartbeat: ReturnType<typeof setInterval> | undefined, ended = false
      let close = () => {}
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          close = () => {
            if (ended) return
            ended = true; off(); clearInterval(heartbeat)
            request.signal.removeEventListener('abort', close)
            if (!current.sync.observers && entries.get(key) === current) {
              current.idle = setTimeout(() => { if (!current.sync.observers) remove(key) }, IDLE_MS)
              current.idle.unref?.()
            }
            try { controller.close() } catch { /* Reader cancelled. */ }
          }
          const send = (frame: HistorySyncFrame) => {
            if (ended) throw new Error('HISTORY_CLOSED')
            const chunk = encoder.encode('data: ' + JSON.stringify(frame) + '\n\n')
            if ((controller.desiredSize ?? 0) < chunk.byteLength) { close(); throw new Error('HISTORY_SLOW_CONSUMER') }
            controller.enqueue(chunk)
            if (frame.kind === 'reset') close()
          }
          request.signal.addEventListener('abort', close, { once: true })
          if (request.signal.aborted) { close(); return }
          void current.sync.attach(input, send).then(release => {
            off = release
            if (ended) { release(); return }
            heartbeat = setInterval(() => {
              const cursor = current.sync.cursor
              try { if (cursor) send({ kind: 'ready', subscriptionId: input.subscriptionId, ...cursor }) }
              catch { close() }
            }, 15000)
            heartbeat.unref?.()
          }).catch(() => {
            if (!ended) {
              try { send({ subscriptionId: input.subscriptionId, kind: 'reset', reason: 'SYNC_UNAVAILABLE' }) }
              catch { close() }
            }
          })
        }, cancel: () => close()
      }, { highWaterMark: 512 * 1024, size: chunk => chunk.byteLength })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
    } catch { return jsonResponse({ code: 'HISTORY_SYNC_UNAVAILABLE' }, 403) }
  })
}
