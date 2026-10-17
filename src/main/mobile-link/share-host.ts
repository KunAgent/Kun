import { SharedFileNotStarted, type SharedFileTransfer } from './share-files'
import { randomUUID } from 'node:crypto'
import { ShareClient, validateCall, SHARED_READ_METHODS, SHARED_WRITE_METHODS, type Call, type RequestBudget, type RemoteApi, type ShareLease, type SharedFrame } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { ShareOwnerOperations, shareRuntime, shareLease, type ShareOwner } from './share-owner'
import { EventCoalescer } from './event-coalescer'
type HostContext = { api: RemoteApi; ownerAccountId: string; hostDeviceId: string; current(): boolean }
type Connection = { client: ShareClient; metadata: any; lease: Readonly<ShareLease> | null; sessionId: string;
  ready: Promise<unknown>; streams: Map<string, AbortController> }
type Dependencies = { origin: string; fetch: typeof fetch; socket(url: string, headers: Record<string, string>): import('@kun/remote-protocol').Socket;
  lease(): Promise<ProtectedRuntimeRequestLease>; budget: RequestBudget; totalBudget: RequestBudget; files?: SharedFileTransfer; reserveFile?(peer: string): () => void; diagnostic?(code: string, details?: { attempt?: number }): void }
/** Consecutive failed refreshes retry after 2 s, doubling to this cap, whichever cloud request failed. */
const FAILURE_BACKOFF_CAP = 300000
/** Independent ShareRelay host. No personal frame can enter this dispatcher. */
export class MobileShareHosts {
  private context?: HostContext
  private connections = new Map<string, Connection>()
  private ownerOperations = new ShareOwnerOperations()
  private timer?: ReturnType<typeof setTimeout>
  private generation = 0
  private refreshingGeneration = -1
  private refreshAgain = false
  private available = false
  private featureKnown = false
  private featureAt = 0
  private failures = 0
  private suspended = false
  constructor(private deps: Dependencies) {}
  start(context: HostContext) { this.stop(); this.context = context; this.suspended = false; void this.refresh(true) }
  stop() {
    ++this.generation; clearTimeout(this.timer); this.timer = undefined
    for (const connection of this.connections.values()) this.close(connection)
    this.connections.clear(); this.context = undefined; this.refreshAgain = false; this.available = false; this.suspended = false
    this.featureKnown = false; this.featureAt = 0; this.failures = 0
  }
  suspend() {
    this.suspended = true; ++this.generation; clearTimeout(this.timer)
    for (const connection of this.connections.values()) this.close(connection)
    this.connections.clear()
  }
  recover(reason: string) {
    if (!this.context?.current()) return
    if (this.suspended) { this.suspended = false; void this.refresh(true); return }
    for (const c of this.connections.values()) {
      if (['NETWORK_CHANGED', 'NETWORK_ONLINE'].includes(reason) && c.client.online) {
        if (reason === 'NETWORK_CHANGED') try { c.client.send({ kind: 'ping' }) } catch { c.client.reconnect() }
      } else c.client.reconnect()
    }
    // An interface-change hint says nothing about the cloud feature or the share list. It fired every 5-20 s on a
    // churning network and, with no live share, forced a capability request past the failure backoff each time.
    if (!this.connections.size && reason !== 'NETWORK_CHANGED') void this.refresh(true)
  }
  private valid(context: HostContext, generation: number) {
    return this.context === context && generation === this.generation && !this.suspended && context.current()
  }
  private close(connection: Connection) {
    connection.client.stop()
    for (const stream of connection.streams.values()) stream.abort()
    connection.streams.clear()
  }
  private async refresh(checkFeature = false) {
    const context = this.context, generation = this.generation
    if (!context || this.suspended || !context.current()) return
    if (this.refreshingGeneration === generation) { this.refreshAgain = true; return }
    this.refreshingGeneration = generation
    const check = checkFeature || !this.featureKnown || Date.now() - this.featureAt >= 300000
    let checked = false, failed = false
    try {
      if (check) {
        const available = (await context.api.request<any>('/capabilities'))?.sharing?.available === true
        if (!this.valid(context, generation)) return
        this.available = available; this.featureKnown = true; this.featureAt = Date.now(); checked = true
        if (!available) { for (const connection of this.connections.values()) this.close(connection); this.connections.clear() }
      }
      if (!this.valid(context, generation) || !this.available) return
      const value = await context.api.request<any>('/shares'), lease = await shareLease(this.deps.lease)
      if (!this.valid(context, generation)) return
      const shares = (Array.isArray(value.owned) ? value.owned : []).filter((share: any) => share.ownerAccountId === context.ownerAccountId &&
        share.hostDeviceId === context.hostDeviceId && share.state === 'active' && share.expiresAt > Date.now()).slice(0, 5)
      const keep = new Set(shares.map((share: any) => share.id))
      for (const [id, old] of this.connections) if (!keep.has(id)) { this.close(old); this.connections.delete(id) }
      for (const share of shares) {
        const owner = this.owner(context), local = await shareRuntime(lease, 'resource-bind', { owner, share }).catch(() => null)
        if (!this.valid(context, generation)) return
        if (!local?.resource) continue
        const old = this.connections.get(share.id)
        if (old?.metadata.version === share.version) continue
        if (old) this.close(old)
        const connection = this.connect(context, generation, share)
        this.connections.set(share.id, connection); connection.client.start()
      }
    } catch {
      failed = true
      if (this.valid(context, generation)) {
        if (check && !checked) this.featureKnown = false
        this.failures++
        this.deps.diagnostic?.(check && !checked ? 'SHARE_CAPABILITIES_UNAVAILABLE' : 'SHARE_METADATA_UNAVAILABLE', { attempt: this.failures })
      }
    }
    finally {
      if (this.refreshingGeneration === generation) this.refreshingGeneration = -1
      if (this.valid(context, generation)) {
        clearTimeout(this.timer)
        const immediate = this.refreshAgain; this.refreshAgain = false
        if (!failed) this.failures = 0
        // Failures back off to five minutes. A known disabled feature only rechecks metadata every five minutes.
        const delay = immediate && this.featureKnown && this.available ? 0
          : this.failures ? Math.min(FAILURE_BACKOFF_CAP, 2000 * 2 ** Math.min(this.failures - 1, 8))
            : this.available ? 30000 : 300000
        this.timer = setTimeout(() => void this.refresh(), delay)
      }
    }
  }
  private owner(context: HostContext, controllerId = context.hostDeviceId): ShareOwner {
    return { ownerAccountId: context.ownerAccountId, hostDeviceId: context.hostDeviceId, controllerId }
  }
  private connect(context: HostContext, generation: number, share: any): Connection {
    const connection = { metadata: share, lease: null, sessionId: randomUUID(), ready: Promise.resolve(), streams: new Map() } as unknown as Connection
    const current = () => this.valid(context, generation) && this.connections.get(share.id) === connection
    const path = '/shares/' + share.id
    connection.client = new ShareClient({ origin: this.deps.origin, expected: { shareId: share.id, accountId: context.ownerAccountId,
      deviceId: context.hostDeviceId, role: 'host', hostDeviceId: context.hostDeviceId, resourceHandle: share.resourceHandle,
      ownerAccountId: context.ownerAccountId, shareVersion: share.version }, socket: this.deps.socket, budget: this.deps.budget,
      ticket: (signal) => context.api.request(path + '/relay-tickets', 'POST', undefined, false, signal),
      renew: (signal) => context.api.request(path + '/relay-lease', 'POST', undefined, false, signal),
      lease: (value) => {
        const previous = connection.lease
        if (value && !previous) connection.sessionId = randomUUID()
        const sessionId = connection.sessionId
        connection.lease = value
        if (!value) {
          for (const stream of connection.streams.values()) stream.abort()
          connection.streams.clear()
        }
        const prior = value ? connection.ready.catch(() => {}) : Promise.resolve()
        connection.ready = prior.then(async () => {
          const runtime = await shareLease(this.deps.lease)
          if (!value) await shareRuntime(runtime, 'guest-fence', { owner: this.owner(context), shareId: share.id, sessionId })
          if (!value || !current() || connection.lease !== value || connection.sessionId !== sessionId) return
          for (const peer of value.peers) await shareRuntime(runtime, 'guest-admit', { actor: this.actor(connection, peer.deviceId) })
          if (previous && current() && connection.client.online) for (const peer of value.peers) {
            if (!previous.peers.some((old) => old.deviceId === peer.deviceId)) try { connection.client.send({ kind: 'resync_required', id: randomUUID(), dst: peer.deviceId, payload: { reason: 'permissions_changed' } }) } catch { /* best-effort resync notice */ }
          }
        })
        void connection.ready.catch(() => { if (current()) this.deps.diagnostic?.('SHARE_AUTHORIZATION_UNAVAILABLE') })
      },
      state: (online) => {
        if (online) void connection.ready.then(() => {
          if (!current()) return
          for (const peer of connection.lease?.peers ?? []) try { connection.client.send({ kind: 'resync_required', id: randomUUID(), dst: peer.deviceId, payload: { reason: 'host_reconnected' } }) } catch { /* best-effort resync notice */ }
        }).catch(() => {})
      },
      frame: (frame) => { if (current()) void this.receive(connection, frame, current) },
      diagnostic: (code) => { if (current() && ['CONNECTED', 'RENEWED', 'PONG_TIMEOUT', 'RENEW_RETRY'].includes(code)) this.deps.diagnostic?.('SHARE_' + code) }
    })
    return connection
  }
  private actor(connection: Connection, deviceId: string) {
    const lease = connection.lease, peer = lease?.peers.find((candidate) => candidate.deviceId === deviceId)
    if (!lease || !peer?.memberId || !peer.memberVersion || !peer.mode) throw new Error('SHARE_AUTHORIZATION_STALE')
    return { ownerAccountId: lease.ownerAccountId, hostDeviceId: lease.hostDeviceId, resourceHandle: lease.resourceHandle,
      shareId: lease.shareId, shareVersion: lease.shareVersion, guestAccountId: peer.accountId, deviceId: peer.deviceId,
      memberId: peer.memberId, memberVersion: peer.memberVersion, mode: peer.mode, expiresAt: lease.expiresAt, sessionId: connection.sessionId }
  }
  private async receive(connection: Connection, frame: SharedFrame, current: () => boolean) {
    let release: (() => void) | undefined, releaseFile: (() => void) | undefined, dispatchStarted = false
    const sessionId = connection.sessionId, src = frame.src, claim = frame.shared ? { ...frame.shared } : undefined
    const authorized = () => {
      const value = connection.lease, peer = value?.peers.find((candidate) => candidate.deviceId === src)
      return current() && connection.sessionId === sessionId && connection.client.online && Boolean(claim && claim.role === 'guest' &&
        value && value.expiresAt > Date.now() && peer && claim.shareId === value.shareId && claim.resourceHandle === value.resourceHandle &&
        claim.shareVersion === value.shareVersion && claim.accountId === peer.accountId && claim.memberId === peer.memberId &&
        claim.memberVersion === peer.memberVersion && claim.mode === peer.mode)
    }
    try {
      if (!authorized() || !src) return
      const actor = this.actor(connection, src)
      const call = frame.kind === 'invoke' ? validateCall(frame.payload) : undefined
      if (call && !SHARED_READ_METHODS.has(call.method) && !(actor.mode === 'write' && SHARED_WRITE_METHODS.has(call.method))) throw new Error('SHARED_OPERATION_FORBIDDEN')
      if (frame.kind === 'subscribe' && frame.payload?.active === false) {
        connection.streams.get(src)?.abort(); connection.streams.delete(src); return
      }
      if (frame.kind !== 'subscribe' && (frame.kind !== 'invoke' || !call || !frame.id || call.requestId !== frame.id)) throw new Error('INVALID_REQUEST')
      const size = Buffer.byteLength(JSON.stringify(call ?? frame.payload)), control = call?.method === 'execution.stop'
      const releasePeer = this.deps.budget.reserve(src, size, control)
      try { const releaseTotal = this.deps.totalBudget.reserve('all', size, control); release = () => { releasePeer(); releaseTotal() } }
      catch (error) { releasePeer(); throw error }
      if (call?.method.startsWith('attachment.')) {
        if (!this.deps.files || !this.deps.reserveFile) throw new Error('UNSUPPORTED_OPERATION')
        releaseFile = this.deps.reserveFile(src)
      }
      await connection.ready
      if (!authorized()) return
      const lease = await shareLease(this.deps.lease)
      if (!authorized()) return
      if (frame.kind === 'subscribe') { await this.subscribe(connection, actor, frame.payload, lease, authorized); return }
      dispatchStarted = true
      const result = call!.method.startsWith('attachment.')
        ? await this.deps.files!({ api: this.context!.api, actor, lease, current: authorized }, call!)
        : await shareRuntime(lease, 'guest-invoke', { actor, call })
      if (call!.method === 'catalog.get' && !this.deps.files && result && typeof result === 'object' && Array.isArray((result as any).capabilities))
        (result as any).capabilities = (result as any).capabilities.filter((method: string) => !method.startsWith('attachment.'))
      if (authorized()) connection.client.send({ kind: 'result', id: frame.id, dst: src, payload: result })
    } catch (error) {
      if (authorized() && src && frame.id) try { connection.client.send({ kind: 'result', id: frame.id, dst: src,
        payload: { error: { code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SHARED_REQUEST_FAILED', uncertain: dispatchStarted && !(error instanceof SharedFileNotStarted) } } }) } catch { /* best-effort error reply */ }
    } finally { release?.(); releaseFile?.() }
  }
  private async subscribe(connection: Connection, actor: ReturnType<MobileShareHosts['actor']>, raw: any, lease: ProtectedRuntimeRequestLease, current: () => boolean) {
    if (!raw || raw.kind !== 'code' || typeof raw.id !== 'string' || !Number.isSafeInteger(raw.since ?? 0) || (raw.since ?? 0) < 0) throw new Error('INVALID_SUBSCRIPTION')
    const key = actor.deviceId, prior = connection.streams.get(key)
    prior?.abort(); connection.streams.delete(key)
    if (raw.active === false) return
    const abort = new AbortController(); connection.streams.set(key, abort)
    let failed = false, watchdog = setTimeout(() => { failed = true; abort.abort() }, 15000), relay: EventCoalescer | undefined
    const resetWatchdog = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { failed = true; abort.abort() }, 35000) }
    try {
      const local = await shareRuntime(lease, 'resource', { owner: this.owner(this.context!), resourceHandle: actor.resourceHandle })
      if (!current() || abort.signal.aborted) return
      if (raw.id !== local.resource?.threadId || !lease.baseUrl) throw new Error('SHARE_RESOURCE_NOT_ALLOWED')
      const response = await Promise.race([this.deps.fetch(lease.baseUrl + '/v1/remote/shares/guest-events', { method: 'POST',
        headers: { Authorization: 'Bearer ' + lease.runtimeToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ actor, since: raw.since ?? 0 }), signal: abort.signal }).then(async (response) => {
          if (abort.signal.aborted) { await response.body?.cancel().catch(() => {}); throw new Error('STREAM_ENDED') }
          return response
        }), new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new Error('STREAM_TIMEOUT')), { once: true }))])
      if (abort.signal.aborted) { await response.body?.cancel().catch(() => {}); throw new Error('STREAM_ENDED') }
      resetWatchdog()
      if (!response.ok || !response.body) throw new Error('STREAM_UNAVAILABLE')
      if (current() && !abort.signal.aborted) connection.client.send({ kind: 'event', id: randomUUID(), dst: actor.deviceId, payload: { kind: 'subscribed', resource: 'code', resourceId: raw.id } })
      const reader = response.body.getReader(), decoder = new TextDecoder(); let text = ''
      const cancel = () => { void reader.cancel().catch(() => {}) }
      const events = relay = new EventCoalescer((event) => {
        if (current() && !abort.signal.aborted) connection.client.send({ kind: 'event', id: randomUUID(), dst: actor.deviceId, payload: { resource: 'code', resourceId: raw.id, event } })
      }, cancel)
      abort.signal.addEventListener('abort', () => events.stop(), { once: true })
      abort.signal.addEventListener('abort', cancel, { once: true })
      try { while (!abort.signal.aborted && current()) {
        const next = await reader.read(); resetWatchdog(); if (next.done) throw new Error('STREAM_ENDED')
        text += decoder.decode(next.value, { stream: true }); if (Buffer.byteLength(text) > 65536) throw new Error('STREAM_LIMIT')
        let end: number
        while ((end = text.indexOf('\n\n')) >= 0) {
          const block = text.slice(0, end); text = text.slice(end + 2)
          const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
          if (data && current() && !abort.signal.aborted) events.push(JSON.parse(data))
        }
      } } finally { abort.signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}) }
    } catch {
      if (!abort.signal.aborted) try { relay?.flush() } catch { /* the resync notice below still recovers */ }
      if ((!abort.signal.aborted || failed) && current()) try { connection.client.send({ kind: 'resync_required', id: randomUUID(), dst: actor.deviceId, payload: { resource: 'code', resourceId: raw.id } }) } catch { /* best-effort resync notice */ }
    } finally { relay?.stop(); clearTimeout(watchdog); if (connection.streams.get(key) === abort) connection.streams.delete(key) }
  }
  descriptors(scopes: readonly string[]) {
    return this.available && scopes.includes('shares.manage') ? ['shares.list', 'shares.manage'].map((operation) => ({ operation,
      schemaVersion: 1, resourceKind: 'share', allowedActions: [operation === 'shares.list' ? 'read' : 'write'],
      supported: true, enabled: true, authorized: true, online: true, limits: { pageSize: 20 } })) : []
  }
  async ownerInvoke(method: string, call: Call, controllerId: string, current: () => boolean): Promise<unknown | null> {
    const context = this.context
    if (!context || !context.current() || !current()) throw new Error('DEVICE_OFFLINE')
    const ownerContext = { api: context.api, owner: this.owner(context, controllerId), current: () => this.context === context && context.current() && current(), lease: () => shareLease(this.deps.lease) }
    if (method === 'request.get') {
      const result = await this.ownerOperations.lookup(ownerContext, String(call.params.requestId))
      if (result?.receipt?.status === 'applied') void this.refresh()
      return result
    }
    if (!this.available) throw new Error('REMOTE_SHARING_UNAVAILABLE')
    if (method === 'shares.list') return this.ownerOperations.list(ownerContext, call.params)
    if (method !== 'shares.manage') throw new Error('UNSUPPORTED_OPERATION')
    return this.ownerOperations.invoke(ownerContext, call, () => { void this.refresh() })
  }
}
