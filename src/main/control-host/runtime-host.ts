import { app, net } from 'electron'
import { join } from 'node:path'
import { UPDATE_TRUST, CONTROL_HOST_BUILD_GENERATION } from './update-trust'
import { ControlPackageManager, type Manifest, type RpcPeer } from '@kun/control-host'
import type { ClientDependencies } from '@kun/remote-protocol'
import type { DesktopEngineDependencies } from '@kun/control-runtime/desktop'
import { ControlDesktop } from './desktop'
import { ControlRelay } from './transport'
import { startControlProcess, type ControlProcess } from './process'
import { admitControlOperation, pauseControlAdmission, resumeControlAdmission, closeControlAdmission } from './admission'
import { controlViewerEntry, probeControlViewer } from './viewer-resources'
import { logWarn } from '../logger'
import { desktopActivityGate } from '../remote-desktop/activity-gate'
import { stopComputerSessions } from '../computer-access/lifecycle'
import { ControlPackageAccess } from './package-access'

export class ControlRuntimeHost {
  readonly manager: ControlPackageManager
  private readonly access: ControlPackageAccess
  private process?: ControlProcess
  private desktops = new Map<string, ControlDesktop>()
  private relays = new Map<string, ControlRelay>()
  private startup: Promise<void>
  private stopping = false
  private directory?: string
  private release?: Manifest
  private timer: ReturnType<typeof setInterval>
  private checkTimer?: ReturnType<typeof setTimeout>
  private checking = false
  private recovering = false
  private initialized = false
  private nextApplyAt = 0
  constructor() {
    this.manager = new ControlPackageManager({ home: join(app.getPath('userData'), 'control-packages'),
      trust: UPDATE_TRUST,
      host: { platform: process.platform, arch: process.arch, hostApi: 1, minimumVersion: '0.1.6', buildId: `kun-control-host-${CONTROL_HOST_BUILD_GENERATION}-electron${process.versions.electron}-node${process.versions.node}` },
      fetch: (input, init) => net.fetch(String(input), init),
      driver: { probe: (path, release) => this.probe(path, release), activate: (path, release) => this.activate(path, release),
        drain: () => this.drain(), resume: async () => { if (!this.stopping) resumeControlAdmission() }, stop: () => this.stopProcess() } })
    this.access = new ControlPackageAccess(this.manager, () => {
      const transitional = ['starting', 'activating', 'rolling_back', 'disabled', 'not_installed'].includes(this.manager.status().phase)
      return !transitional && this.process && !this.process.exited ? this.process.rpc : undefined
    }, () => this.stopping)
    this.startup = this.initialize()
    void this.startup.catch(() => logWarn('control-package', 'CONTROL_INITIALIZATION_FAILED'))
    this.timer = setInterval(() => {
      for (const desktop of this.desktops.values()) desktop.pulse()
      if (this.process?.exited && !this.stopping && !this.recovering && ['ready', 'available', 'rolled_back', 'waiting_for_idle'].includes(this.manager.status().phase)) {
        this.recovering = true; closeControlAdmission()
        void this.access.operation('recover').catch(() => {}).finally(() => {
          this.recovering = false
          if (!this.stopping && this.process && !this.process.exited) resumeControlAdmission()
        })
      }
      if (!this.checking && Date.now() >= this.nextApplyAt && this.manager.status().phase === 'waiting_for_idle' && !desktopActivityGate.outgoing() && ![...this.desktops.values()].some(desktop => desktop.ports.busy())) {
        this.nextApplyAt = Date.now() + 30000
        this.checking = true; void this.access.operation('apply').catch(() => {}).finally(() => { this.checking = false })
      }
    }, 1000)
    this.timer.unref()
  }
  private async initialize() {
    // The trust root is compiled into the signed application, never downloaded on first use.
    try { await this.access.initialize() }
    finally { this.initialized = true; this.scheduleCheck() }
  }
  private scheduleCheck() {
    if (this.stopping || this.checkTimer || !this.process || this.process.exited) return
    this.checkTimer = setTimeout(() => {
      this.checkTimer = undefined
      void this.access.operation('check').catch(() => {}).finally(() => this.scheduleCheck())
    }, 6 * 3600000 + Math.floor(Math.random() * 1800000))
    this.checkTimer.unref()
  }
  async ready(): Promise<RpcPeer> {
    return this.access.ready()
  }
  available() { return this.access.available() }
  packageOperation(operation: 'check' | 'install' | 'apply') { return this.access.operation(operation) }
  captureDirectory() { if (!this.directory || this.stopping) throw Error('CONTROL_PROCESS_UNAVAILABLE'); return this.directory }
  async viewerResource() {
    await this.ready()
    const release = admitControlOperation()
    try {
      if (!this.directory || !this.release || this.stopping) throw Error('CONTROL_PROCESS_UNAVAILABLE')
      return { entry: controlViewerEntry(this.directory, this.release), release }
    } catch (error) { release(); throw error }
  }
  desktop(deps: DesktopEngineDependencies) { const value = new ControlDesktop(deps, required => required ? this.ready() : this.available()); this.desktops.set(value.id, value); return value }
  relay(deps: ClientDependencies) {
    let relay: ControlRelay
    relay = new ControlRelay(deps, () => this.ready(), active => {
      if (active) this.relays.set(relay.id, relay)
      else this.relays.delete(relay.id)
    })
    this.relays.set(relay.id, relay); return relay
  }
  private handlers() {
    const relay = (id: string) => { const value = this.relays.get(id); if (!value) throw Error('CONTROL_RPC_REJECTED'); return value }
    const socketRelay = (id: string) => relay(String(id).split(':')[0])
    return {
      'relay.ticket': (value: any) => relay(value.id).ticket(),
      'relay.renew': (value: any) => relay(value.id).renew(),
      'relay.socket.open': (value: any) => relay(value.clientId).open(value.key, value.id),
      'relay.socket.send': (value: any) => socketRelay(value.id).socketSend(value.id, value.data),
      'relay.socket.close': (value: any) => socketRelay(value.id).socketClose(value.id),
      'desktop.port': (value: any) => { const desktop = this.desktops.get(value.engine); if (!desktop) throw Error('CONTROL_RPC_REJECTED'); return desktop.ports.call(value) }
    }
  }
  private event(name: string, value: any) {
    if (name === 'relay.event') this.relays.get(value.id)?.event(value.event, value.value)
    if (name === 'desktop.emit') for (const desktop of this.desktops.values()) desktop.emit(value.handle, value.event)
    if (name === 'desktop.diagnostic') this.desktops.get(value.id)?.deps.diagnostic?.(value.value)
  }
  private async probe(directory: string, release: Manifest) {
    const probe = await startControlProcess(directory, release, {}, () => {}, () => {})
    try { await probe.rpc.call('health'); await probeControlViewer(directory, release) } finally { await probe.stop() }
  }
  private async activate(directory: string, release: Manifest) {
    if (this.stopping) throw Error('CONTROL_HOST_STOPPED')
    await this.stopProcess()
    await probeControlViewer(directory, release)
    if (this.stopping) throw Error('CONTROL_HOST_STOPPED')
    const process = await startControlProcess(directory, release, this.handlers(), (name, value) => this.event(name, value), () => {
      for (const relay of this.relays.values()) relay.detach()
      for (const desktop of this.desktops.values()) void desktop.ports.cleanup().catch(() => {})
      logWarn('control-package', 'CONTROL_PROCESS_EXITED')
    })
    if (this.stopping) { await process.stop(); throw Error('CONTROL_HOST_STOPPED') }
    this.process = process; this.directory = directory; this.release = release
    for (const desktop of this.desktops.values()) await desktop.attach(process.rpc)
    for (const relay of this.relays.values()) await relay.attach(process.rpc)
    // Observe local health; connectivity and membership are not activation health signals.
    for (let index = 0; index < (this.initialized ? 30 : 3); index++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const health = await process.rpc.call('health', {}, 2000)
      if (health.releaseId !== release.releaseId || this.stopping) throw Error('CONTROL_ACTIVATION_FAILED')
    }
    this.scheduleCheck()
  }
  private async drain() {
    if (this.stopping || desktopActivityGate.outgoing() || [...this.desktops.values()].some(desktop => desktop.ports.busy()) || !pauseControlAdmission()) return false
    await this.stopProcess()
    return true
  }
  private async stopProcess() {
    const process = this.process
    // First use may be waiting for this installation in viewer.open(). With no old
    // runtime there is nothing to drain; cancelling that waiter would defeat first use.
    if (process) await stopComputerSessions('control_package_changed')
    // Transport closure fences old requests but never stops accepted Kun tasks.
    for (const relay of this.relays.values()) relay.detach()
    let failure: unknown
    try { await process?.stop() } catch (error) { failure = error }
    const results = await Promise.allSettled([...this.desktops.values()].map(async desktop => { await desktop.ports.cleanup(); desktop.detach() }))
    if (failure || results.some(result => result.status === 'rejected')) throw Error('CONTROL_CLEANUP_UNCONFIRMED')
    this.process = undefined; this.directory = undefined; this.release = undefined
  }
  async shutdown() {
    this.stopping = true; clearInterval(this.timer); clearTimeout(this.checkTimer); closeControlAdmission()
    await this.manager.shutdown()
  }
}
let host: ControlRuntimeHost | undefined
export function controlRuntimeHost() { return host ??= new ControlRuntimeHost() }
export async function stopControlRuntimeHost() { await host?.shutdown() }
