import { appendHostMetadata } from './catalog-metadata'
import type { SharedFileTransfer } from './share-files'
import { MobileShareHosts } from './share-host'
import { desktopScheduleDescriptors } from './desktop-schedules'
import { MobileNotifications } from './notifications'
import { MobileLinkAuthorities } from './authorities'
import { mobileLinkScopes } from '../../shared/mobile-link-scopes'
import { conditionalCall, conditionalResult } from './read-version'
import { randomUUID } from 'node:crypto'
import {
  RemoteApi,
  RequestBudget,
  RemoteClient,
  validateCall,
  hasRemoteOperationScope,
  READ_METHODS,
  HISTORY_LIVE_CAPABILITY,
  READ_CONDITIONAL_CAPABILITY,
  type RelayNotice,
  type DeviceIdentity,
  type Frame,
  type Socket
} from '@kun/remote-protocol'
import type { AccountSessionEnding, ArtAccountAccess } from '../art-assets/account-access'
import { hasKunAccountSession } from '../../shared/kun-account'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { MobileSubscriptions, type SubscriptionAuthority } from './subscriptions'
import { refreshAfterWrite } from './write-refresh'
import { disableHost, sessionOperation } from './lifecycle'
// Kun refuses these before any receipt or mutation, so the phone may treat them as not applied.
const CERTAIN_REJECTIONS = new Set([
  'INVALID_REQUEST',
  'REQUEST_EXPIRED',
  'AGENT_NOT_AVAILABLE',
  'MODEL_NOT_AVAILABLE'
])
/**
 * The relay enforces grants itself: each lease renewal re-reads the peer set into the lease, and a grant change
 * closes this socket so the next ticket lists grants again. Renewal only refreshes local grant metadata, so it
 * lists grants at most this often instead of on every 20 s renewal.
 */
