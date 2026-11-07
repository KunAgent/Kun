import { randomUUID } from 'node:crypto'
import { DESKTOP_CAPABILITY, DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY, DESKTOP_METHODS, validateDesktopParams } from '@kun/remote-protocol'
import type { RpcPeer } from '@kun/control-host'
import type { DesktopAuthority, DesktopEngineDependencies, DesktopAccessStatus, DesktopConfiguration } from '@kun/control-runtime/desktop'
import { DesktopPorts } from './desktop-ports'
import { desktopActivityGate } from '../remote-desktop/activity-gate'

export class ControlDesktop {
  readonly id = randomUUID()
  readonly ports: DesktopPorts
  private rpc?: RpcPeer
  private contexts = new Map<string, DesktopAuthority>()
  private selected = new Set<number>()
  private cached?: DesktopAccessStatus
  private enabled = false
  private revision = 0
  private stopping?: Promise<void>
  private cleanupBlocked = false
  private deviceOrigins = false
  private admittedStartId?: string
  private admittedHandle?: string
  constructor(readonly deps: DesktopEngineDependencies, private ready: (required: boolean) => Promise<RpcPeer | undefined>) {
    this.ports = new DesktopPorts(this.id, deps, () => this.rpc, id => this.contexts.get(id), id => this.enabled && this.selected.has(id),
      () => { void this.stopAll('host_user_ended').catch(() => {}) })
  }
  private snapshot() { return { supported: this.deps.supported(), displays: this.deps.displays() } }
  async attach(rpc: RpcPeer) {
    this.rpc = rpc; this.ports.reopen()
    const snapshot = this.snapshot()
    await rpc.call('desktop.create', { id: this.id, snapshot })
    const status = await rpc.call<DesktopAccessStatus>('desktop.command', { id: this.id, method: 'status', snapshot })
    const features = await rpc.call<string[]>('desktop.command', { id: this.id, method: 'capabilities' }).catch(() => [])
    this.deviceOrigins = Array.isArray(features) && (features as string[]).includes(DESKTOP_DEVICE_CAPABILITY)
    if (this.enabled) {
      const displayTokens = status.displays.filter((_, index) => this.selected.has(snapshot.displays[index]?.id)).map(display => display.token)
      this.cached = await rpc.call('desktop.command', { id: this.id, method: 'configure', value: { enabled: displayTokens.length > 0, displayTokens }, snapshot })
      this.enabled = Boolean(this.cached?.enabled)
    } else this.cached = status
  }
  private async command<T = any>(method: string, value?: unknown, context?: unknown): Promise<T> {
    const cleanup = method === 'invoke' && ['desktop.session.stop', 'desktop.session.cancel', 'desktop.session.get', 'desktop.control.release']
      .includes((value as {method?: string})?.method ?? '')
    const required = method !== 'status' && !(method === 'configureRemoteAccess' && value === false) &&
      !(method === 'configure' && (value as DesktopConfiguration)?.enabled === false) && !cleanup
    const rpc = await this.ready(required)
    if (!rpc) {
      if (cleanup) throw Error('CONTROL_PACKAGE_NOT_INSTALLED')
      if (required) throw Error('CONTROL_PROCESS_UNAVAILABLE')
      return { supported: this.deps.supported(), enabled: false, ready: false, reason: 'CONTROL_PACKAGE_NOT_INSTALLED', displays: [] } as T
    }
    if (this.rpc !== rpc) await this.attach(rpc)
    return rpc.call('desktop.command', { id: this.id, method, value, context, snapshot: this.snapshot() }, 25000)
  }
  async status() { this.cached = await this.command<DesktopAccessStatus>('status'); return this.cached }
  async configure(value: DesktopConfiguration, current: () => boolean = () => true) {
    const revision = ++this.revision
    const known = this.cached ?? await this.status(), displays = this.deps.displays()
    if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.displayTokens) || value.displayTokens.some(token => !known.displays.some(item => item.token === token))) throw Error('INVALID_REQUEST')
    this.enabled = false
    this.ports.beginStop()
    const status = await this.command<DesktopAccessStatus>('configure', value)
    if (revision !== this.revision || !current()) { await this.stopAll('authorization_changed'); throw Error('DESKTOP_AUTHORITY_CHANGED') }
    this.selected = new Set(displays.filter((_, index) => status.displays[index]?.allowed).map(display => display.id))
    this.enabled = status.enabled; this.cached = status; this.ports.reopen(); return status
  }
  async configureRemoteAccess(enabled: boolean, current: () => boolean = () => true) {
    const revision = ++this.revision
    this.enabled = false
    this.ports.beginStop()
    const status = await this.command<DesktopAccessStatus>('configureRemoteAccess', enabled)
    if (revision !== this.revision || !current()) { await this.stopAll('authorization_changed'); throw Error('DESKTOP_AUTHORITY_CHANGED') }
    this.selected = new Set(this.deps.displays().filter((_, index) => status.displays[index]?.allowed).map(display => display.id))
    this.enabled = status.enabled; this.cached = status; this.ports.reopen(); return status
  }
  capabilities() { return this.rpc && !this.rpc.closed && this.deps.supported() && this.enabled ? [DESKTOP_CAPABILITY, ...(this.deviceOrigins ? [DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY] : [])] : [] }
  descriptors(scopes: readonly string[]) {
    return DESKTOP_METHODS.map(operation => ({ operation, schemaVersion: 1, resourceKind: 'desktop', supported: this.deps.supported(), enabled: this.enabled && Boolean(this.rpc && !this.rpc.closed),
      authorized: scopes.includes('desktop.view') && (operation !== 'desktop.control.acquire' || scopes.includes('desktop.control')), online: true, allowedActions: ['read', 'control'] }))
  }
  async invoke(method: string, params: unknown, authority: DesktopAuthority) {
    if (this.stopping || this.cleanupBlocked) throw Error('DESKTOP_CLEANUP_UNCONFIRMED')
    validateDesktopParams(method as any, params)
    if (!authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    if (method === 'desktop.access.get') return {
      capabilities: this.capabilities(), supported: this.deps.supported(), enabled: this.enabled,
      viewAllowed: authority.scopes.includes('desktop.view'),
      controlAllowed: authority.scopes.includes('desktop.view') && authority.scopes.includes('desktop.control'), busy: desktopActivityGate.busy()
    }
    if (!['desktop.session.stop', 'desktop.session.cancel', 'desktop.session.get', 'desktop.control.release'].includes(method) && !authority.scopes.includes('desktop.view')) throw Error('DESKTOP_VIEW_REQUIRED')
    if (method === 'desktop.control.acquire' && !authority.scopes.includes('desktop.control')) throw Error('DESKTOP_CONTROL_REQUIRED')
    let handle = [...this.contexts].find(([, entry]) => entry.accountId === authority.accountId && entry.deviceId === authority.deviceId && entry.authorizationId === authority.authorizationId)?.[0]
    if (!handle) { if (this.contexts.size >= 128) throw Error('BACKPRESSURE'); handle = randomUUID() }
    this.contexts.set(handle, authority)
    this.ports.reopen()
    if (method === 'desktop.session.start') {
      desktopActivityGate.claim(this.id, 'incoming')
      if (!this.admittedStartId) { this.admittedStartId = (params as {startId: string}).startId; this.admittedHandle = handle }
    }
    try {
      const result = await this.command('invoke', { method, params }, { handle, accountId: authority.accountId, deviceId: authority.deviceId, authorizationId: authority.authorizationId,
        purpose: authority.purpose, hostId: authority.hostId,
        scopes: authority.scopes, valid: authority.current(), expiresAt: Date.now() + Math.min(60000, authority.validForMs?.() ?? 60000) })
      if (result?.state === 'ended') this.releaseActivity(result.startId, handle)
      return result
    } catch (error) {
      if (method === 'desktop.session.start' && !this.ports.busy()) {
        const status = await this.command<DesktopAccessStatus>('status').catch(() => undefined)
        if (status && !status.active) this.releaseActivity((params as {startId: string}).startId, handle)
      }
      throw error
    }
  }
  pulse() {
    if (this.cleanupBlocked && !this.stopping) { void this.stopAll('cleanup_retry').catch(() => {}); return }
    if (!this.rpc || this.rpc.closed || !this.contexts.size) return
    this.rpc.notify('desktop.authorities', [...this.contexts].map(([handle, source]) => ({ handle, valid: source.current(),
      expiresAt: Date.now() + Math.min(60000, source.validForMs?.() ?? 60000) })))
  }
  emit(handle: string, event: any) {
    if (event?.event === 'desktop.session.ended' && event.confirmed === true) this.releaseActivity(event.startId, handle)
    const authority = this.contexts.get(handle); if (authority?.current()) authority.emit(event)
  }
  stopAll(reason = 'host_stopped'): Promise<void> {
    this.ports.beginStop()
    if (this.stopping) return this.stopping
    const rpc = this.rpc
    this.stopping = (async () => {
      try { if (rpc && !rpc.closed) await rpc.call('desktop.command', { id: this.id, method: 'stopAll', value: reason }, 8000) }
      finally {
        try { await this.ports.cleanup(); this.contexts.clear(); this.cleanupBlocked = false; this.admittedStartId = this.admittedHandle = undefined; desktopActivityGate.release(this.id) }
        catch (error) { this.cleanupBlocked = true; throw error }
      }
    })().finally(() => { this.stopping = undefined })
    return this.stopping
  }
  authorityChanged(peer: string) {
    for (const [id, authority] of this.contexts) if (authority.deviceId === peer) this.contexts.delete(id)
    if (this.rpc && !this.rpc.closed) void this.rpc.call('desktop.command', { id: this.id, method: 'authorityChanged', value: peer }).catch(() => {})
    if (this.ports.ownsPeer(peer)) void this.stopAll('authorization_changed').catch(() => {})
  }
  private releaseActivity(startId: unknown, handle: string) {
    if (typeof startId === 'string' && startId === this.admittedStartId && handle === this.admittedHandle && !this.ports.busy()) {
      this.admittedStartId = this.admittedHandle = undefined; desktopActivityGate.release(this.id)
    }
  }
  detach() {
    this.rpc = undefined; this.contexts.clear(); this.deviceOrigins = false
    if (!this.ports.busy()) { this.admittedStartId = this.admittedHandle = undefined; desktopActivityGate.release(this.id) }
  }
}
