import { randomUUID } from 'node:crypto'
import {
  RemoteApi,
  RemoteClient,
  validateCall,
  READ_METHODS,
  LIMITS,
  type DeviceIdentity,
  type Frame,
  type Socket
} from '@kun/remote-protocol'
import type { AccountSessionEnding, ArtAccountAccess } from '../art-assets/account-access'
import { hasKunAccountSession } from '../../shared/kun-account'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { MobileSubscriptions } from './subscriptions'
import { disableHost, sessionOperation } from './lifecycle'
// Kun refuses these before any receipt or mutation, so the phone may treat them as not applied.
const CERTAIN_REJECTIONS = new Set([
  'INVALID_REQUEST',
  'REQUEST_EXPIRED',
  'AGENT_NOT_AVAILABLE',
  'MODEL_NOT_AVAILABLE'
])
export type LinkDependencies = {
  account: ArtAccountAccess
  identity(owner: string): Promise<DeviceIdentity>
  origin: string
  name: string
  platform: string
  fetch: typeof fetch
  socket(url: string, headers: Record<string, string>): Socket
  lease(): Promise<ProtectedRuntimeRequestLease>
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
  private authorizationId = randomUUID()
  private authorizationExpiresAt = 0
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
  private normal = 0
  private control = 0
  private bytes = 0
  private normalBytes = 0
  private controlBytes = 0
  private filePeers = new Set<string>()
  private enabling = false
  private enableOperation = 0
  private connectionAbort?: AbortController
  private subscriptions: MobileSubscriptions
  private unsubscribe: () => void
  private unsubscribeEnding: () => void
  private disconnecting: Promise<void> = Promise.resolve()
  constructor(private deps: LinkDependencies) {
    this.subscriptions = new MobileSubscriptions({
      lease: deps.lease,
      fetch: deps.fetch,
      send: (f) => this.client?.send(f)
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
    this.connectionAbort?.abort()
    this.connectionAbort = undefined
    this.client?.stop()
    this.client = undefined
    this.subscriptions.clear()
    this.peers.clear()
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
  dispose() {
    void this.endSession({ userId: this.owner ?? null, accessToken: this.lastToken ?? null })
    this.unsubscribe()
    this.unsubscribeEnding()
  }
  async status(): Promise<MobileLinkStatus> {
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
        if (generation === this.generation)
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
      grants
    }
  }
  async enable(value: boolean) {
    if (!value) {
      ++this.enableOperation
      this.enabling = false
      return this.setEnabled(false)
    }
    if (this.enabling) throw new Error('OPERATION_IN_PROGRESS')
    this.enabling = true
    const operation = ++this.enableOperation
    try {
      return await this.setEnabled(value)
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
        if (!token) throw new Error('LOGIN_REQUIRED')
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
    this.peers = new Set(grants.filter((grant) => !this.deniedPeers.has(grant.controllerId) && !this.deniedGrants.has(grant.id)).map((grant) => grant.controllerId))
    this.grantPeers = new Map(grants.map((grant) => [grant.id, grant.controllerId]))
  }
  private async setEnabled(value: boolean) {
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
    // Offline logout or a crashed app may not have completed cloud cleanup.
    // Revoke previous grants before this session can obtain a relay ticket.
    await api.request('/devices/enabled', 'PUT', { enabled: false })
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
    const refreshPeers = async () => {
      const grantsVersion = this.grantsVersion
      const { grants } = await api.request('/grants')
      if (generation !== this.generation) throw new Error('ACCOUNT_CHANGED')
      if (grantsVersion !== this.grantsVersion) throw new Error('AUTHORIZATION_CHANGED')
      this.updateGrants(grants)
    }
    this.client = new RemoteClient({
      ticket: async () => {
        const started = Date.now()
        await refreshPeers()
        const ticket = await api.ticket()
        this.authorizationExpiresAt = started + 60000
        return ticket
      },
      renew: async () => {
        const started = Date.now()
        await refreshPeers()
        const result = await api.renew()
        this.authorizationExpiresAt = started + 60000
        return result
      },
      socket: this.deps.socket,
      state: (online) => {
        if (generation === this.generation) {
          this.online = online
          if (online) this.authorizationId = randomUUID()
          else {
            this.subscriptions.clear()
            this.peers.clear()
          }
        }
      },
      frame: (frame) => {
        if (generation === this.generation) void this.receive(frame, generation)
      }
    })
    this.client.start()
    return this.status()
  }
  async confirm(id: string) {
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
    return this.status()
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
    }
    this.grantPeers.delete(id)
    this.subscriptions.clear()
    await this.api.request('/grants/' + id, 'DELETE')
    return this.status()
  }
  private async receive(frame: Frame, generation: number) {
    const src = frame.src
    if (
      !src ||
      !this.online ||
      Date.now() >= this.authorizationExpiresAt ||
      !this.peers.has(src)
    )
      return
    if (frame.kind === 'subscribe') {
      void this.subscriptions.subscribe(src, frame.payload).catch(() => {})
      return
    }
    if (frame.kind !== 'invoke' || !frame.id) return
    let fileReserved = false
    let reserved = false,
      control = false,
      size = 0
    const authority = this.authorizationId
    const current = () =>
      generation === this.generation &&
      this.online &&
      Date.now() < this.authorizationExpiresAt &&
      authority === this.authorizationId &&
      this.peers.has(src)
    try {
      const call = validateCall(frame.payload)
      if (call.requestId !== frame.id) throw new Error('INVALID_REQUEST')
      if (call.method.startsWith('attachment.')) {
        if (this.filePeers.size >= 2 || this.filePeers.has(src))
          throw new Error('BACKPRESSURE')
        this.filePeers.add(src)
        fileReserved = true
      }
      control = call.method === 'execution.stop'
      size = Buffer.byteLength(JSON.stringify(call))
      if (
        (control
          ? this.control >= LIMITS.controlPending || this.controlBytes + size > LIMITS.controlBytes
          : this.normal >= LIMITS.pending - LIMITS.controlPending || this.normalBytes + size > LIMITS.bytes - LIMITS.controlBytes) ||
        this.bytes + size > LIMITS.bytes
      )
        throw new Error('BACKPRESSURE')
      if (control) { this.control++; this.controlBytes += size }
      else { this.normal++; this.normalBytes += size }
      this.bytes += size
      reserved = true
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
            authorizationId: authority,
            current,
            lease: async () => lease
          },
          call
        )
      } else {
        const response = await lease.request(
          '/v1/remote/invoke',
          'POST',
          JSON.stringify({
            accountId: this.owner,
            deviceId: src,
            authorizationId: authority,
            call
          })
        )
        const value = JSON.parse(response.body)
        if (!response.ok)
          throw new Error(
            typeof value.code === 'string' ? value.code : 'RUNTIME_REJECTED'
          )
        result = value
      }
      if (current())
        this.client?.send({
          kind: 'result',
          id: frame.id,
          dst: src,
          payload: result
        })
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
                  reserved &&
                  !READ_METHODS.has(frame.payload?.method) &&
                  !CERTAIN_REJECTIONS.has(code)
              }
            }
          })
        } catch {}
      }
    } finally {
      if (fileReserved) this.filePeers.delete(src)
      if (reserved) {
        if (control) { this.control--; this.controlBytes -= size }
        else { this.normal--; this.normalBytes -= size }
        this.bytes -= size
      }
    }
  }
}
