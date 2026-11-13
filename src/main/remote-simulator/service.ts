import { createHash, randomUUID } from 'node:crypto'
import { SIMULATOR_LIMITS, SIMULATOR_METHODS, SIMULATOR_READ_METHODS, hasRemoteOperationScope,
  validateSimulatorParams, validateSimulatorResult, type SimulatorDevice, type SimulatorFrame,
  type SimulatorInput, type SimulatorMethod, type SimulatorSession, type RemoteScopeName, type CapabilityDescriptor } from '@kun/remote-protocol'

export interface SimulatorAuthority {
  accountId: string; deviceId: string; authorizationId: string; scopes: readonly RemoteScopeName[]
  current(): boolean
}
export interface SimulatorStream { frame(): Promise<Omit<SimulatorFrame, 'sessionId'>>; stop(): Promise<void> }
export interface SimulatorBackend {
  supported(): boolean
  available(): Promise<boolean>
  list(current: () => boolean): Promise<SimulatorDevice[]>
  boot(udid: string, current: () => boolean): Promise<void>
  stream(udid: string, current: () => boolean): Promise<SimulatorStream>
  input(udid: string, input: SimulatorInput, current: () => boolean): Promise<void>
  stopAll?(): Promise<void>
}
interface Running {
  owner: string; startId: string; session: SimulatorSession; expiresAt: number; current(): boolean
  stream: SimulatorStream; sequence: number; inputBusy: boolean; reservation: object
}
// Relay and direct hosts use separate authority stores but share the same physical simulators.
const deviceLeases = new Map<string, object>()
const owner = (a: SimulatorAuthority) => createHash('sha256').update(JSON.stringify([a.accountId, a.deviceId, a.authorizationId])).digest('hex')

/** Simulator lifetime is a view lease. Closing it never shuts down a developer's device. */
export class RemoteSimulatorService {
  private sessions = new Map<string, Running>()
  private starts = new Map<string, Promise<SimulatorSession>>()
  private generation = 0
  constructor(private readonly backend: SimulatorBackend,
    private readonly authorizeOrigin: (origin: { kind: 'code' | 'agent'; id: string }, authority: SimulatorAuthority) => Promise<unknown>) {}

