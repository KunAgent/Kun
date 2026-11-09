import { randomBytes, randomUUID } from 'node:crypto'
import type WebSocket from 'ws'
import { directCipher, encodeFrames, parseFrame, Reassembler, RequestBudget, Sender, type Frame } from '@kun/remote-protocol'
import { dispatchMobileInvoke } from './invoke-dispatch'
import { MobileSubscriptions, type SubscriptionAuthority } from './subscriptions'
import type { DirectGrant, DirectRegistry } from './direct-registry'
import type { DirectTransfers } from './direct-transfers'
import type { LinkDependencies } from './service-dependencies'

export type DirectConnectionDependencies = {
  registry: DirectRegistry; owner: string; link: LinkDependencies; transfers: DirectTransfers
  current(): boolean; totalBudget: RequestBudget; admitted(connection: DirectHostConnection): void
}
export class DirectHostConnection {
  grant?: DirectGrant
  private cipher?: ReturnType<typeof directCipher>
  private closed = false
  private authenticating = false
  private leaseUntil = 0
  private leaseTimer?: ReturnType<typeof setTimeout>
  private helloTimer: ReturnType<typeof setTimeout>
  private budget = new RequestBudget()
  private assembly = new Reassembler(Date.now, this.budget)
  private sender: Sender
  private subscriptions: MobileSubscriptions
  private filePeers = new Set<string>()
  private apiCalls = 0
  private count = 0
  private window = Date.now()
  private nonce = randomBytes(32).toString('hex')
  constructor(private socket: WebSocket, private deps: DirectConnectionDependencies) {
    this.sender = new Sender({ send: (data: string) => this.packet({ type: 'frame', data }),
      get bufferedAmount() { return socket.bufferedAmount } } as any, () => this.close())
    this.subscriptions = new MobileSubscriptions({ lease: deps.link.lease, fetch: deps.link.fetch,
      send: frame => this.send(frame), read: (peer, authority, method, params) => this.read(peer, authority, method, params) })
    this.helloTimer = setTimeout(() => this.close(4403), 8000)
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
    socket.on('message', data => { void this.receive(String(data)).catch(() => this.close(4403)) })
    socket.send(JSON.stringify({ type: 'challenge', v: 1, hostId: deps.registry.hostId, nonce: this.nonce }))
  }
  current = () => !this.closed && this.deps.current() && Boolean(this.grant && this.deps.registry.valid(this.grant)) && Date.now() < this.leaseUntil
  private extend() {
    this.leaseUntil = Math.min(Date.now() + 60000, this.grant!.expiresAt)
    clearTimeout(this.leaseTimer)
    this.leaseTimer = setTimeout(() => this.close(4401), Math.max(0, this.leaseUntil - Date.now()))
    return this.leaseUntil
  }
  private packet(value: unknown) {
    if (this.closed || !this.cipher || this.socket.bufferedAmount > 2 * 1024 * 1024) throw Error('BACKPRESSURE')
    this.socket.send(JSON.stringify(this.cipher.seal(value)))
  }
  private send(frame: Frame) {
    if (!this.current()) return
    const value = { ...frame, src: this.deps.registry.hostId, dst: this.grant!.deviceId }
    this.sender.enqueue(value, encodeFrames({ v: 1, ...value }))
  }
  private authority(): SubscriptionAuthority & { id: string; syncKey: string } {
    const grant = this.grant!
    return { accountId: this.deps.owner, deviceId: grant.deviceId, authorizationId: grant.id,
      id: grant.id, syncKey: grant.id, scopes: grant.scopes }
  }
  private async read(peer: string, authority: SubscriptionAuthority, method: string, params: Record<string, unknown>) {
    if (!this.current()) throw Error('AUTHORIZATION_REJECTED')
    const lease = await this.deps.link.lease()
    if (!this.current()) throw Error('AUTHORIZATION_REJECTED')
    const response = await lease.request('/v1/remote/invoke', 'POST', JSON.stringify({ accountId: authority.accountId,
      deviceId: peer, authorizationId: authority.authorizationId, scopes: authority.scopes,
      call: { method, params, requestId: randomUUID(), expiresAt: Date.now() + 30000 } }))
    if (!response.ok || !this.current()) throw Error('RUNTIME_UNAVAILABLE')
    return JSON.parse(response.body)
  }
  private async receive(data: string) {
    if (this.closed || !this.deps.current() || data.length > 720000) { this.close(); return }
    if (Date.now() - this.window >= 1000) { this.count = 0; this.window = Date.now() }
    if (++this.count > 200) throw Error('BACKPRESSURE')
    const message = JSON.parse(data)
    if (!this.grant) {
      if (this.authenticating || message.type !== 'authenticate' || typeof message.id !== 'string' || typeof message.pairing !== 'boolean') throw Error('DIRECT_AUTH_FAILED')
      this.authenticating = true
      const credential = this.deps.registry.credential(message.id, message.pairing)
      if (!credential) throw Error('DIRECT_AUTH_FAILED')
      if (!/^[a-f0-9]{64}$/.test(message.nonce)) throw Error('DIRECT_AUTH_FAILED')
      this.cipher = directCipher(credential.secret, this.nonce + message.nonce, this.deps.registry.hostId, 'host')
      const proof = this.cipher.open(message.packet)
      if (proof.hostId !== this.deps.registry.hostId || proof.id !== message.id) throw Error('DIRECT_AUTH_FAILED')
      const grant = await this.deps.registry.accept(message.id, message.pairing, proof.deviceId, proof.name)
      if (this.closed || !this.deps.current()) return
      this.grant = grant; clearTimeout(this.helloTimer); this.extend()
      this.deps.admitted(this)
      this.packet({ type: 'ready', hostId: this.deps.registry.hostId, deviceId: grant.deviceId,
        scopes: grant.scopes, device: this.device(), ...(message.pairing ? { credential: { id: grant.id, secret: grant.secret, expiresAt: grant.expiresAt } } : {}) })
      this.send({ kind: 'hello', payload: { leaseExpiresAt: this.leaseUntil, features: ['presence', 'authorization'],
        presence: [{ deviceId: this.deps.registry.hostId, online: true }] } })
      return
    }
    if (!this.current()) { this.close(4403); return }
    const value = this.cipher!.open(message)
    if (value.type === 'api') { await this.api(value); return }
    if (value.type !== 'frame' || typeof value.data !== 'string') throw Error('DIRECT_PROTOCOL_ERROR')
    const part = parseFrame(value.data)
    if (Object.hasOwn(part, 'shared') || part.src !== undefined || part.dst !== undefined && part.dst !== this.deps.registry.hostId) throw Error('DIRECT_PROTOCOL_ERROR')
    const frame = this.assembly.accept(part)
    if (!frame) return
    if (Object.hasOwn(frame, 'shared') || frame.src !== undefined || frame.dst !== undefined && frame.dst !== this.deps.registry.hostId) throw Error('DIRECT_PROTOCOL_ERROR')
    if (frame.kind === 'ping') { this.send({ kind: 'pong' }); return }
    if (frame.kind === 'ack' || frame.kind === 'pong') return
    if (frame.kind === 'subscribe') {
      void this.subscriptions.subscribe(this.grant.deviceId, frame.payload, this.authority()).catch(() => {})
      return
    }
    if (frame.kind !== 'invoke' || !frame.id || frame.dst !== this.deps.registry.hostId) throw Error('DIRECT_PROTOCOL_ERROR')
    const peer = this.grant.deviceId
    await dispatchMobileInvoke(frame, peer, { ...this.authority(), scopes: this.grant.scopes }, this.current, {
      owner: this.deps.owner, hostId: this.deps.registry.hostId, link: this.deps.link, api: this.deps.transfers.forHost(peer),
      requestBudget: this.budget, totalRequestBudget: this.deps.totalBudget, subscriptions: this.subscriptions, filePeers: this.filePeers,
      authorizationRemaining: () => Math.max(0, this.leaseUntil - Date.now()),
      terminalAuthorizationRemaining: () => Math.max(0, this.leaseUntil - Date.now()), send: frame => this.send(frame) })
  }
  private device() { return { id: this.deps.registry.hostId, name: this.deps.registry.name, role: 'host', platform: this.deps.link.platform, enabled: true, online: true, version: 1 } }
  private async api(value: any) {
    if (!/^[0-9]{1,16}$/.test(value.id) || typeof value.path !== 'string' || typeof value.method !== 'string') throw Error('INVALID_REQUEST')
    if (this.apiCalls >= 8) { this.packet({ type: 'api-result', id: value.id, error: 'BACKPRESSURE' }); return }
    this.apiCalls++
    let revoke = false
    try {
      let result: unknown
      if (value.path === '/relay-lease' && value.method === 'POST') result = { expiresAt: this.extend() }
      else if (value.path === '/devices' && value.method === 'GET') result = { devices: [this.device(), { id: this.grant!.deviceId, name: this.grant!.name, role: 'controller', platform: 'ios', enabled: true, online: true, version: 1 }] }
      else if (value.path === '/grants' && value.method === 'GET') result = { grants: [{ id: this.grant!.id, hostId: this.deps.registry.hostId, controllerId: this.grant!.deviceId }] }
      else if (value.path === '/desktop/ice' && value.method === 'POST' && this.grant!.scopes.includes('desktop.view'))
        result = { schemaVersion: 1, iceServers: this.deps.registry.settings.iceServers, expiresAt: Date.now() + 3600000 }
      else if (value.path === '/grants/' + this.grant!.id && value.method === 'DELETE') { revoke = true; result = { ok: true } }
      else if (value.path.startsWith('/transfers')) result = await this.deps.transfers.request(this.grant!.deviceId, 'phone', value.path, value.method, value.body)
      else throw Error('UNSUPPORTED_OPERATION')
      if (revoke) {
        this.deps.link.desktop?.authorityChanged(this.grant!.deviceId)
        this.deps.link.terminal?.authorityChanged(this.grant!.deviceId)
        try {
          await this.deps.registry.revoke(this.grant!.id)
          this.packet({ type: 'api-result', id: value.id, value: result })
        } catch { this.packet({ type: 'api-result', id: value.id, error: 'DIRECT_REVOCATION_UNCONFIRMED' }) }
        finally { this.close(4403) }
      } else if (this.current()) this.packet({ type: 'api-result', id: value.id, value: result })
    } catch (error) {
      if (this.current()) this.packet({ type: 'api-result', id: value.id,
        error: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'DIRECT_REQUEST_FAILED' })
    } finally { this.apiCalls-- }
  }
  close(code = 1000) {
    if (this.closed) return
    this.closed = true; clearTimeout(this.helloTimer); clearTimeout(this.leaseTimer)
    this.sender.close(); this.assembly.clear(); this.subscriptions.clear(); this.cipher?.close()
    if (this.grant) {
      this.deps.link.desktop?.authorityChanged(this.grant.deviceId)
      if (code === 4403) this.deps.link.terminal?.authorityChanged(this.grant.deviceId)
      else this.deps.link.terminal?.peerGone(this.grant.deviceId)
    }
    this.socket.close(code)
    const timer = setTimeout(() => this.socket.terminate(), 1000); timer.unref()
  }
}
