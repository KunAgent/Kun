import { createHash, randomUUID } from 'node:crypto'
import { DESKTOP_CAPABILITY, DESKTOP_METHODS, DESKTOP_LIMITS, validateDesktopParams, validateDesktopDataMessage, validateDesktopCandidateBatch,
  type DesktopSession, type DesktopSessionResult, type DesktopMethod, type DesktopEvent, type DesktopDataMessage, type DesktopChannel, type DesktopMediaHealthSample } from '@kun/remote-protocol'
import type { DesktopAccessStatus, DesktopConfiguration, DesktopDisplay, CaptureEvent } from '../../shared/remote-desktop'
import type { DesktopCapturePort } from './capture-host'
import { DesktopInputArbiter } from './input-arbiter'
import type { DesktopIndicatorPort } from './indicator'

export type DesktopAuthority = { accountId: string; deviceId: string; authorizationId: string; scopes: readonly string[]; current(): boolean; validForMs?(): number; emit(event: DesktopEvent): void }
export type DesktopHostDisplay = { primary?: boolean; id: number; fingerprint: string; label: string; pixelWidth: number; pixelHeight: number; rotation: number }
export type DesktopInputPort = { start(displayId: number, pid: number, birth: string): Promise<void>; ready?(): Promise<void>; setupLease?(ms: number): Promise<void>; lease(ms: number): Promise<void>; input(value: Record<string, unknown>): Promise<void>; release(): Promise<void>; stop(): Promise<void> }
export type DesktopEngineDependencies = {
  supported(): boolean
  permissions(): Promise<{ screenRecording: string; accessibility: string }>
  displays(): DesktopHostDisplay[]
  capture(id: number, receive: (event: CaptureEvent) => void): DesktopCapturePort & { open(): Promise<void> }
  input(lost: () => void): DesktopInputPort
  ice(authority: DesktopAuthority): Promise<unknown[]>
  authorizeOrigin(authority: DesktopAuthority, origin: { kind: 'code' | 'agent'; id: string }): Promise<void>
  now(): number
  id(): string
  arbiter: DesktopInputArbiter
  indicator?: DesktopIndicatorPort
}
type Run = {
  info: DesktopSession; authority: DesktopAuthority; displayId: number; fingerprint: string; hash: string
  capture?: DesktopCapturePort; input?: DesktopInputPort; offer?: { type: 'offer'; sdp: string }; promise?: Promise<DesktopSessionResult>
  state: 'negotiating' | 'viewing' | 'controlling' | 'reconnecting'; closing: boolean; closePromise?: Promise<DesktopSessionResult>
  deadline: number; challenges: Map<string, number>; fresh?: string; seq: Map<string, number>; outgoing: number; controlEpoch: number
  candidates: number; candidateBytes: number; dataCount: number; dataWindow: number; inputQueue: Promise<void>; inputBytes: number
  answered: boolean; outgoingIce: DesktopEvent[]; hostCandidates: number; hostCandidateBytes: number
  lastProbeAt: number; quality: string; reconnects: Map<string, { epoch: number; task: Promise<DesktopSessionResult> }>; reconnectOperation?: Promise<DesktopSessionResult>
  acceptedChallenges: Map<string, number>
  cleanupRetryAt: number
  controlOperation: Promise<void>
  captureGeneration: number; lastAckAt: number
  inputGeneration: number
  mediaHealth?: DesktopMediaHealthSample; mediaHealthAt: number
}
type Ended = Extract<DesktopSessionResult, { state: 'ended' }>
/** Volatile sessions. No OS or Worker dependencies; all native work stays behind explicit ports. */
export class RemoteDesktopService {
  private enabled = false
  private allowed = new Set<string>()
  private tokens = new Map<number, string>()
  private active?: Run
  private tombstones = new Map<string, { expires: number; value: Ended; hash?: string }>()
  private timer?: ReturnType<typeof setInterval>
  private lastFailure?: string
  private failureRevision = 0
  private configurationRevision = 0
  constructor(private readonly deps: DesktopEngineDependencies) {}
  private sourceList() {
    return this.deps.displays().slice(0, 8).map(display => {
      const token = this.tokens.get(display.id) ?? this.deps.id(); this.tokens.set(display.id, token)
      const revision = createHash('sha256').update(display.fingerprint).digest('hex')
      return { ...display, token, revision }
    })
  }
  async status(): Promise<DesktopAccessStatus> {
    const supported = this.deps.supported(), permissions = await this.deps.permissions()
    return { supported, enabled: this.enabled, ready: supported && this.enabled && this.allowed.size > 0 && permissions.screenRecording === 'granted',
      screenRecordingReady: permissions.screenRecording === 'granted', inputReady: permissions.accessibility === 'granted',
      ...(this.lastFailure ? { lastFailure: this.lastFailure } : {}),
      ...(!supported ? { reason: 'DESKTOP_UNSUPPORTED' } : permissions.screenRecording !== 'granted' ? { reason: 'SCREEN_PERMISSION_REQUIRED' } : {}),
      displays: this.sourceList().map(display => ({ token: display.token, revision: display.revision, label: display.label, pixelWidth: display.pixelWidth,
        pixelHeight: display.pixelHeight, rotation: display.rotation, allowed: this.allowed.has(display.token) })),
      ...(this.active ? { active: { sessionId: this.active.info.sessionId, peer: this.active.authority.deviceId, mode: this.active.info.mode } } : {}) }
  }
  async configure(value: DesktopConfiguration, current: () => boolean = () => true) {
    if (!value || typeof value.enabled !== 'boolean' || !Array.isArray(value.displayTokens) || value.displayTokens.length > 8 ||
      Object.keys(value).some(key => !['enabled', 'displayTokens'].includes(key))) throw Error('INVALID_REQUEST')
    const displays = this.sourceList(), known = new Set(displays.map(display => display.token))
    if (value.displayTokens.some(token => typeof token !== 'string' || !known.has(token)) || new Set(value.displayTokens).size !== value.displayTokens.length) throw Error('INVALID_REQUEST')
    if (value.enabled && (!this.deps.supported() || !value.displayTokens.length)) throw Error('DESKTOP_UNSUPPORTED')
    const revision = ++this.configurationRevision
    // Revoke admission before awaiting native cleanup. A delayed start may not overwrite a newer stop.
    this.enabled = false; this.allowed.clear()
    await this.stopAll('configuration_changed')
    if (revision !== this.configurationRevision || !current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    ++this.failureRevision; this.lastFailure = undefined
    this.allowed = new Set(value.displayTokens); this.enabled = value.enabled
    return this.status()
  }
  async configureRemoteAccess(enabled: boolean, current: () => boolean = () => true) {
    const displays = enabled && this.deps.supported() ? this.sourceList() : []
    const primary = displays.find(display => display.primary)
    const display = primary ? primary.rotation === 0 ? primary : undefined : displays.find(display => display.rotation === 0)
    return this.configure({ enabled: enabled && Boolean(display), displayTokens: enabled && display ? [display.token] : [] }, current)
  }
  descriptors(scopes: readonly string[]) {
    const supported = this.deps.supported(), authorized = scopes.includes('desktop.view')
    return DESKTOP_METHODS.map(operation => ({ operation, schemaVersion: 1, resourceKind: 'desktop', supported, enabled: this.enabled,
      authorized: authorized && (operation !== 'desktop.control.acquire' || scopes.includes('desktop.control')), online: true, allowedActions: ['read', 'control'] }))
  }
  capabilities() { return this.deps.supported() && this.enabled ? [DESKTOP_CAPABILITY] : [] }
  private key(authority: DesktopAuthority, id: string) { return `${authority.accountId}:${authority.deviceId}:${id}` }
  private prune() { for (const [key, value] of this.tombstones) if (value.expires < this.deps.now()) this.tombstones.delete(key) }
  private remember(run: Run | undefined, authority: DesktopAuthority, startId: string, reason: string): Ended {
    const value: Ended = { state: 'ended', startId, ...(run ? { sessionId: run.info.sessionId } : {}), reason, confirmed: true }
    const saved = { expires: this.deps.now() + 120000, value, ...(run ? { hash: run.hash } : {}) }
    this.tombstones.set(this.key(authority, startId), saved)
    if (run) this.tombstones.set(this.key(authority, run.info.sessionId), saved)
    return value
  }
  private ensure(run: Run) {
    if (this.active !== run || run.closing || !run.authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    if (this.deps.now() >= run.deadline) throw Error('DESKTOP_SESSION_EXPIRED')
    if (!this.sourceList().some(display => display.id === run.displayId && display.fingerprint === run.fingerprint && this.allowed.has(display.token))) throw Error('DESKTOP_SOURCE_CHANGED')
  }
  private deadline(authority: DesktopAuthority, ms: number) { return this.deps.now() + Math.max(0, Math.min(ms, authority.validForMs?.() ?? ms)) }
  async invoke(method: string, raw: unknown, authority: DesktopAuthority): Promise<unknown> {
    if (['desktop.session.stop', 'desktop.session.cancel'].includes(method) && authority.current()) ++this.failureRevision
    const report = ['desktop.session.start', 'desktop.session.reconnect', 'desktop.control.acquire'].includes(method) && authority.current()
    const revision = report ? ++this.failureRevision : this.failureRevision
    if (report) this.lastFailure = undefined
    try { return await this.dispatch(method, raw, authority) }
    catch (error) {
      if (report && revision === this.failureRevision && authority.current() && !(error instanceof Error && error.message === 'DESKTOP_AUTHORITY_CHANGED')) {
        const code = error instanceof Error ? error.message : ''
        this.lastFailure = ['SCREEN_PERMISSION_REQUIRED', 'INPUT_PERMISSION_REQUIRED', 'DESKTOP_VIEW_REQUIRED',
          'DESKTOP_ICE_UNAVAILABLE', 'DESKTOP_CLEANUP_UNCONFIRMED'].includes(code) ? code : 'DESKTOP_CONNECTION_FAILED'
      }
      throw error
    }
  }
  private async dispatch(method: string, raw: unknown, authority: DesktopAuthority): Promise<unknown> {
    if (!(DESKTOP_METHODS as readonly string[]).includes(method)) throw Error('UNSUPPORTED_OPERATION')
    if (!authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED')
    const params = validateDesktopParams(method as DesktopMethod, raw) as any
    this.prune()
    const terminal = this.tombstones.get(this.key(authority, params.startId ?? params.sessionId ?? ''))
    if (method === 'desktop.session.get' && terminal) return terminal.value
    if (method === 'desktop.session.cancel') {
      const run = this.active
      if (run && run.info.startId === params.startId && this.owns(run, authority)) return this.end(run, params.reason)
      if (terminal) return terminal.value
      if (this.tombstones.size >= 128) throw Error('BACKPRESSURE')
      return this.remember(undefined, authority, params.startId, params.reason)
    }
    if (method === 'desktop.session.stop' && terminal) return terminal.value
    if (method === 'desktop.session.start') return this.start(params, authority, terminal)
    if (method === 'desktop.displays.list') {
      this.requireView(authority)
      return { displays: this.sourceList().filter(display => this.allowed.has(display.token)).map(display => ({ token: display.token, revision: display.revision,
        label: display.label, pixelWidth: display.pixelWidth, pixelHeight: display.pixelHeight, rotation: display.rotation })) }
    }
    const run = this.active
    if (!run || !this.owns(run, authority) || params.sessionId && params.sessionId !== run.info.sessionId || params.startId && params.startId !== run.info.startId) {
      if (method === 'desktop.session.get' || method === 'desktop.session.stop') return { state: 'missing' }
      throw Error('DESKTOP_SESSION_EXPIRED')
    }
    if (method === 'desktop.session.stop') return this.end(run, params.reason)
    if (method === 'desktop.control.release') {
      if (params.epoch !== run.info.epoch) throw Error('DESKTOP_STALE_EPOCH')
      await this.release(run); return { mode: 'view', controlEpoch: run.controlEpoch }
    }
    this.ensure(run); this.requireView(authority)
    if (method === 'desktop.session.get') return run.promise ?? this.result(run)
    if (method === 'desktop.session.reconnect' && run.reconnects.has(params.attemptId)) {
      const previous = run.reconnects.get(params.attemptId)!
      if (previous.epoch !== params.epoch) throw Error('INVALID_REQUEST')
      return previous.task
    }
    if (params.epoch !== run.info.epoch) throw Error('DESKTOP_STALE_EPOCH')
    const captureGeneration = run.captureGeneration
    const ensureMedia = () => {
      this.ensure(run)
      if (params.epoch !== run.info.epoch || captureGeneration !== run.captureGeneration) throw Error('DESKTOP_STALE_EPOCH')
    }
    if (method === 'desktop.session.answer') {
      await run.capture!.answer(params.answer); ensureMedia(); run.answered = true
      for (const event of run.outgoingIce.splice(0)) run.authority.emit(event)
      return { accepted: true }
    }
    if (method === 'desktop.signal.ice') {
      const bytes = Buffer.byteLength(JSON.stringify(params.candidates)); run.candidates += params.candidates.length; run.candidateBytes += bytes
      if (run.candidates > DESKTOP_LIMITS.candidatesPerEpoch || run.candidateBytes > DESKTOP_LIMITS.candidatesEpochBytes) { await this.end(run, 'signal_limit'); throw Error('BACKPRESSURE') }
      await run.capture!.ice(params.candidates); ensureMedia(); return { accepted: true }
    }
    if (method === 'desktop.control.acquire') return this.control(run, async () => {
      this.ensure(run)
      if (params.epoch !== run.info.epoch) throw Error('DESKTOP_STALE_EPOCH')
      if (!['viewing', 'controlling'].includes(run.state) || !authority.scopes.includes('desktop.control')) throw Error('DESKTOP_CONTROL_REQUIRED')
      if (!this.mediaHealthy(run)) throw Error('DESKTOP_CONTROL_REQUIRED')
      if (run.state === 'controlling') return { mode: 'control', controlEpoch: run.controlEpoch }
      if ((await this.deps.permissions()).accessibility !== 'granted') throw Error('INPUT_PERMISSION_REQUIRED')
      await run.input!.ready?.()
      this.ensure(run)
      if (params.epoch !== run.info.epoch || !['viewing', 'controlling'].includes(run.state)) throw Error('DESKTOP_STALE_EPOCH')
      if (!this.mediaHealthy(run)) throw Error('DESKTOP_CONTROL_REQUIRED')
      this.deps.arbiter.acquire(run.info.sessionId)
      run.controlEpoch++; run.info.mode = 'control'; run.state = 'controlling'; this.emitState(run)
      return { mode: 'control', controlEpoch: run.controlEpoch }
    })
    if (method === 'desktop.session.quality') { await run.capture!.quality(params.quality); ensureMedia(); run.quality = params.quality; return { quality: params.quality } }
    if (method === 'desktop.session.reconnect') {
      if (run.reconnectOperation || !['viewing', 'controlling'].includes(run.state)) throw Error('DESKTOP_BUSY')
      if (run.reconnects.size >= 4) run.reconnects.delete(run.reconnects.keys().next().value!)
      const attempt = this.reconnect(run); run.reconnectOperation = attempt
      run.reconnects.set(params.attemptId, { epoch: params.epoch, task: attempt })
      const clear = () => { if (run.reconnectOperation === attempt) run.reconnectOperation = undefined }
      void attempt.then(clear, clear)
      return attempt
    }
    throw Error('DESKTOP_UNSUPPORTED')
  }
  private owns(run: Run, authority: DesktopAuthority) { return run.authority.accountId === authority.accountId && run.authority.deviceId === authority.deviceId }
  private requireView(authority: DesktopAuthority) {
    if (!this.deps.supported()) throw Error('DESKTOP_UNSUPPORTED')
    if (!this.enabled) throw Error('DESKTOP_DISABLED')
    if (!authority.scopes.includes('desktop.view')) throw Error('DESKTOP_VIEW_REQUIRED')
  }
  private result(run: Run): DesktopSessionResult { return { state: run.state, session: { ...run.info }, ...(run.offer ? { offer: run.offer } : {}) } }
  private async start(params: any, authority: DesktopAuthority, terminal?: { value: Ended; hash?: string }) {
    this.requireView(authority)
    const hash = createHash('sha256').update(JSON.stringify(params)).digest('hex')
    if (terminal) { if (terminal.hash && terminal.hash !== hash) throw Error('INVALID_REQUEST'); return terminal.value }
    if (this.active) {
      if (this.owns(this.active, authority) && this.active.info.startId === params.startId) {
        if (this.active.hash !== hash) throw Error('INVALID_REQUEST')
        return this.active.promise ?? this.result(this.active)
      }
      throw Error('DESKTOP_BUSY')
    }
    if (this.tombstones.size >= 124) throw Error('BACKPRESSURE')
    const display = this.sourceList().find(item => item.token === params.displayToken && item.revision === params.displayRevision && this.allowed.has(item.token))
    if (!display || display.rotation !== 0) throw Error('DESKTOP_SOURCE_CHANGED')
    const info: DesktopSession = { schemaVersion: 1, startId: params.startId, sessionId: this.deps.id(), epoch: 1, authorizationId: authority.authorizationId,
      origin: params.origin, display: { token: display.token, revision: display.revision, label: display.label, pixelWidth: display.pixelWidth, pixelHeight: display.pixelHeight, rotation: display.rotation },
      mode: 'view', controlAllowed: authority.scopes.includes('desktop.control'), heartbeatMs: 2000, setupTimeoutMs: 15000, expiresInMs: 6000 }
    const run: Run = { info, authority, displayId: display.id, fingerprint: display.fingerprint, hash, state: 'negotiating', closing: false,
      deadline: this.deadline(authority, 15000), challenges: new Map(), seq: new Map(), outgoing: 0, controlEpoch: 1, candidates: 0, candidateBytes: 0,
      dataCount: 0, dataWindow: this.deps.now(), inputQueue: Promise.resolve(), inputBytes: 0, inputGeneration: 0, mediaHealthAt: 0,
      answered: false, outgoingIce: [], hostCandidates: 0, hostCandidateBytes: 0, lastProbeAt: 0, quality: params.quality, reconnects: new Map(), acceptedChallenges: new Map(), cleanupRetryAt: 0, controlOperation: Promise.resolve(), captureGeneration: 0, lastAckAt: 0 }
    this.active = run
    this.timer ??= setInterval(() => this.tick(), 250)
    run.promise = (async () => {
      try {
        await this.deps.authorizeOrigin(authority, params.origin); this.ensure(run)
        if ((await this.deps.permissions()).screenRecording !== 'granted') throw Error('SCREEN_PERMISSION_REQUIRED')
        this.ensure(run)
        const ice = await this.deps.ice(authority); this.ensure(run)
        const attempt = ++run.captureGeneration
        const capture = this.deps.capture(display.id, event => { if (run.captureGeneration === attempt) this.captureEvent(run, event) }); run.capture = capture
        await capture.open(); this.ensure(run)
        const identity = await capture.identity(); this.ensure(run)
        run.input = this.deps.input(() => { if (run.captureGeneration === attempt) void this.end(run, 'input_helper_lost').catch(() => {}) })
        await run.input.start(display.id, identity.pid, identity.birth); this.ensure(run)
        await run.input.setupLease?.(run.deadline - this.deps.now()); this.ensure(run)
        run.offer = await capture.start(ice, params.quality); this.ensure(run)
        return this.result(run)
      } catch (error) {
        await this.end(run, 'start_failed')
        throw error
      }
    })()
    const pending = run.promise
    void pending.then(() => { if (run.promise === pending) run.promise = undefined }, () => { if (run.promise === pending) run.promise = undefined })
    return pending
  }
  private emitState(run: Run) {
    this.deps.indicator?.update({ peer: run.authority.deviceId, display: run.info.display.label ?? 'Display', mode: run.info.mode })
    run.authority.emit({ event: 'desktop.session.state', sessionId: run.info.sessionId, epoch: run.info.epoch, state: run.state, mode: run.info.mode, controlEpoch: run.controlEpoch })
  }
  private async reconnect(run: Run): Promise<DesktopSessionResult> {
    const ice = await this.deps.ice(run.authority); this.ensure(run)
    const healthyRefresh = ['viewing', 'controlling'].includes(run.state) && this.deps.now() - run.lastAckAt <= 3000
    run.captureGeneration++; run.state = 'reconnecting'; run.offer = undefined
    try {
      await this.release(run)
      await run.capture!.stop(); await run.input!.stop(); this.ensure(run)
      if (healthyRefresh) run.deadline = this.deadline(run.authority, 15000)
      else run.deadline = Math.min(run.deadline, this.deadline(run.authority, 5000))
      run.info.epoch++; run.answered = false; run.outgoingIce = []; run.hostCandidates = 0; run.hostCandidateBytes = 0
      run.candidates = 0; run.candidateBytes = 0; run.fresh = undefined; run.challenges.clear(); run.acceptedChallenges.clear(); run.seq.clear(); run.lastProbeAt = 0
      run.mediaHealth = undefined; run.mediaHealthAt = 0
      const attempt = run.captureGeneration
      const capture = this.deps.capture(run.displayId, value => { if (run.captureGeneration === attempt) this.captureEvent(run, value) }); run.capture = capture
      await capture.open(); this.ensure(run)
      const identity = await capture.identity(); this.ensure(run)
      run.input = this.deps.input(() => { if (run.captureGeneration === attempt) void this.end(run, 'input_helper_lost').catch(() => {}) })
      await run.input.start(run.displayId, identity.pid, identity.birth); this.ensure(run)
      await run.input.setupLease?.(run.deadline - this.deps.now()); this.ensure(run)
      if (!healthyRefresh) await run.input.lease(run.deadline - this.deps.now())
      run.offer = await capture.start(ice, run.quality); this.ensure(run)
      run.state = 'negotiating'
      return this.result(run)
    } catch (error) { await this.end(run, 'reconnect_failed'); throw error }
  }
  private send(run: Run, type: string, fields: Record<string, unknown> = {}) {
    return run.capture!.send('kun.desktop.control.v1', { v: 1, sessionId: run.info.sessionId, epoch: run.info.epoch, type, seq: ++run.outgoing, ...fields }, run.deadline - this.deps.now())
  }
  private captureEvent(run: Run, event: CaptureEvent) {
    if (this.active !== run || run.closing) return
    const attempt = run.captureGeneration
    try {
      this.ensure(run)
      if (event.event === 'closed') { void this.end(run, 'media_closed').catch(() => {}); return }
      if (event.event === 'health') {
        const message = validateDesktopDataMessage({ ...(event.value as object), v: 1, sessionId: run.info.sessionId, epoch: run.info.epoch,
          type: 'media.health', seq: run.outgoing + 1 }, 'kun.desktop.control.v1', 'host')
        if (message.type !== 'media.health' || run.mediaHealth && message.sampleId <= run.mediaHealth.sampleId) return
        const { sampleId, trackState, muted, sourceFrames, framesEncoded, framesSent } = message
        run.mediaHealth = { sampleId, trackState, muted, sourceFrames, framesEncoded, framesSent }; run.mediaHealthAt = this.deps.now()
        if (!this.mediaHealthy(run) && run.state === 'controlling') void this.release(run).catch(() => {})
        if (['viewing', 'controlling'].includes(run.state)) void this.send(run, 'media.health', { ...run.mediaHealth }).catch(() => this.failAttempt(run, attempt, 'media_closed'))
        return
      }
      if (event.event === 'ice') {
        const value = event.value as { candidates: unknown[]; complete: boolean }, candidates = validateDesktopCandidateBatch(value.candidates)
        run.hostCandidates += candidates.length; run.hostCandidateBytes += Buffer.byteLength(JSON.stringify(candidates))
        if (run.hostCandidates > DESKTOP_LIMITS.candidatesPerEpoch || run.hostCandidateBytes > DESKTOP_LIMITS.candidatesEpochBytes) throw Error('BACKPRESSURE')
        const outgoing: DesktopEvent = { event: 'desktop.signal.ice', sessionId: run.info.sessionId, epoch: run.info.epoch, candidates, complete: value.complete === true }
        if (run.answered) run.authority.emit(outgoing); else run.outgoingIce.push(outgoing)
        return
      }
      if (event.event !== 'data') return
      const value = event.value as { raw: string; label: DesktopChannel }
      const message = validateDesktopDataMessage(JSON.parse(value.raw), value.label, 'controller')
      if (message.sessionId !== run.info.sessionId || message.epoch !== run.info.epoch) return
      const previous = run.seq.get(value.label) ?? -1
      if (message.seq <= previous) return
      run.seq.set(value.label, message.seq)
      if (message.type === 'session.stop') { void this.end(run, message.reason).catch(() => {}); return }
      if (message.type === 'hello') {
        if (run.state !== 'negotiating') return
        run.state = 'viewing'; run.lastAckAt = this.deps.now(); run.deadline = this.deadline(run.authority, 6000)
        this.deps.indicator?.show({ peer: run.authority.deviceId, display: run.info.display.label ?? 'Display', mode: run.info.mode }, () => { void this.end(run, 'host_user_ended').catch(() => {}) })
        void run.input!.lease(run.deadline - this.deps.now()).catch(() => this.failAttempt(run, attempt, 'guard_lost'))
        void this.send(run, 'ready', { mode: 'view', controlEpoch: run.controlEpoch }).catch(() => this.failAttempt(run, attempt, 'media_closed')); this.emitState(run); return
      }
      if (message.type === 'probe.ack') {
        const issued = run.challenges.get(message.challenge)
        if (issued === undefined || this.deps.now() - issued > 3000) return
        run.challenges.delete(message.challenge); run.fresh = message.challenge; run.lastAckAt = this.deps.now(); run.deadline = this.deadline(run.authority, 6000)
        run.acceptedChallenges.set(message.challenge, this.deps.now() + 3000)
        void run.input!.lease(run.deadline - this.deps.now()).catch(() => this.failAttempt(run, attempt, 'guard_lost')); return
      }
      if (message.type === 'input.releaseAll') {
        // This urgent channel message only lifts keys. WSS control.release owns
        // the mode transition, so a delayed releaseAll cannot revoke reacquired control.
        run.inputGeneration++
        void this.control(run, async () => {
          if (run.captureGeneration === attempt && !run.closing) await run.input?.release()
        }).catch(() => this.failAttempt(run, attempt, 'input_cleanup_failed')); return
      }
      this.input(run, message)
    } catch { void this.end(run, 'invalid_media_message').catch(() => {}) }
  }
  private input(run: Run, message: DesktopDataMessage) {
    if (!('displayRevision' in message) || run.state !== 'controlling' || !this.deps.arbiter.owns(run.info.sessionId) || message.controlEpoch !== run.controlEpoch ||
      message.displayRevision !== run.info.display.revision || !run.authority.scopes.includes('desktop.control')) return
    if (!this.mediaHealthy(run)) { void this.release(run).catch(() => {}); return }
    if (!this.inputChallengeCurrent(run, message.challenge)) { void this.release(run).catch(() => {}); return }
    if (this.deps.now() - run.dataWindow >= 1000) { run.dataWindow = this.deps.now(); run.dataCount = 0 }
    const bytes = Buffer.byteLength(JSON.stringify(message))
    const attempt = run.captureGeneration, inputGeneration = run.inputGeneration
    if (++run.dataCount > 240 || run.inputBytes + bytes > 65536) { void this.release(run).catch(() => {}); return }
    run.inputBytes += bytes
    run.inputQueue = run.inputQueue.catch(() => {}).then(async () => {
      this.ensure(run)
      if (run.state !== 'controlling' || inputGeneration !== run.inputGeneration || !this.deps.arbiter.owns(run.info.sessionId) || message.controlEpoch !== run.controlEpoch) return
      if (!this.mediaHealthy(run)) { await this.release(run); return }
      if (!this.inputChallengeCurrent(run, message.challenge)) { await this.release(run); return }
      await run.input!.input(message as unknown as Record<string, unknown>)
    }).catch(() => {
      if (run.captureGeneration === attempt && 'controlEpoch' in message && run.controlEpoch === message.controlEpoch) return this.release(run)
    }).finally(() => { run.inputBytes -= bytes }).catch(() => {})
  }
  private inputChallengeCurrent(run: Run, challenge: string) {
    // SCTP streams are independent: a key event can beat its control-channel probe ACK.
    // Echoing a recent challenge can validate input, but only a probe ACK renews the lease.
    return (run.acceptedChallenges.get(challenge) ?? 0) > this.deps.now() ||
      run.challenges.has(challenge) && this.deps.now() - run.challenges.get(challenge)! <= 3000
  }
  private mediaHealthy(run: Run) {
    const health = run.mediaHealth
    return !!health && this.deps.now() - run.mediaHealthAt <= DESKTOP_LIMITS.mediaHealthTimeoutMs && health.trackState === 'live' && !health.muted &&
      health.framesEncoded !== null && health.framesEncoded > 0 && health.framesSent !== null && health.framesSent > 0
  }
  private failAttempt(run: Run, attempt: number, reason: string) {
    if (this.active === run && !run.closing && run.captureGeneration === attempt) void this.end(run, reason).catch(() => {})
  }
  private control<T>(run: Run, operation: () => Promise<T>): Promise<T> {
    const task = run.controlOperation.catch(() => {}).then(operation)
    run.controlOperation = task.then(() => {}, () => {})
    return task
  }
  private release(run: Run) { return this.control(run, () => this.releaseNow(run)) }
  private async releaseNow(run: Run) {
    run.inputGeneration++; run.info.mode = 'view'; if (run.state === 'controlling') run.state = 'viewing'; run.controlEpoch++
    try { await run.input?.release() }
    catch (error) { if (!run.closing) void this.end(run, 'input_cleanup_failed').catch(() => {}); throw error }
    this.deps.arbiter.release(run.info.sessionId)
    if (!run.closing) this.emitState(run)
  }
  private tick() {
    const run = this.active
    if (!run) return
    if (run.closing) {
      if (!run.closePromise && this.deps.now() >= run.cleanupRetryAt) void this.end(run, 'cleanup_retry').catch(() => {})
      return
    }
    try {
      this.ensure(run)
      if (run.state === 'negotiating' || run.state === 'reconnecting') return
      if (run.state === 'controlling' && !this.mediaHealthy(run)) void this.release(run).catch(() => {})
      for (const [challenge, time] of run.challenges) if (this.deps.now() - time > 3000) run.challenges.delete(challenge)
      for (const [challenge, time] of run.acceptedChallenges) if (this.deps.now() >= time) run.acceptedChallenges.delete(challenge)
      if (this.deps.now() - run.lastProbeAt < 2000) return
      run.lastProbeAt = this.deps.now()
      const challenge = this.deps.id(); run.challenges.set(challenge, this.deps.now())
      const attempt = run.captureGeneration
      void this.send(run, 'probe', { challenge }).catch(() => this.failAttempt(run, attempt, 'media_closed'))
    } catch { void this.end(run, 'lease_or_authority_expired').catch(() => {}) }
  }
  private end(run: Run, reason: string): Promise<DesktopSessionResult> {
    if (run.closePromise) return run.closePromise
    run.closing = true; run.controlEpoch++
    run.closePromise = (async () => {
      const results = await Promise.allSettled([run.capture?.stop(), run.input?.release()])
      await run.input?.stop()
      if (results[0].status === 'rejected') throw Error('DESKTOP_CLEANUP_UNCONFIRMED')
      this.deps.arbiter.release(run.info.sessionId)
      this.deps.indicator?.hide()
      const value = this.remember(run, run.authority, run.info.startId, reason)
      if (this.active === run) this.active = undefined
      if (!this.active && this.timer) { clearInterval(this.timer); this.timer = undefined }
      run.authority.emit({ event: 'desktop.session.ended', sessionId: run.info.sessionId, epoch: run.info.epoch, startId: run.info.startId, reason, confirmed: true })
      return value
    })().catch(error => {
      run.closePromise = undefined
      run.cleanupRetryAt = this.deps.now() + 1000
      throw error instanceof Error ? error : Error('DESKTOP_CLEANUP_UNCONFIRMED')
    })
    return run.closePromise
  }
  async stopAll(reason = 'host_stopped') { if (this.active) await this.end(this.active, reason) }
  authorityChanged(peer: string) { if (this.active?.authority.deviceId === peer) void this.end(this.active, 'authorization_changed').catch(() => {}) }
}