  descriptors(scopes: readonly RemoteScopeName[]): CapabilityDescriptor[] {
    if (!this.backend.supported()) return []
    return SIMULATOR_METHODS.filter(m => hasRemoteOperationScope(m, scopes)).map<CapabilityDescriptor>(operation => ({
      operation, schemaVersion: 1, resourceKind: 'simulator', supported: true, enabled: true, authorized: true,
      online: true, allowedActions: [SIMULATOR_READ_METHODS.includes(operation) ? 'read' : 'control']
    }))
  }
  async invoke(method: string, raw: unknown, authority: SimulatorAuthority): Promise<unknown> {
    const operation = method as SimulatorMethod, p = validateSimulatorParams(operation, raw)
    if (!authority.current()) throw new Error('SIMULATOR_AUTHORITY_CHANGED')
    if (!this.backend.supported()) throw new Error('SIMULATOR_UNSUPPORTED')
    if (!hasRemoteOperationScope(operation, authority.scopes)) throw new Error('REMOTE_SCOPE_REQUIRED')
    await this.sweep()
    let result: unknown
    if (operation === 'simulator.list') {
      await this.authorizeOrigin((p as any).origin, authority)
      if (!authority.current()) throw new Error('SIMULATOR_AUTHORITY_CHANGED')
      result = { devices: await this.backend.list(authority.current), inputAvailable: await this.backend.available() }
    } else if (operation === 'simulator.start') result = await this.start(p as any, authority)
    else {
      const id = (p as { sessionId: string }).sessionId, run = this.sessions.get(id)
      if (run && run.owner !== owner(authority)) throw new Error('SIMULATOR_NOT_ALLOWED')
      if (operation === 'simulator.stop') {
        if (run) { this.sessions.delete(id); await this.stop(run) }
        result = { closed: true }
      } else {
        if (!run || !run.current() || !authority.current()) throw new Error('SIMULATOR_SESSION_ENDED')
        run.expiresAt = Date.now() + SIMULATOR_LIMITS.idleMs
        if (operation === 'simulator.frame') result = { ...await run.stream.frame(), sessionId: id }
        else {
          const input = p as { sequence: number; input: SimulatorInput }
          if (!run.session.inputAvailable) throw new Error('SIMULATOR_INPUT_UNAVAILABLE')
          // An uncertain input is consumed, never replayed after reconnect or a double tap.
          if (input.sequence <= run.sequence) throw new Error('SIMULATOR_INPUT_REPLAY')
          if (run.inputBusy) throw new Error('BACKPRESSURE')
          run.sequence = input.sequence; run.inputBusy = true
          try { await this.backend.input(run.session.udid, input.input, () => run.current() && authority.current() && this.sessions.get(id) === run) }
          finally { run.inputBusy = false }
          result = { accepted: true, sequence: input.sequence }
        }
      }
    }
    if (!authority.current()) throw new Error('SIMULATOR_AUTHORITY_CHANGED')
    return validateSimulatorResult(operation, result)
  }
  private async start(p: { origin: { kind: 'code' | 'agent'; id: string }; udid: string; startId: string }, a: SimulatorAuthority) {
    const generation = this.generation
    const active = () => a.current() && generation === this.generation
    const key = owner(a), start = JSON.stringify([key, p.startId, p.origin, p.udid])
    const existing = [...this.sessions.values()].find(r => r.owner === key && r.startId === start)
    if (existing) return existing.session
    const flight = this.starts.get(start)
    if (flight) return flight
    if (this.starts.size >= 4 || this.sessions.size >= 8) throw new Error('BACKPRESSURE')
    const task = (async () => {
      await this.authorizeOrigin(p.origin, a)
      if (!a.current()) throw new Error('SIMULATOR_AUTHORITY_CHANGED')
      if (!await this.backend.available()) throw new Error('SIMULATOR_AXE_REQUIRED')
      const device = (await this.backend.list(a.current)).find(d => d.udid === p.udid)
      if (!device) throw new Error('SIMULATOR_NOT_FOUND')
      // One phone owns a simulator's input at a time. Never silently steal another viewer's device.
      if (deviceLeases.has(p.udid)) throw new Error('SIMULATOR_BUSY')
      const reservation = {}; deviceLeases.set(p.udid, reservation)
      let stream: SimulatorStream
      try {
        if (!active()) throw new Error('SIMULATOR_AUTHORITY_CHANGED')
        if (device.state !== 'Booted') await this.backend.boot(p.udid, active)
        if (!active()) throw new Error('SIMULATOR_AUTHORITY_CHANGED')
        stream = await this.backend.stream(p.udid, active)
        if (!active()) { await stream.stop(); throw new Error('SIMULATOR_AUTHORITY_CHANGED') }
      } catch (error) {
        if (deviceLeases.get(p.udid) === reservation) deviceLeases.delete(p.udid)
        throw error
      }
      const session = { sessionId: randomUUID(), udid: p.udid, name: device.name, inputAvailable: true }
      this.sessions.set(session.sessionId, { owner: key, startId: start, session,
        expiresAt: Date.now() + SIMULATOR_LIMITS.idleMs, current: active, stream, reservation, sequence: 0, inputBusy: false })
      return session
    })()
    this.starts.set(start, task)
    try { return await task } finally { this.starts.delete(start) }
  }
  async sweep() {
    for (const [id, run] of this.sessions) if (!run.current() || run.expiresAt <= Date.now()) {
      this.sessions.delete(id); await this.stop(run)
    }
  }
  async stopAll() {
    this.generation++
    const runs = [...this.sessions.values()]; this.sessions.clear()
    await Promise.all([...runs.map(run => this.stop(run)), this.backend.stopAll?.()])
  }
  private async stop(run: Running) {
    await run.stream.stop()
    if (deviceLeases.get(run.session.udid) === run.reservation) deviceLeases.delete(run.session.udid)
  }
}
