import { randomUUID } from 'node:crypto'
import {
  RemoteApi, RemoteClient, DESKTOP_METHODS, DESKTOP_STOP_METHODS, DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY,
  validateDesktopParams, validateDesktopResult, validateDesktopEvent,
  type DeviceIdentity, type Socket, type DesktopMethod, type DesktopParams, type DesktopResults, type DesktopSession
} from '@kun/remote-protocol'
import type { ArtAccountAccess } from '../art-assets/account-access'
import { hasKunAccountSession } from '../../shared/kun-account'
import type { ComputerAccessStatus, ComputerDevice, ComputerViewerEvent, DesktopIceConfiguration } from '../../shared/computer-access'
import { DesktopActivityGate, desktopActivityGate } from '../remote-desktop/activity-gate'
import { registerMobileHost } from '../mobile-link/device-registration'
import { ComputerMembershipLease } from './membership'
import { readAccountEntitlements } from '../account-entitlements'

type Dependencies = {
  account: ArtAccountAccess; origin: string; name: string; supported: boolean; fetch: typeof fetch
  identity(owner: string, role: 'host' | 'controller'): Promise<DeviceIdentity>
  socket(url: string, headers: Record<string, string>): Socket
  gate?: DesktopActivityGate
  event?(value: ComputerViewerEvent): void
}
type Active = { hostId: string; name: string; phase: 'opening' | 'connected' | 'closing' | 'unconfirmed'; startId?: string; session?: DesktopSession; generation: number }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)

