import { createHash, randomUUID } from 'node:crypto'
import { DESKTOP_CAPABILITY, DESKTOP_GAME_CAPABILITY, DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY, DESKTOP_VIRTUAL_CAPABILITY, DESKTOP_METHODS, validateDesktopParams } from '@kun/remote-protocol'
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
  private gameCapable = false
  private gameEnabled = false
  private systemAudio = false
  private virtualCapable = false
  private virtualEnabled = false
  private admittedGame = false
  private admittedStartId?: string
  private admittedHandle?: string
  constructor(readonly deps: DesktopEngineDependencies, private ready: (required: boolean) => Promise<RpcPeer | undefined>) {
    this.ports = new DesktopPorts(this.id, deps, () => this.rpc, id => this.contexts.get(id), id => this.enabled && this.selected.has(id),
      reason => { void this.stopAll(reason).catch(() => {}) }, () => this.enabled && this.virtualCapable && this.virtualEnabled,
      () => this.enabled && this.gameCapable && this.gameEnabled && this.admittedGame, () => this.systemAudio)
  }
  private snapshot() { return { supported: this.deps.supported(), gameSupported: this.gameCapable && this.gameEnabled, systemAudioAllowed: this.systemAudio, displays: this.deps.displays(), virtualSupported: this.deps.virtualSupported?.() === true } }
  private selectedIds(status: DesktopAccessStatus) {
    const allowed = new Set(status.displays.filter(value => value.allowed).map(value => value.revision))
    return new Set(this.deps.displays().filter(d => allowed.has(createHash('sha256').update(d.fingerprint).digest('hex'))).map(d => d.id))
  }
  async attach(rpc: RpcPeer) {
    this.rpc = rpc; this.ports.reopen()
    const snapshot = this.snapshot()
    await rpc.call('desktop.create', { id: this.id, snapshot })
    const status = await rpc.call<DesktopAccessStatus>('desktop.command', { id: this.id, method: 'status', snapshot })
    const features = await rpc.call<string[]>('desktop.command', { id: this.id, method: 'capabilities' }).catch((): string[] => [])
    this.deviceOrigins = Array.isArray(features) && (features as string[]).includes(DESKTOP_DEVICE_CAPABILITY)
    this.gameCapable = this.deps.gameSupported?.() === true && Array.isArray(features) && features.includes(DESKTOP_GAME_CAPABILITY)
    this.virtualCapable = snapshot.virtualSupported && Array.isArray(features) && (features as string[]).includes(DESKTOP_VIRTUAL_CAPABILITY)
    this.virtualEnabled &&= this.virtualCapable
    if (this.enabled) {
      const revisions = new Set(snapshot.displays.filter(d => this.selected.has(d.id)).map(d => createHash('sha256').update(d.fingerprint).digest('hex')))
      const displayTokens = status.displays.filter(d => revisions.has(d.revision)).map(d => d.token)
      this.cached = await rpc.call('desktop.command', { id: this.id, method: 'configure', value: { enabled: displayTokens.length > 0 || this.virtualEnabled,
        displayTokens, ...(this.virtualCapable ? { allowVirtual: this.virtualEnabled } : {}) }, snapshot })
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
  private localStatus(status: DesktopAccessStatus) {
    return this.gameCapable ? { ...status, gameSupported: true, gameEnabled: this.gameEnabled, systemAudioEnabled: this.systemAudio } : status
  }
  async status() { this.cached = await this.command<DesktopAccessStatus>('status'); return this.localStatus(this.cached) }
  async configure(value: DesktopConfiguration, current: () => boolean = () => true) {
    const revision = ++this.revision
    const known = this.cached ?? await this.status()
    if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.displayTokens) || value.displayTokens.some(token => !known.displays.some(item => item.token === token))) throw Error('INVALID_REQUEST')
    if (value.allowVirtual && !this.virtualCapable) throw Error('DESKTOP_VIRTUAL_UNAVAILABLE')
    const { allowGame, allowSystemAudio, ...settings } = value
    if ([allowGame, allowSystemAudio].some(flag => flag !== undefined && typeof flag !== 'boolean')) throw Error('INVALID_REQUEST')
    const game = value.enabled && (allowGame ?? this.gameEnabled)
    if (game && !this.gameCapable) throw Error('DESKTOP_GAME_UNAVAILABLE')
    const audio = game && (allowSystemAudio ?? this.systemAudio)
    this.enabled = false
    this.ports.beginStop()
    const status = await this.command<DesktopAccessStatus>('configure', settings)
    if (revision !== this.revision || !current()) { await this.stopAll('authorization_changed'); throw Error('DESKTOP_AUTHORITY_CHANGED') }
    this.gameEnabled = game; this.systemAudio = audio
    this.selected = this.selectedIds(status)
    this.virtualEnabled = status.virtualEnabled === true
    this.enabled = status.enabled; this.cached = status; this.ports.reopen(); return this.localStatus(status)
  }
  async configureRemoteAccess(enabled: boolean, current: () => boolean = () => true) {
    const revision = ++this.revision
    this.enabled = false
    this.ports.beginStop()
    this.gameEnabled = false; this.systemAudio = false
    if (enabled) {
      await this.deps.prepareHost?.(true)
      if (revision !== this.revision || !current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    }
    let status: DesktopAccessStatus
    try { status = await this.command<DesktopAccessStatus>('configureRemoteAccess', enabled) }
    catch (error) {
      if (revision === this.revision) await this.deps.prepareHost?.(false)
      throw error
    }
    if (revision !== this.revision || !current()) { await this.stopAll('authorization_changed'); throw Error('DESKTOP_AUTHORITY_CHANGED') }
    if (!enabled) await this.deps.prepareHost?.(false)
    this.selected = this.selectedIds(status)
    this.virtualEnabled = status.virtualEnabled === true
    this.enabled = status.enabled; this.cached = status; this.ports.reopen(); return this.localStatus(status)
  }
  capabilities() { return this.rpc && !this.rpc.closed && this.deps.supported() && this.enabled ? [DESKTOP_CAPABILITY,
    ...(this.deviceOrigins ? [DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY] : []), ...(this.virtualCapable && this.virtualEnabled ? [DESKTOP_VIRTUAL_CAPABILITY] : [])] : [] }
  descriptors(scopes: readonly string[]) {
    return DESKTOP_METHODS.filter(operation => !operation.startsWith('desktop.virtual.') || (this.virtualCapable && this.virtualEnabled)).map(operation => ({ operation, schemaVersion: 1, resourceKind: 'desktop', supported: this.deps.supported(), enabled: this.enabled && Boolean(this.rpc && !this.rpc.closed),
      authorized: scopes.includes('desktop.view') && (operation !== 'desktop.control.acquire' || scopes.includes('desktop.control')), online: true, allowedActions: ['read', 'control'] }))
  }
  async invoke(method: string, params: unknown, authority: DesktopAuthority) {
    if (this.stopping || this.cleanupBlocked) throw Error('DESKTOP_CLEANUP_UNCONFIRMED')
    validateDesktopParams(method as any, params)
    if (!authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    if (method.startsWith('desktop.virtual.') && (authority.purpose === 'desktop' || !this.enabled || !this.virtualCapable || !this.virtualEnabled)) throw Error('DESKTOP_VIRTUAL_UNAVAILABLE')
    if (method === 'desktop.access.get') return {
      capabilities: [...this.capabilities(), ...(this.enabled && this.gameEnabled && this.gameCapable && authority.purpose === 'desktop' ? [DESKTOP_GAME_CAPABILITY] : [])], supported: this.deps.supported(), enabled: this.enabled,
      viewAllowed: authority.scopes.includes('desktop.view'),
      controlAllowed: authority.scopes.includes('desktop.view') && authority.scopes.includes('desktop.control'), busy: desktopActivityGate.busy()
    }
    if (!['desktop.session.stop', 'desktop.session.cancel', 'desktop.session.get', 'desktop.control.release'].includes(method) && !authority.scopes.includes('desktop.view')) throw Error('DESKTOP_VIEW_REQUIRED')
    if (method === 'desktop.control.acquire' && !authority.scopes.includes('desktop.control')) throw Error('DESKTOP_CONTROL_REQUIRED')
    let handle = [...this.contexts].find(([, entry]) => entry.accountId === authority.accountId && entry.deviceId === authority.deviceId && entry.authorizationId === authority.authorizationId)?.[0]
    if (!handle) { if (this.contexts.size >= 128) throw Error('BACKPRESSURE'); handle = randomUUID() }
    this.contexts.set(handle, authority)
    this.ports.reopen()
    const starting = method === 'desktop.session.start' || method === 'desktop.virtual.start'
    if (starting) {
      const start = params as { startId: string; quality: string }
      const game = start.quality === 'game60'
      if (game && (!this.enabled || !this.gameCapable || !this.gameEnabled || authority.purpose !== 'desktop')) throw Error('DESKTOP_GAME_UNAVAILABLE')
      desktopActivityGate.claim(this.id, 'incoming')
      if (!this.admittedStartId) {
        this.admittedStartId = start.startId; this.admittedHandle = handle; this.admittedGame = game
      }
    }
    try {
      const result = await this.command('invoke', { method, params }, { handle, accountId: authority.accountId, deviceId: authority.deviceId, authorizationId: authority.authorizationId,
        purpose: authority.purpose, hostId: authority.hostId,
        scopes: authority.scopes, valid: authority.current(), expiresAt: Date.now() + Math.min(60000, authority.validForMs?.() ?? 60000) })
      if (result?.state === 'ended') this.releaseActivity(result.startId, handle)
      return result
    } catch (error) {
      if (starting && !this.ports.busy()) {
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
      let stopFailure: { error: unknown } | undefined
      try { if (rpc && !rpc.closed) await rpc.call('desktop.command', { id: this.id, method: 'stopAll', value: reason }, 8000) }
      catch (error) { stopFailure = { error } }
      try { await this.ports.cleanup() }
      catch (error) {
        this.cleanupBlocked = true
        // Cleanup failure keeps safety ownership; preserve the RPC error too when both operations fail.
        if (stopFailure) throw new AggregateError([error, stopFailure.error], 'DESKTOP_STOP_AND_CLEANUP_FAILED')
        throw error
      }
      if (['host_inactive', 'host_stopped', 'application_quit', 'account_changed'].includes(reason)) await this.deps.prepareHost?.(false)
      this.contexts.clear(); this.cleanupBlocked = false
      this.admittedGame = false; this.admittedStartId = this.admittedHandle = undefined; desktopActivityGate.release(this.id)
      if (stopFailure) throw stopFailure.error
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
      this.admittedGame = false; this.admittedStartId = this.admittedHandle = undefined; desktopActivityGate.release(this.id)
    }
  }
  detach() {
    this.rpc = undefined; this.contexts.clear(); this.deviceOrigins = false; this.virtualCapable = false
    if (!this.ports.busy()) { this.admittedGame = false; this.admittedStartId = this.admittedHandle = undefined; desktopActivityGate.release(this.id) }
  }
}
