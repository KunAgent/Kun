import type { RpcPeer } from '@kun/control-host'
import type { DesktopAuthority, DesktopEngineDependencies, DesktopInputPort } from '@kun/control-runtime/desktop'
import type { DesktopCapturePort } from '../remote-desktop/capture-host'
import type { CaptureEvent } from '../../shared/remote-desktop'

type Resource = { kind: 'capture' | 'input'; port: any; authority: DesktopAuthority; capture?: string }
export class DesktopPorts {
  private resources = new Map<string, Resource>()
  private authority?: DesktopAuthority
  private session?: string
  private healthAt = 0
  private healthSequence = 0
  private foregroundUntil = 0
  private setupUntil = 0
  private challenges = new Map<string, number>()
  private hello?: { sessionId: string; epoch: number }
  private media?: { sessionId: string; epoch: number }
  private closing = false
  constructor(readonly id: string, readonly deps: DesktopEngineDependencies,
    private rpc: () => RpcPeer | undefined, private context: (id: string) => DesktopAuthority | undefined,
    private allowedDisplay: (id: number) => boolean, private end: () => void) {}
  private emit(id: string, event: CaptureEvent) {
    if (event.event === 'health') {
      const value = event.value as any
      if (value?.trackState === 'live' && value.muted === false && Number.isSafeInteger(value.sampleId) && value.sampleId > this.healthSequence &&
          Number.isSafeInteger(value.framesSent) && value.framesSent >= 0 && Number.isSafeInteger(value.framesEncoded) && value.framesEncoded >= 0) {
        this.healthSequence = value.sampleId; this.healthAt = performance.now()
      }
      else this.healthAt = 0
    }
    if (event.event === 'data') {
      try {
        const data = JSON.parse((event.value as any).raw)
        if (data.v === 1 && data.type === 'hello') this.hello = { sessionId: data.sessionId, epoch: data.epoch }
        if (data.type === 'probe.ack' && this.media && this.media.sessionId === data.sessionId && this.media.epoch === data.epoch &&
            this.challenges.has(data.challenge) && performance.now() - this.challenges.get(data.challenge)! <= 3000) {
          this.challenges.delete(data.challenge); this.foregroundUntil = performance.now() + 6000
        }
      } catch { /* The control engine also validates the full channel schema. */ }
    }
    const rpc = this.rpc()
    if (rpc && !rpc.closed) rpc.notify('desktop.resource', { id, event })
  }
  private require(authority = this.authority, control = false) {
    if (this.closing || !authority?.current() || (authority.validForMs?.() ?? 1) <= 0 ||
        !authority.scopes.includes(control ? 'desktop.control' : 'desktop.view')) throw Error('DESKTOP_AUTHORITY_CHANGED')
    return authority
  }
  async call(value: any) {
    const { operation, resourceId, args = [] } = value
    if (operation === 'permissions') return this.deps.permissions()
    if (operation === 'authorizeOrigin' || operation === 'ice') {
      const authority = this.require(this.context(value.authorityId))
      if (operation === 'ice') return this.deps.ice(authority)
      await this.deps.authorizeOrigin(authority, value.origin)
      this.require(authority); this.authority = authority
      this.setupUntil = performance.now() + 15000
      return
    }
    if (operation === 'arbiter.acquire') {
      this.require(undefined, true)
      if (performance.now() - this.healthAt > 2000 || performance.now() >= this.foregroundUntil) throw Error('DESKTOP_CONTROL_REQUIRED')
      await this.deps.arbiter.acquire(value.session); this.session = value.session; return
    }
    if (operation === 'arbiter.release') { await this.deps.arbiter.release(value.session); if (this.session === value.session) this.session = undefined; return }
    if (operation === 'indicator.hide') { this.deps.indicator?.hide(); return }
    if (operation === 'indicator.show' || operation === 'indicator.update') {
      const authority = this.require()
      const status = { ...value.value, peer: authority.deviceId }
      if (operation === 'indicator.show') this.deps.indicator?.show(status, this.end)
      else this.deps.indicator?.update(status)
      return
    }
    if (typeof resourceId !== 'string' || !/^[a-f0-9-]{36}$/.test(resourceId)) throw Error('CONTROL_RPC_REJECTED')
    const [kind, method] = String(operation).split('.')
    const methods = kind === 'capture' ? ['open', 'identity', 'start', 'answer', 'ice', 'send', 'quality', 'stop'] : kind === 'input' ? ['start', 'ready', 'setupLease', 'lease', 'input', 'release', 'stop'] : []
    if (!methods.includes(method) || !Array.isArray(args) || args.length > 5) throw Error('CONTROL_RPC_REJECTED')
    let resource = this.resources.get(resourceId)
    const cleanup = ['stop', 'release'].includes(method)
    if (!cleanup) this.require(resource?.authority)
    if (!resource) {
      if (cleanup) return
      if (this.resources.size >= 4) throw Error('DESKTOP_BUSY')
      const authority = this.require()
      if (kind === 'capture' && method === 'open') {
        const displayId = value.fields?.displayId
        if (!this.allowedDisplay(displayId)) throw Error('DESKTOP_SOURCE_CHANGED')
        resource = { kind, authority, port: this.deps.capture(displayId, event => this.emit(resourceId, event)) }
        this.healthSequence = 0; this.healthAt = 0
      } else if (kind === 'input' && method === 'start') {
        if (!this.allowedDisplay(args[0])) throw Error('DESKTOP_SOURCE_CHANGED')
        const capture = [...this.resources.entries()].find(([, entry]) => entry.kind === 'capture')
        if (!capture) throw Error('DESKTOP_CAPTURE_NOT_ISOLATED')
        const identity = await (capture[1].port as DesktopCapturePort).identity()
        if (identity.pid !== args[1] || identity.birth !== args[2]) throw Error('DESKTOP_CAPTURE_NOT_ISOLATED')
        this.require(authority)
        resource = { kind, authority, capture: capture[0], port: this.deps.input(() => { this.end() }) }
      } else throw Error('CONTROL_RPC_REJECTED')
      this.resources.set(resourceId, resource)
    }
    if (resource.kind !== kind) throw Error('CONTROL_RPC_REJECTED')
    if (kind === 'input') {
      if (method === 'input' || method === 'ready') {
        this.require(resource.authority, true)
        if (method === 'input' && (!this.session || !this.deps.arbiter.owns(this.session) || performance.now() - this.healthAt > 2000 || performance.now() >= this.foregroundUntil))
          throw Error('DESKTOP_CONTROL_REQUIRED')
      }
      if (method === 'lease' || method === 'setupLease') {
        const remaining = (this.media ? this.foregroundUntil : this.setupUntil) - performance.now()
        args[0] = Math.max(0, Math.min(Number(args[0]) || 0, method === 'setupLease' ? 15000 : 6000, remaining, resource.authority.validForMs?.() ?? 6000))
      }
    }
    if (kind === 'capture' && method === 'send') {
      const data = args[1]
      if (data?.type === 'ready') {
        if (this.hello?.sessionId !== data.sessionId || this.hello?.epoch !== data.epoch) throw Error('DESKTOP_AUTHORITY_CHANGED')
        this.media = { sessionId: data.sessionId, epoch: data.epoch }; this.foregroundUntil = performance.now() + 6000
      }
      if (data?.type === 'probe') {
        if (this.challenges.size >= 8) this.challenges.clear()
        this.challenges.set(data.challenge, performance.now())
      }
    }
    const result = await resource.port[method](...args)
    if (method === 'stop') this.resources.delete(resourceId)
    return result
  }
  busy() { return this.resources.size > 0 }
  ownsPeer(peer: string) { return this.authority?.deviceId === peer }
  beginStop() { this.closing = true }
  reopen() { this.closing = false }
  async cleanup() {
    this.closing = true
    const results = await Promise.allSettled([...this.resources.entries()].map(async ([id, resource]) => {
      if (resource.kind === 'input') await (resource.port as DesktopInputPort).stop()
      else await (resource.port as DesktopCapturePort).stop()
      this.resources.delete(id)
    }))
    if (results.some(result => result.status === 'rejected')) throw Error('DESKTOP_CLEANUP_UNCONFIRMED')
    if (this.session) await this.deps.arbiter.release(this.session)
    this.session = undefined; this.authority = undefined; this.healthAt = 0; this.media = this.hello = undefined
    this.foregroundUntil = 0; this.challenges.clear(); this.deps.indicator?.hide()
  }
}
