import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DIRECT_PATH, directAddress, parseDirectPairing, RequestBudget } from '@kun/remote-protocol'
import { DirectRegistry, emptyDirectSettings, type DirectSettings } from './direct-registry'
import { DirectHostConnection } from './direct-connection'
import { DirectTransfers } from './direct-transfers'
import type { LinkDependencies } from './service-dependencies'
import type { DirectLinkConfiguration, DirectLinkStatus } from '../../shared/direct-link'
import { lanUrlsForPort } from '../remote/remote-lan-urls'

export type DirectHostDependencies = { link: LinkDependencies; root: string; owner(): string | null
  read(owner: string): Promise<DirectSettings>; write(owner: string, value: DirectSettings): Promise<void>
  revoke?(owner: string, id: string): Promise<void>
  validate(value: unknown): DirectLinkConfiguration }
export class DirectHost {
  private server?: Server
  private ws?: WebSocketServer
  private registry?: DirectRegistry
  private transfers?: DirectTransfers
  private connections = new Set<DirectHostConnection>()
  private settings = emptyDirectSettings()
  private ownerId?: string
  private generation = 0
  private queue = Promise.resolve()
  private error?: string
  private totalBudget = new RequestBudget()
  constructor(private deps: DirectHostDependencies) {}
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run); this.queue = task.then(() => {}, () => {}); return task
  }
  restore() { return this.serial(async () => {
    const owner = this.deps.owner()
    if (!owner || owner === this.ownerId) return
    await this.stop()
    const value = await this.deps.read(owner)
    if (this.deps.owner() !== owner) return
    this.ownerId = owner; this.settings = value
    if (value.enabled) await this.start(owner)
  }) }
  configure(input: unknown) {
    const requestedOwner = this.deps.owner()
    return this.serial(async () => {
    if (requestedOwner !== this.deps.owner()) throw Error('ACCOUNT_CHANGED')
    const value = this.deps.validate(input), owner = requestedOwner
    if (!owner) throw Error('LOGIN_REQUIRED')
    if (owner !== this.ownerId) { await this.stop(); this.settings = await this.deps.read(owner); this.ownerId = owner }
    if (this.deps.owner() !== owner) throw Error('ACCOUNT_CHANGED')
    await this.stop()
    this.settings = { ...this.settings, ...value, iceServers: value.iceServers ?? this.settings.iceServers }
    await this.deps.write(owner, this.settings)
    if (this.deps.owner() !== owner) throw Error('ACCOUNT_CHANGED')
    if (value.enabled) await this.start(owner)
    return this.status()
  }) }
  private async start(owner: string) {
    const generation = ++this.generation
    const identity = await this.deps.link.identity(owner)
    if (this.deps.owner() !== owner || generation !== this.generation) return
    this.registry = new DirectRegistry(identity.id, this.deps.link.name, this.settings, value => this.deps.write(owner, value), Date.now,
      this.deps.revoke ? id => this.deps.revoke!(owner, id) : undefined)
    await DirectTransfers.pruneAbandoned(join(this.deps.root, owner, 'direct-transfers'))
    if (this.deps.owner() !== owner || generation !== this.generation) return
    this.transfers = new DirectTransfers(join(this.deps.root, owner, 'direct-transfers', randomUUID()), identity.id)
    const registry = this.registry, transfers = this.transfers
    const server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"service":"kun-direct","version":1}')
      } else { res.writeHead(404); res.end() }
    })
    const wss = new WebSocketServer({ noServer: true, maxPayload: 720000, perMessageDeflate: false })
    const current = () => generation === this.generation && this.deps.owner() === owner && this.server === server
    server.on('upgrade', (req, socket, head) => {
      if (!current() || req.url !== DIRECT_PATH || wss.clients.size >= 16) { socket.destroy(); return }
      wss.handleUpgrade(req, socket, head, ws => {
        const connection = new DirectHostConnection(ws, { registry, owner, transfers, current, link: this.deps.link, totalBudget: this.totalBudget,
          admitted: active => {
            for (const previous of this.connections) if (previous !== active && previous.grant?.deviceId === active.grant?.deviceId) previous.close(4409)
          } })
        this.connections.add(connection)
        ws.once('close', () => this.connections.delete(connection))
      })
    })
    this.server = server; this.ws = wss
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.settings.port, this.settings.bind === 'lan' ? '0.0.0.0' : '127.0.0.1', resolve) })
      if (!current()) { await this.stop(); return }
      this.settings.port = (server.address() as { port: number }).port
      await this.deps.write(owner, this.settings)
      if (this.settings.grants.some(grant => grant.expiresAt > Date.now() && grant.scopes.includes('desktop.view')))
        await this.deps.link.desktop?.configureRemoteAccess?.(true, current)
      this.error = undefined
    } catch (error) {
      this.error = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'DIRECT_PORT_IN_USE' : 'DIRECT_START_FAILED'
      await this.stop(); throw Error(this.error)
    }
  }
  status(): DirectLinkStatus {
    if (!this.ownerId || this.ownerId !== this.deps.owner()) return { ready: false, enabled: false, running: false,
      bind: 'lan', port: 0, addresses: [], localAddresses: [], hasIceServers: false, grants: [] }
    const localAddresses = !this.settings.port ? [] : this.settings.bind === 'lan' ? lanUrlsForPort(this.settings.port).flatMap(url => {
      try { return [directAddress(url)] } catch { return [] }
    }).slice(0, 6) : [directAddress('http://127.0.0.1:' + this.settings.port)]
    return { ready: Boolean(this.ownerId && this.ownerId === this.deps.owner()), enabled: this.settings.enabled, running: Boolean(this.server?.listening), bind: this.settings.bind, port: this.settings.port,
      addresses: this.settings.addresses, localAddresses, hasIceServers: this.settings.iceServers.length > 0,
      hostId: this.registry?.hostId, error: this.error,
      grants: this.settings.grants.map(({ secret: _secret, deviceId, ...grant }) => ({ ...grant,
        online: [...this.connections].some(connection => connection.grant?.deviceId === deviceId && connection.current()) })) }
  }
  async pair(scopes: unknown) {
    const registry = this.registry, owner = this.ownerId
    if (!registry || !this.server?.listening || owner !== this.deps.owner()) throw Error('DIRECT_NOT_RUNNING')
    if (this.settings.bind === 'loopback' && !this.settings.addresses.length) throw Error('DIRECT_ADDRESS_REQUIRED')
    const addresses = [...new Set([...this.settings.addresses, ...this.status().localAddresses])].slice(0, 6)
    const link = registry.pair(addresses, scopes)
    if (parseDirectPairing(link).expiresAt <= Date.now()) throw Error('DIRECT_PAIRING_EXPIRED')
    if (JSON.stringify(scopes).includes('desktop.view')) {
      await this.deps.link.desktop?.configureRemoteAccess?.(true, () => this.registry === registry && this.deps.owner() === owner)
      if (this.registry !== registry || this.deps.owner() !== owner) throw Error('ACCOUNT_CHANGED')
    }
    return { link, expiresAt: parseDirectPairing(link).expiresAt }
  }
  async revoke(id: string) {
    const registry = this.registry, transfers = this.transfers
    if (!registry || this.ownerId !== this.deps.owner() || !/^[a-f0-9-]{36}$/.test(id)) throw Error('INVALID_GRANT')
    const target = registry.settings.grants.find(grant => grant.id === id)
    if (!target) throw Error('INVALID_GRANT')
    for (const connection of this.connections) if (connection.grant?.id === id) connection.close(4403)
    const peer = target.deviceId
    if (peer) { this.deps.link.desktop?.authorityChanged(peer); this.deps.link.terminal?.authorityChanged(peer) }
    await registry.revoke(id)
    if (peer) await transfers?.prune(peer)
    return this.status()
  }
  iceServers() { return this.settings.iceServers }
  async stop() {
    ++this.generation
    const registry = this.registry
    this.registry?.cancelPairing(); this.registry = undefined
    for (const connection of this.connections) connection.close(4401)
    this.connections.clear()
    await registry?.close()
    const server = this.server, ws = this.ws, transfers = this.transfers
    this.server = undefined; this.ws = undefined; this.transfers = undefined
    ws?.clients.forEach(socket => socket.terminate()); ws?.close()
    if (server?.listening) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
    await transfers?.stop()
    await this.deps.link.desktop?.stopAll('host_stopped').catch(() => {})
    await this.deps.link.terminal?.stopAll('host_stopped').catch(() => {})
  }
  async endSession() { this.ownerId = undefined; await this.stop(); this.settings = emptyDirectSettings() }
}