export const PEER_LIST_INTERVAL_MS = 300000
export type LinkDependencies = {
  account: ArtAccountAccess
  identity(owner: string): Promise<DeviceIdentity>
  origin: string
  name: string
  platform: string
  appVersion?: string
  fetch: typeof fetch
  socket(url: string, headers: Record<string, string>): Socket
  lease(): Promise<ProtectedRuntimeRequestLease>
  diagnostic?(code: string, details?: { attempt?: number; elapsedMs?: number }): void
  sharedFiles?: SharedFileTransfer
  desktopSchedules?(method: string, params: unknown, scope: {
    accountId: string; deviceId: string; authorizationId: string; scopes: import('../../shared/mobile-link-scopes').MobileLinkScope[]
  }, lease: ProtectedRuntimeRequestLease): Promise<unknown>
  files?(
    scope: {
      api: RemoteApi
      peer: string
      owner: string
      authorizationId: string
      current(): boolean
      lease(): Promise<ProtectedRuntimeRequestLease>
    },
    call: any
  ): Promise<unknown>
}
export class MobileLinkService {
  private authorities = new MobileLinkAuthorities()
  private notifications: MobileNotifications
  private shared: MobileShareHosts
  private requestBudget = new RequestBudget()
  private totalRequestBudget = new RequestBudget()
  private authorizationId = randomUUID()
  private authorizationExpiresAt = 0
  private authorizationTimer?: ReturnType<typeof setTimeout>
  private transportEpoch = 0
  private lastRecoveryAt = -Infinity
  private suspended = false
  private client?: RemoteClient
  private api?: RemoteApi
  private owner?: string
  private observedOwner: string | null | undefined
  private generation = 0
  private enabled = false
  private online = false
  private error?: string
  private identity?: DeviceIdentity
  private lastToken?: string
  private sessionEnding = false
  private peers = new Set<string>()
  private grantPeers = new Map<string, string>()
  private deniedPeers = new Set<string>()
  private deniedGrants = new Map<string, string | undefined>()
  private pairingPeers = new Map<string, string>()
  private grantsVersion = 0
  private filePeers = new Set<string>()
  private enabling = false
  private enableOperation = 0
  private connectionAbort?: AbortController
  private subscriptions: MobileSubscriptions
  private unsubscribe: () => void
  private unsubscribeEnding: () => void
  private disconnecting: Promise<void> = Promise.resolve()
  private statusRequest?: { generation: number; version: number; task: Promise<MobileLinkStatus> }
  constructor(private deps: LinkDependencies) {
    this.notifications = new MobileNotifications(deps)
    this.shared = new MobileShareHosts({ ...deps, files: deps.sharedFiles, budget: this.requestBudget, totalBudget: this.totalRequestBudget,
      reserveFile: (peer) => {
        if (this.filePeers.size >= 2 || this.filePeers.has(peer)) throw new Error('BACKPRESSURE')
        this.filePeers.add(peer); return () => { this.filePeers.delete(peer) }
      } })
    this.subscriptions = new MobileSubscriptions({
      lease: deps.lease,
      fetch: deps.fetch,
      send: (f) => this.client?.send(f),
      read: (device, authority, method, params) => this.runtimeRead(device, authority, method, params)
    })
    this.unsubscribe = deps.account.onState((state) => {
      const next = hasKunAccountSession(state) ? state.user!.id : null
      const changed =
        this.observedOwner !== undefined && this.observedOwner !== next
      this.observedOwner = next
      if (
        changed ||
        (this.owner && next !== this.owner) ||
        (!next && this.enabling)
      ) {
        void this.endSession({ userId: this.owner ?? null, accessToken: this.lastToken ?? null })
      }
      this.sessionEnding = !next
    })
    this.unsubscribeEnding = deps.account.onSessionEnding?.((session) => this.endSession(session)) ?? (() => {})
  }
  private endSession(session: AccountSessionEnding): Promise<void> {
    if (this.owner && session.userId && session.userId !== this.owner) return Promise.resolve()
    this.sessionEnding = true
    ++this.enableOperation
    this.enabling = false
    const identity = this.identity
    this.stop()
    if (identity && session.accessToken) {
      const token = session.accessToken
      void this.disable(identity, token)
    }
    return this.disconnecting
  }
  private disable(identity: DeviceIdentity, token: string): Promise<boolean> {
    const result = this.disconnecting.catch(() => {}).then(() =>
      disableHost({ origin: this.deps.origin, fetch: this.deps.fetch, identity, token }))
    this.disconnecting = result.then(() => {})
    return result
  }
  stop() {
    ++this.generation
    ++this.transportEpoch
    clearTimeout(this.authorizationTimer)
    this.authorizationTimer = undefined
    this.statusRequest = undefined
    this.suspended = false
    this.connectionAbort?.abort()
    this.connectionAbort = undefined
    this.client?.stop()
    this.client = undefined
    this.subscriptions.clear()
    this.peers.clear()
    this.authorities.clear()
    this.notifications.stop()
    this.shared.stop()
    this.grantPeers.clear()
    this.deniedPeers.clear()
    this.deniedGrants.clear()
    this.pairingPeers.clear()
    ++this.grantsVersion
    this.owner = undefined
    this.enabled = false
    this.online = false
    this.api = undefined
    this.identity = undefined
    this.lastToken = undefined
    this.error = undefined
    this.authorizationExpiresAt = 0
  }
  /** App quit. Keeping access only closes the relay, so a remembered start can resume with its grants. */
  dispose(keepAccess = false) {
    if (keepAccess) this.stop()
    else void this.endSession({ userId: this.owner ?? null, accessToken: this.lastToken ?? null })
    this.unsubscribe()
    this.unsubscribeEnding()
  }
  suspend() {
    if (!this.enabled || this.suspended) return
    this.suspended = true
    this.fenceTransport()
    this.shared.suspend()
    this.deps.diagnostic?.('HOST_SUSPENDED')
    this.client?.stop()
  }
  reconnect(reason = 'NETWORK_RECOVERY') {
    if (!this.enabled || this.sessionEnding || !this.client) return
    this.shared.recover(reason)
    if (reason === 'NETWORK_ONLINE' && this.online) return
    if (reason === 'NETWORK_CHANGED' && this.online) {
      // USB/debug/VPN interfaces can churn while the active route is healthy.
      // Probe it; the existing pong deadline decides whether recovery is needed.
      this.deps.diagnostic?.('NETWORK_HINT_CHECK')
      try { this.client.send({ kind: 'ping' }) }
      catch { this.reconnect('NETWORK_RECOVERY') }
      return
    }
    if (!this.suspended && !this.online && Date.now() - this.lastRecoveryAt < 1000) return
    this.lastRecoveryAt = Date.now()
    const wasSuspended = this.suspended
    this.suspended = false
    this.fenceTransport()
    this.deps.diagnostic?.(reason)
    if (wasSuspended) this.client.start()
    else this.client.reconnect()
  }
  private fenceTransport() {
    ++this.transportEpoch
    clearTimeout(this.authorizationTimer)
    this.authorizationTimer = undefined
    this.authorizationExpiresAt = 0
    this.online = false
    this.authorizationId = randomUUID()
    this.subscriptions.clear()
    this.peers.clear()
  }
  private transportCurrent(generation: number, epoch: number, signal?: AbortSignal) {
    if (generation !== this.generation || epoch !== this.transportEpoch || signal?.aborted || this.suspended)
      throw new Error('ACCOUNT_CHANGED')
  }
  private authorizeUntil(expiresAt: number) {
    this.authorizationExpiresAt = expiresAt
    clearTimeout(this.authorizationTimer)
    this.authorizationTimer = setTimeout(() => {
      if (this.authorizationExpiresAt === expiresAt) this.reconnect('LOCAL_LEASE_EXPIRED')
    }, Math.max(1, expiresAt - Date.now()))
  }
  /** A read for one phone under its subscription's authority, as the runtime would answer its invoke. */
  private async runtimeRead(device: string, authority: SubscriptionAuthority, method: string, params: Record<string, unknown>) {
    const lease = await this.deps.lease()
    const response = await lease.request('/v1/remote/invoke', 'POST', JSON.stringify({ accountId: authority.accountId,
      deviceId: device, authorizationId: authority.authorizationId, scopes: authority.scopes,
      call: { method, params, requestId: randomUUID(), expiresAt: Date.now() + 60000 } }))
    const value = JSON.parse(response.body)
    if (!response.ok) throw new Error(typeof value.code === 'string' ? value.code : 'RUNTIME_REJECTED')
    return value as unknown
  }
  /** Relay notices: a phone that went away no longer needs its streams; changed grants are re-read now. */
  private relayNotice(notice: RelayNotice, refresh: () => Promise<void>) {
    if (notice.relay === 'presence') {
      for (const peer of notice.peers) if (!peer.online) this.subscriptions.clear(peer.deviceId)
    } else if (notice.relay === 'authorization') {
      void refresh().catch(() => this.deps.diagnostic?.('PEER_METADATA_REFRESH_FAILED'))
    }
  }
  private notifyReconnected() {
    // The phone may miss a sub-second host presence gap while its own WSS
    // remains open. Rebuild lost subscriptions; never replay business calls.
    for (const peer of [...this.peers].slice(0, 16)) {
      if (!this.online) break
      try {
        this.client?.send({ kind: 'resync_required', id: randomUUID(), dst: peer,
          payload: { reason: 'host_reconnected' } })
      } catch {
        this.deps.diagnostic?.('PEER_RESYNC_FAILED')
      }
    }
  }
  status(): Promise<MobileLinkStatus> {
    if (this.statusRequest?.generation === this.generation && this.statusRequest.version === this.grantsVersion)
      return this.statusRequest.task
    const generation = this.generation, task = this.loadStatus()
    this.statusRequest = { generation, version: this.grantsVersion, task }
    void task.finally(() => {
      if (this.statusRequest?.task === task) this.statusRequest = undefined
    }).catch(() => {})
    return task
  }
  private async loadStatus(): Promise<MobileLinkStatus> {
    const generation = this.generation
    const grantsVersion = this.grantsVersion
    let pairings: MobileLinkStatus['pairings'] = [],
      grants: MobileLinkStatus['grants'] = []
    if (this.api) {
      try {
        const [p, g] = await Promise.all([
          this.api.request('/pairings'),
          this.api.request('/grants')
        ])
        if (generation === this.generation && grantsVersion === this.grantsVersion) {
          pairings = p.pairings
          grants = g.grants
          this.pairingPeers = new Map(p.pairings.map((pairing: { id: string; controllerId: string }) => [pairing.id, pairing.controllerId]))
          this.updateGrants(g.grants)
          this.error = undefined
        }
      } catch {
        if (generation === this.generation && grantsVersion === this.grantsVersion)
          this.error = 'CONNECTION_UNAVAILABLE'
      }
    }
    return {
      enabled: this.enabled,
      starting: this.enabling && !this.enabled,
      online: this.online,
      error: this.error,
      deviceId: this.identity?.id,
      pairings,
      grants: grants.map((grant) => ({ ...grant, scopes: this.authorities.scopes(grant.controllerId, grant.id) }))
    }
  }
  async enable(value: boolean, keepGrants = false) {
    if (!value) {
      ++this.enableOperation
      this.enabling = false
      return this.setEnabled(false)
    }
    if (this.enabling) throw new Error('OPERATION_IN_PROGRESS')
    this.enabling = true
    const operation = ++this.enableOperation
    try {
      return await this.setEnabled(value, keepGrants)
    } catch (error) {
      if (operation === this.enableOperation && !this.enabled) this.stop()
      throw error
    } finally {
      if (operation === this.enableOperation) this.enabling = false
    }
  }
  private createApi(identity: DeviceIdentity, generation: number, signal: AbortSignal) {
    return new RemoteApi({
      origin: this.deps.origin,
      token: async () => {
        const token = await sessionOperation(() => this.deps.account.accessToken(), signal)
        if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
        // RemoteApi maps a missing token to typed LOGIN_REQUIRED so the transport stops retrying.
        if (!token) return null
        this.lastToken = token
        return token
      },
      identity: async () => identity,
      fetch: (input, init) => {
        const combined = init?.signal ? AbortSignal.any([signal, init.signal]) : signal
        return sessionOperation(async () => {
          const response = await this.deps.fetch(input, { ...init, signal: combined })
          if (combined.aborted) {
            const authorization = new Headers(init?.headers).get('Authorization')
            if (String(input).endsWith('/devices/enabled') &&
                init?.body === JSON.stringify({ enabled: true }) && authorization?.startsWith('Bearer '))
              void this.disable(identity, authorization.slice(7))
            await response.body?.cancel().catch(() => {})
          }
          return response
        }, combined)
      }
    })
  }
  private updateGrants(grants: { id: string; controllerId: string }[]) {
    for (const grant of grants)
      if (this.deniedGrants.has(grant.id)) this.deniedGrants.set(grant.id, grant.controllerId)
    const previous = this.peers
    this.peers = new Set(grants.filter((grant) => !this.deniedPeers.has(grant.controllerId) && !this.deniedGrants.has(grant.id)).map((grant) => grant.controllerId))
    for (const peer of previous) if (!this.peers.has(peer)) this.subscriptions.clear(peer)
    this.grantPeers = new Map(grants.map((grant) => [grant.id, grant.controllerId]))
    for (const peer of this.authorities.sync(grants)) this.permissionsChanged(peer)
    const api = this.api, generation = this.generation
    const eligible = () => this.enabled && !this.sessionEnding && this.api === api && generation === this.generation &&
      [...this.grantPeers].some(([id, peer]) => !this.deniedGrants.has(id) && !this.deniedPeers.has(peer))
    if (api && eligible()) this.notifications.start(api, eligible)
    else this.notifications.stop()
  }
  private async setEnabled(value: boolean, keepGrants = false) {
    if (!value) {
      const identity = this.identity
      const token = this.lastToken
      this.stop()
      const generation = this.generation
      if (identity && token && !(await this.disable(identity, token)))
        if (generation === this.generation) this.error = 'CONNECTION_UNAVAILABLE'
      return this.status()
    }
    this.stop()
    const generation = this.generation
    const control = new AbortController()
    this.connectionAbort = control
    await sessionOperation(() => this.disconnecting, control.signal)
    if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
    const state = await sessionOperation(() => this.deps.account.getState(), control.signal)
    if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
    if (!hasKunAccountSession(state) || !state.user)
      throw new Error('LOGIN_REQUIRED')
    if (this.sessionEnding) throw new Error('ACCOUNT_CHANGED')
    this.observedOwner = state.user.id
    const owner = state.user.id,
      identity = await sessionOperation(() => this.deps.identity(owner), control.signal)
    if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
    this.owner = owner
    this.identity = identity
    const api = this.createApi(identity, generation, control.signal)
    this.api = api
    await api.request('/devices', 'POST', {
      name: this.deps.name,
      platform: this.deps.platform,
      role: 'host'
    })
    // Offline logout or a crashed app may not have completed cloud cleanup, so a fresh start revokes
    // previous grants before it can obtain a relay ticket. Resuming a start the user left on keeps them.
    if (!keepGrants) await api.request('/devices/enabled', 'PUT', { enabled: false })
    const token = this.lastToken
    try {
      await api.request('/devices/enabled', 'PUT', { enabled: true })
      if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
    } catch (error) {
      // An old enable request may finish after logout's disable request.
      // Repeat cleanup after that request settles, still with the old identity.
      if (token)
        await this.disable(identity, token)
      throw error
    }
    this.enabled = true
    this.shared.start({ api, ownerAccountId: owner, hostDeviceId: identity.id,
      current: () => this.enabled && generation === this.generation && !this.sessionEnding })
    let peersListedAt = -Infinity
    const refreshPeers = async (epoch: number, signal?: AbortSignal) => {
      const grantsVersion = this.grantsVersion
      const { grants } = await api.request('/grants', 'GET', undefined, false, signal)
      this.transportCurrent(generation, epoch, signal)
      if (grantsVersion !== this.grantsVersion) return
      this.updateGrants(grants)
      peersListedAt = Date.now()
    }
    const transport = {
      ticket: async (signal?: AbortSignal) => {
        const started = Date.now(), epoch = ++this.transportEpoch
        const [ticket] = await Promise.all([
          api.request<{ url: string; ticket: string }>('/relay-tickets', 'POST', undefined, false, signal),
          refreshPeers(epoch, signal)
        ])
        this.transportCurrent(generation, epoch, signal)
        this.authorizeUntil(started + 60000)
        return ticket
      },
      renew: async (signal?: AbortSignal) => {
        const started = Date.now(), epoch = this.transportEpoch
        // Lease renewal must never wait behind noncritical grants/UI metadata.
        const result = await api.request('/relay-lease', 'POST', undefined, false, signal)
        this.transportCurrent(generation, epoch, signal)
        // The transport reports the renewed expiry (up to five minutes) through leaseChanged.
        if (Date.now() - peersListedAt < PEER_LIST_INTERVAL_MS) return result
        peersListedAt = Date.now()
        void refreshPeers(epoch, signal).catch(() => {
          if (generation === this.generation && epoch === this.transportEpoch)
            this.deps.diagnostic?.('PEER_METADATA_REFRESH_FAILED')
        })
        return result
      },
      socket: this.deps.socket,
      budget: this.requestBudget,
      leaseChanged: (expiresAt: number) => {
        if (generation === this.generation && this.online) this.authorizeUntil(expiresAt)
      },
      relay: (notice: RelayNotice) => {
        if (generation === this.generation) this.relayNotice(notice, () => refreshPeers(this.transportEpoch))
      },
      state: (online: boolean) => {
        if (generation === this.generation) {
          this.online = online
          if (online) {
            this.authorizationId = randomUUID()
            this.notifyReconnected()
          }
          else {
            this.fenceTransport()
          }
        }
      },
      frame: (frame: Frame) => {
        if (generation === this.generation) void this.receive(frame, generation)
      },
      diagnostic: (code: string, details?: { attempt?: number; elapsedMs?: number }) => {
        if (generation === this.generation) this.deps.diagnostic?.(code, details)
      }
    }
    this.client = new RemoteClient(transport)
    this.client.start()
    return this.status()
  }
  async confirm(id: string, rawScopes?: unknown) {
    const scopes = mobileLinkScopes(rawScopes)
    if (!/^[a-f0-9-]{36}$/.test(id) || !this.api)
      throw new Error('INVALID_PAIRING')
    const generation = this.generation, peer = this.pairingPeers.get(id)
    await this.api.request('/pairings/' + id + '/confirm', 'POST')
    if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
    ++this.grantsVersion
    if (peer) {
      this.deniedPeers.delete(peer)
      for (const [grantId, controllerId] of this.deniedGrants)
        if (controllerId === peer) this.deniedGrants.delete(grantId)
    }
    const status = await this.status()
    if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
    const grant = peer ? status.grants.find((grant) => grant.controllerId === peer && this.grantPeers.get(grant.id) === peer) : undefined
    if (grant && this.authorities.set(peer!, grant.id, scopes)) this.permissionsChanged(peer!)
    else if (scopes.length > 1 && !grant) throw new Error('AUTHORIZATION_NOT_READY')
    return { ...status, grants: status.grants.map((g) => ({ ...g, scopes: this.authorities.scopes(g.controllerId, g.id) })) }
  }
  async setScopes(id: string, rawScopes: unknown) {
    const scopes = mobileLinkScopes(rawScopes), peer = this.grantPeers.get(id)
    if (!this.enabled || !peer || this.deniedGrants.has(id)) throw new Error('INVALID_GRANT')
    if (this.authorities.set(peer, id, scopes)) this.permissionsChanged(peer)
    return this.status()
  }
  private peerAuthority(peer: string) {
    const grantId = [...this.grantPeers].find(([, controllerId]) => controllerId === peer)?.[0]
    return { id: this.authorities.identity(this.authorizationId, peer, grantId), scopes: this.authorities.scopes(peer, grantId) }
  }
  private permissionsChanged(peer: string) {
    ++this.grantsVersion
    this.statusRequest = undefined
    this.subscriptions.clear(peer)
    if (this.online && this.peers.has(peer)) {
      try { this.client?.send({ kind: 'resync_required', id: randomUUID(), dst: peer, payload: { reason: 'permissions_changed' } }) }
      catch { this.deps.diagnostic?.('PEER_RESYNC_FAILED') }
    }
  }
  async revoke(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !this.api)
      throw new Error('INVALID_GRANT')
    const peer = this.grantPeers.get(id)
    ++this.grantsVersion
    this.deniedGrants.set(id, peer)
    if (peer) {
      this.peers.delete(peer)
      this.deniedPeers.add(peer)
      this.authorities.remove(peer)
    }
    this.grantPeers.delete(id)
    if (!this.grantPeers.size) this.notifications.stop()
    this.subscriptions.clear()
    await this.api.request('/grants/' + id, 'DELETE')
    return this.status()
  }
  private async receive(frame: Frame, generation: number) {
    if (Object.hasOwn(frame, 'shared')) return
    const src = frame.src
    if (
      !src ||
      !this.online ||
      Date.now() >= this.authorizationExpiresAt ||
      !this.peers.has(src)
    )
      return
    if (frame.kind === 'subscribe') {
      const authority = this.peerAuthority(src)
      void this.subscriptions.subscribe(src, frame.payload, { accountId: this.owner!, deviceId: src,
        authorizationId: authority.id, scopes: authority.scopes }).catch(() => {})
      return
    }
    if (frame.kind !== 'invoke' || !frame.id) return
    let fileReserved = false
    let release: (() => void) | undefined
    let control = false,
      size = 0
    const authority = this.peerAuthority(src)
    const current = () =>
      generation === this.generation &&
      this.online &&
      Date.now() < this.authorizationExpiresAt &&
      authority.id === this.peerAuthority(src).id &&
      this.peers.has(src)
    try {
      // An optional read version is answered here; the runtime envelope never sees it.
      const { call, ifVersion } = conditionalCall(validateCall(frame.payload))
      if (call.requestId !== frame.id) throw new Error('INVALID_REQUEST')
      if (!hasRemoteOperationScope(call.method, authority.scopes)) throw new Error('REMOTE_SCOPE_REQUIRED')
      if (call.method.startsWith('attachment.')) {
        if (this.filePeers.size >= 2 || this.filePeers.has(src))
          throw new Error('BACKPRESSURE')
        this.filePeers.add(src)
        fileReserved = true
      }
      control = call.method === 'execution.stop'
      size = Buffer.byteLength(JSON.stringify(call))
      const releasePeer = this.requestBudget.reserve(src, size, control)
      try {
        const releaseTotal = this.totalRequestBudget.reserve('all', size, control)
        release = () => { releasePeer(); releaseTotal() }
      } catch (error) { releasePeer(); throw error }
      if (call.expiresAt < Date.now() && !READ_METHODS.has(call.method))
        throw new Error('REQUEST_EXPIRED')
      const lease = await this.deps.lease()
      if (!current()) return
      let result: unknown
      if (
        call.method === 'attachment.receive' ||
        call.method === 'attachment.export'
      ) {
        if (!this.deps.files || !this.api || !this.owner)
          throw new Error('UNSUPPORTED_OPERATION')
        result = await this.deps.files(
          {
            api: this.api,
            peer: src,
            owner: this.owner,
            authorizationId: authority.id,
            current,
            lease: async () => lease
          },
          call
        )
      } else if (call.method === 'shares.list' || call.method === 'shares.manage') {
        result = await this.shared.ownerInvoke(call.method, call, src, current)
      } else if (call.method.startsWith('desktop.schedule.')) {
        if (!this.deps.desktopSchedules || !this.owner) throw new Error('UNSUPPORTED_OPERATION')
        result = await this.deps.desktopSchedules(call.method, call.params, {
          accountId: this.owner, deviceId: src, authorizationId: authority.id, scopes: authority.scopes }, lease)
      } else {
        const shareReceipt = call.method === 'request.get' ? await this.shared.ownerInvoke(call.method, call, src, current) : null
        const response = shareReceipt ? { ok: true, status: 200, body: JSON.stringify(shareReceipt) } : await lease.request(
          '/v1/remote/invoke',
          'POST',
          JSON.stringify({
            accountId: this.owner,
            deviceId: src,
            authorizationId: authority.id,
            scopes: authority.scopes,
            call
          })
        )
        const value = JSON.parse(response.body)
        if (!response.ok)
          throw new Error(
            typeof value.code === 'string' ? value.code : 'RUNTIME_REJECTED'
          )
        if (call.method === 'catalog.get') value.capabilityDescriptors = [...(value.capabilityDescriptors ?? []),
          ...(this.deps.desktopSchedules ? desktopScheduleDescriptors(authority.scopes) : []), ...this.shared.descriptors(authority.scopes)]
        if (call.method === 'catalog.get' && Array.isArray(value.capabilities))
          value.capabilities = [...value.capabilities, READ_CONDITIONAL_CAPABILITY, HISTORY_LIVE_CAPABILITY]
        result = call.method === 'catalog.get' ? appendHostMetadata(value, {
          deviceId: this.identity?.id, appVersion: this.deps.appVersion, platform: this.deps.platform }) : value
      }
      if (current())
        this.client?.send({
          kind: 'result',
          id: frame.id,
          dst: src,
          payload: conditionalResult(call.method, result, ifVersion)
        })
      // The phone's own message should reach its live page now, not after the runtime's next event.
      if (current()) refreshAfterWrite(this.subscriptions, src, call.method, call.params, result)
    } catch (error) {
      if (current()) {
        try {
          const code =
            error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : 'REMOTE_ERROR'
          this.client?.send({
            kind: 'result',
            id: frame.id,
            dst: src,
            payload: {
              error: {
                code,
                uncertain:
                  Boolean(release) &&
                  !READ_METHODS.has(frame.payload?.method) &&
                  !CERTAIN_REJECTIONS.has(code)
              }
            }
          })
        } catch { /* best-effort error reply; the peer may be gone */ }
      }
    } finally {
      if (fileReserved) this.filePeers.delete(src)
      release?.()
    }
  }
}