/** The trusted controller owns credentials and the stop record even after its viewer is destroyed. */
export class ComputerAccessService {
  private owner?: string
  private observedOwner: string | null | undefined
  private generation = 0
  private initialization?: Promise<void>
  private api?: RemoteApi
  private client?: RemoteClient
  private devices: ComputerDevice[] = []
  private active?: Active
  private pending = 0
  private closing?: Promise<void>
  private error?: string
  private ending = false
  private resetting?: Promise<void>
  private membership?: ComputerMembershipLease
  private membershipTimer?: ReturnType<typeof setInterval>
  private readonly gate: DesktopActivityGate
  private readonly gateKey = 'computer-viewer:' + randomUUID()
  private readonly unsubscribe: () => void
  private readonly unsubscribeEnding: () => void
  constructor(private readonly deps: Dependencies) {
    this.gate = deps.gate ?? desktopActivityGate
    this.unsubscribe = deps.account.onState(state => {
      const owner = hasKunAccountSession(state) ? state.user?.id ?? null : null
      const changed = this.observedOwner !== undefined && owner !== this.observedOwner
      this.observedOwner = owner
      if (changed || this.owner && owner !== this.owner) void this.reset()
    })
    this.unsubscribeEnding = deps.account.onSessionEnding?.(session => {
      if (this.owner && session.userId && this.owner !== session.userId) return Promise.resolve()
      return this.reset()
    }) ?? (() => {})
  }
  status(): ComputerAccessStatus {
    if (this.ending) return { supported: this.deps.supported, online: false, devices: [] }
    return { supported: this.deps.supported, online: this.client?.online === true, devices: this.devices.map(device => ({ ...device })),
      ...(this.error ? { error: this.error } : {}),
      ...(this.active ? { active: { hostId: this.active.hostId, name: this.active.name, phase: this.active.phase } } : {}) }
  }
  configuration() {
    if (!this.active || this.active.phase === 'closing' || this.active.phase === 'unconfirmed') throw Error('DESKTOP_SESSION_EXPIRED')
    return { hostId: this.active.hostId, name: this.active.name }
  }
  private current(generation: number) {
    if (generation !== this.generation || this.ending || this.owner && this.observedOwner !== undefined && this.observedOwner !== this.owner) throw Error('ACCOUNT_CHANGED')
  }
  private async initialize() {
    if (!this.deps.supported) throw Error('DESKTOP_UNSUPPORTED')
    if (this.api && this.client && !this.ending) return
    if (this.initialization) return this.initialization
    const generation = this.generation
    const task = (async () => {
      const account = await this.deps.account.getState(); this.current(generation)
      if (!hasKunAccountSession(account) || !account.user) throw Error('LOGIN_REQUIRED')
      const owner = account.user.id
      if (this.observedOwner !== undefined && this.observedOwner !== owner) throw Error('ACCOUNT_CHANGED')
      this.owner = owner; this.observedOwner = owner
      this.membership = new ComputerMembershipLease(owner, () => readAccountEntitlements(this.deps.account, this.deps.fetch, this.deps.origin))
      await this.requireMax(true); this.current(generation)
      const host = await this.deps.identity(owner, 'host'); this.current(generation)
      const controller = await this.deps.identity(owner, 'controller'); this.current(generation)
      const token = async () => { const value = await this.deps.account.accessToken(); this.current(generation); return value }
      const hostApi = new RemoteApi({ origin: this.deps.origin, fetch: this.deps.fetch, token, identity: async () => host })
      await registerMobileHost(hostApi, this.deps.name, 'macos'); this.current(generation)
      const capabilities = await hostApi.request('/capabilities'); this.current(generation)
      if (capabilities.desktop?.computerAccess !== true) throw Error('COMPUTER_SERVER_UPDATE_REQUIRED')
      await hostApi.request('/desktop/controller', 'POST', { deviceId: controller.id, credential: controller.credential }); this.current(generation)
      const api = new RemoteApi({ origin: this.deps.origin, fetch: this.deps.fetch, token, identity: async () => controller })
      this.api = api
      this.client = new RemoteClient({
        ticket: signal => api.request('/relay-tickets', 'POST', undefined, false, signal),
        renew: signal => api.request('/relay-lease', 'POST', undefined, false, signal), socket: this.deps.socket,
        state: (online, reason) => {
          if (generation !== this.generation) return
          this.error = online ? undefined : reason
          if (!online && this.active && !['closing', 'unconfirmed'].includes(this.active.phase)) void this.close('signaling_lost')
        },
        frame: frame => {
          const active = this.active
          if (generation !== this.generation || !active || frame.src !== active.hostId) return
          if (frame.kind === 'resync_required') { void this.close('authorization_changed'); return }
          if (frame.kind !== 'event') return
          try {
            const value = validateDesktopEvent(frame.payload)
            if (value.event === 'desktop.session.ended' && value.confirmed && value.startId === active.startId &&
                (!active.session || value.sessionId === active.session.sessionId)) this.finished(active)
            this.deps.event?.({ type: 'desktop', value })
          } catch { /* Invalid device events cannot change the trusted session record. */ }
        }
      })
      this.client.start()
    })()
    this.initialization = task
    try { await task } finally { if (this.initialization === task) this.initialization = undefined }
  }
  async refresh() {
    await this.initialize()
    await this.requireMax()
    const generation = this.generation, value = await this.api!.request('/desktop/devices'); this.current(generation)
    if (!Array.isArray(value.devices) || value.devices.length > 16) throw Error('INVALID_COMPUTER_DIRECTORY')
    this.devices = value.devices.map((device: ComputerDevice) => {
      if (!uuid(device.id) || !uuid(device.installationId) || typeof device.name !== 'string' || device.name.length > 80 ||
          typeof device.enabled !== 'boolean' || typeof device.supported !== 'boolean' ||
          !['macos', 'windows', 'linux'].includes(device.platform) || ![true, false, null].includes(device.online) ||
          device.grantId !== null && !uuid(device.grantId)) throw Error('INVALID_COMPUTER_DIRECTORY')
      return { id: device.id, installationId: device.installationId, name: device.name, platform: device.platform,
        enabled: device.enabled, supported: device.supported, online: device.online, grantId: device.grantId }
    })
    // A successful authenticated directory read proves repaired membership/device access.
    // Socket replacement remains terminal until an explicit application restart.
    if (!this.client?.online && ['AUTHORIZATION_REJECTED', 'VIP_REQUIRED'].includes(this.error ?? '')) this.client?.start()
    return this.status()
  }
  private device(id: string) {
    if (!uuid(id)) throw Error('INVALID_REQUEST')
    const device = this.devices.find(item => item.id === id)
    if (!device || device.platform !== 'macos' || !device.supported) throw Error('COMPUTER_HOST_UPDATE_REQUIRED')
    if (!device.enabled || device.online !== true) throw Error('DEVICE_OFFLINE')
    return device
  }
  async pair(hostId: string) {
    await this.refresh(); this.device(hostId)
    await this.requireMax(true)
    await this.api!.request('/desktop/pairings', 'POST', { hostId })
    return this.refresh()
  }
  async open(hostId: string) {
    await this.refresh()
    await this.requireMax(true)
    if (this.active) throw Error(this.active.phase === 'unconfirmed' ? 'DESKTOP_CLEANUP_UNCONFIRMED' : 'DESKTOP_BUSY')
    const device = this.device(hostId)
    if (!device.grantId) throw Error('AUTHORIZATION_REQUIRED')
    if (!this.client?.online) throw Error('DEVICE_OFFLINE')
    this.gate.claim(this.gateKey, 'outgoing')
    const active: Active = { hostId, name: device.name, phase: 'opening', generation: this.generation }
    this.active = active; this.closing = undefined
    this.membershipTimer = setInterval(() => {
      if (!this.active || ['closing', 'unconfirmed'].includes(this.active.phase)) return
      if (!this.membership?.current()) { this.error = 'ENTITLEMENTS_UNAVAILABLE'; void this.close('membership_changed'); return }
      if (this.membership.remaining() < 10000) void this.requireMax(true).catch(() => {})
    }, 1000)
    this.membershipTimer.unref?.()
    try {
      const access = await this.invoke('desktop.access.get', {})
      if (!access.capabilities.includes(DESKTOP_DEVICE_CAPABILITY) || !access.capabilities.includes(DESKTOP_SCOPED_CAPABILITY)) throw Error('COMPUTER_HOST_UPDATE_REQUIRED')
      if (!access.enabled) throw Error('DESKTOP_DISABLED')
      if (!access.viewAllowed) throw Error('DESKTOP_VIEW_REQUIRED')
      if (access.busy) throw Error('DESKTOP_BUSY')
      return this.configuration()
    } catch (error) { if (!active.startId) this.finished(active); throw error }
  }
  async invoke<M extends DesktopMethod>(method: M, params: DesktopParams[M]): Promise<DesktopResults[M]> {
    if (!(DESKTOP_METHODS as readonly string[]).includes(method)) throw Error('DESKTOP_UNSUPPORTED')
    validateDesktopParams(method, params)
    const active = this.active, client = this.client
    const cleanup = DESKTOP_STOP_METHODS.has(method) || method === 'desktop.session.get' || method === 'desktop.control.release'
    if (!active || !client?.online || this.ending && !cleanup) throw Error('DESKTOP_SESSION_EXPIRED')
    if (!cleanup) await this.requireMax(method === 'desktop.session.start' || method === 'desktop.control.acquire')
    if (this.active !== active) throw Error('DESKTOP_SESSION_EXPIRED')
    if (!cleanup && ['closing', 'unconfirmed'].includes(active.phase)) throw Error('DESKTOP_CLEANUP_UNCONFIRMED')
    if (!cleanup && this.pending >= 4) throw Error('BACKPRESSURE')
    const value = params as Record<string, any>
    if (method === 'desktop.session.start') {
      if (value.origin.kind !== 'device' || value.origin.id !== active.hostId || active.startId && value.startId !== active.startId) throw Error('DESKTOP_AUTHORITY_CHANGED')
      active.startId = value.startId
    }
    if (method === 'desktop.session.cancel' && !active.startId) active.startId = value.startId
    if (value.sessionId && value.sessionId !== active.session?.sessionId ||
        value.startId && active.startId && value.startId !== active.startId) throw Error('DESKTOP_AUTHORITY_CHANGED')
    this.pending++
    try {
      const result = validateDesktopResult(method, await client.invoke(active.hostId, {
        method, params, requestId: randomUUID(), expiresAt: Date.now() + 15000
      }, cleanup ? 2000 : 15000))
      if (this.active !== active || active.generation !== this.generation) throw Error('DESKTOP_AUTHORITY_CHANGED')
      if ('session' in result) {
        if (result.session.origin.kind !== 'device' || result.session.origin.id !== active.hostId || result.session.startId !== active.startId) throw Error('DESKTOP_AUTHORITY_CHANGED')
        active.session = result.session
        if (!['closing', 'unconfirmed'].includes(active.phase)) active.phase = 'connected'
      }
      if ('state' in result && result.state === 'ended' && result.startId === active.startId) this.finished(active)
      return result
    } finally { this.pending-- }
  }
  async ice(): Promise<DesktopIceConfiguration> {
    await this.requireMax(true)
    const active = this.active
    if (!active || !this.api || ['closing', 'unconfirmed'].includes(active.phase)) throw Error('DESKTOP_SESSION_EXPIRED')
    const value = await this.api.request<DesktopIceConfiguration>('/desktop/ice', 'POST', { peerDeviceId: active.hostId })
    if (this.active !== active || active.generation !== this.generation || value.schemaVersion !== 1 || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() ||
        !Array.isArray(value.iceServers) || value.iceServers.length > 8 || !value.iceServers.length) throw Error('DESKTOP_ICE_UNAVAILABLE')
    for (const server of value.iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
      if (!urls.length || urls.length > 8 || urls.some(url => typeof url !== 'string' || !/^(stun|stuns|turn|turns):[^\s]{1,2048}$/.test(url))) throw Error('DESKTOP_ICE_UNAVAILABLE')
    }
    return value
  }
  release() {
    this.deps.event?.({ type: 'release' })
    const session = this.active?.session
    if (session) void this.invoke('desktop.control.release', { sessionId: session.sessionId, epoch: session.epoch }).catch(() => {})
  }
  close(reason = 'user_ended'): Promise<void> {
    clearInterval(this.membershipTimer); this.membershipTimer = undefined
    if (this.closing) return this.closing
    const active = this.active
    if (!active) return Promise.resolve()
    active.phase = 'closing'
    this.deps.event?.({ type: 'close', reason })
    const task = (async () => {
      if (!active.startId) { this.finished(active); return }
      try {
        const session = active.session
        const result = session ? await this.invoke('desktop.session.stop', { sessionId: session.sessionId, observedEpoch: session.epoch, reason })
          : await this.invoke('desktop.session.cancel', { startId: active.startId!, reason })
        if (result.state !== 'ended' && this.active === active) active.phase = 'unconfirmed'
      } catch { if (this.active === active) active.phase = 'unconfirmed' }
    })()
    this.closing = task
    void task.finally(() => { if (this.closing === task) this.closing = undefined }).catch(() => {})
    return task
  }
  async confirmClosed() {
    const active = this.active
    if (active?.phase === 'unconfirmed' && active.startId) {
      if (!this.client?.online) this.client?.resume()
      await this.invoke('desktop.session.get', { startId: active.startId })
      if (this.active === active) await this.close('cleanup_retry')
    }
    return this.status()
  }
  private async requireMax(force = false) {
    const generation = this.generation, membership = this.membership
    this.current(generation)
    if (!membership) throw Error('LOGIN_REQUIRED')
    try { await membership.require(force); this.current(generation) }
    catch (error) {
      if (this.membership === membership && generation === this.generation) {
        this.error = error instanceof Error ? error.message : 'ENTITLEMENTS_UNAVAILABLE'
        if (this.active) void this.close('membership_changed')
      }
      throw error
    }
  }
  private finished(active: Active) {
    if (this.active === active) { clearInterval(this.membershipTimer); this.membershipTimer = undefined; this.active = undefined; this.gate.release(this.gateKey) }
  }
  reset(): Promise<void> {
    if (this.resetting) return this.resetting
    // Fence new work and hide old account metadata before awaiting the existing cleanup channel.
    this.ending = true; this.devices = []
    this.membership?.invalidate(); this.membership = undefined
    const task = (async () => {
      await this.close('account_changed')
      ++this.generation
      this.client?.stop(); this.client = undefined; this.api = undefined; this.owner = undefined
      this.error = undefined; this.active = undefined; this.gate.release(this.gateKey)
      this.initialization = undefined
    })().finally(() => { if (this.resetting === task) { this.resetting = undefined; this.ending = false } })
    this.resetting = task
    return task
  }
  async dispose() { this.unsubscribe(); this.unsubscribeEnding(); await this.reset() }
}
