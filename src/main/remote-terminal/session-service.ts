import {
  TERMINAL_CAPABILITY, TERMINAL_LIMITS, TERMINAL_METHODS,
  validateOperationParams, validateTerminalResult, isAbsoluteTerminalCwd
} from '@kun/remote-protocol'
import type { TerminalEvent, TerminalMethod, TerminalSession, TerminalSnapshot } from '@kun/remote-protocol'
import type { MobileLinkScope } from '../../shared/mobile-link-scopes'
import { createReplayScreens, safeReplay, utf8Length, type TerminalScreen, type TerminalScreenFactory } from './screen'

/**
 * Phone-owned terminals on top of the existing remote-control authorization.
 *
 * Every operation is fenced by the same account, controller, authorization id
 * and a live lease. A dropped socket only detaches (input and output blocked,
 * PTY kept for the retention window); revocation, authorization change or lease
 * expiry ends the session. The phone never supplies a directory.
 */
export type TerminalOrigin = { kind: 'code' | 'agent'; id: string }

export type TerminalAuthority = {
  accountId: string
  deviceId: string
  authorizationId: string
  scopes: MobileLinkScope[]
  current(): boolean
  validForMs(): number
  emit(event: TerminalEvent): void
}

export type TerminalPty = {
  write(data: string): void
  resize(cols: number, rows: number): void
  pause?(): void
  resume?(): void
  /** Resolves only once the process tree is gone; rejects when that is unconfirmed. */
  kill(): Promise<void>
}

export class TerminalSpawnError extends Error {
  constructor(readonly pty: TerminalPty, cause: unknown) {
    super('TERMINAL_CLOSE_UNCONFIRMED', { cause })
  }
}

export type TerminalSpawnSpec = { origin: TerminalOrigin; cwd: string; cols: number; rows: number }
export type TerminalReceiver = { data(data: string): void; exit(exitCode: number, signal?: string): void }
export type TerminalHost = {
  spawn(spec: TerminalSpawnSpec, receive: TerminalReceiver, cancelled: () => boolean): Promise<TerminalPty>
}
export type TerminalActivity = { show(peer: string, end: () => void): void; update(peer: string): void; hide(): void }

export type TerminalServiceDependencies = {
  resolveOrigin(authority: TerminalAuthority, origin: TerminalOrigin): Promise<{ cwd: string }>
  spawn: TerminalHost['spawn']
  screens?: TerminalScreenFactory
  supported?: () => boolean
  now?: () => number
  id?: () => string
  activity?: TerminalActivity
  log?: (message: string, detail?: unknown) => void
}

type CloseResult = { state: 'closed'; sessionId: string; reason: string; confirmed: true } | { state: 'missing' }
type OpenRequest = { origin: TerminalOrigin; cols: number; rows: number }
type Run = {
  key: string
  authority: TerminalAuthority
  info: TerminalSession
  /** The original `terminal.open` request, so a later resize keeps idempotency. */
  request: OpenRequest
  session?: TerminalPty
  /** The real start work; `starting` is its bounded view. */
  work?: Promise<void>
  starting: Promise<void>
  startSettled: boolean
  stopConfirmed: boolean
  treeStopping?: Promise<void>
  parserPaused?: boolean
  cancelled: boolean
  pendingClose?: string
  screen: TerminalScreen
  outputSequence: number
  queue: Array<{ sequence: number; bytes: number; data: string }>
  queued: number
  flushing: boolean
  suspended: boolean
  detached: boolean
  inputSequence: number
  closed: boolean
  closePromise?: Promise<CloseResult>
  exitAt?: number
  detachedAt?: number
  pendingExit?: { exitCode: number; signal?: string }
}

const CONTROL = 'desktop.control'
const VIEW = 'desktop.view'
const FLUSH_DELAY = 0
const CAP = TERMINAL_LIMITS.sequence

function isLow(code: number) { return code >= 0xdc00 && code <= 0xdfff }

/** Split on code points and on the UTF-8 budget so one frame is always valid. */
export function splitOutput(value: string, limit = TERMINAL_LIMITS.outputChunkBytes): string[] {
  const parts: string[] = []
  let start = 0
  let bytes = 0
  for (let index = 0; index < value.length;) {
    const code = value.codePointAt(index)!
    const width = code > 0xffff ? 2 : 1
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes + size > limit && index > start) {
      parts.push(value.slice(start, index))
      start = index
      bytes = 0
    }
    bytes += size
    index += width
  }
  if (start < value.length) parts.push(value.slice(start))
  return parts
}

function validCwd(value: unknown): string {
  if (!isAbsoluteTerminalCwd(value)) throw new Error('TERMINAL_ORIGIN_UNAVAILABLE')
  return value
}

export class RemoteTerminalService {
  private runs = new Map<string, Run>()
  private startIds = new Map<string, { sessionId: string; closed: boolean }>()
  private now: () => number
  private id: () => string
  private screens: TerminalScreenFactory
  private activityShown?: string

  constructor(private deps: TerminalServiceDependencies) {
    this.now = deps.now ?? (() => Date.now())
    this.id = deps.id ?? (() => crypto.randomUUID())
    this.screens = deps.screens ?? createReplayScreens()
  }

  private peer(authority: TerminalAuthority) { return authority.accountId + ':' + authority.deviceId }
  private key(authority: TerminalAuthority, sessionId: string) { return this.peer(authority) + ':' + sessionId }
  private startKey(authority: TerminalAuthority, startId: string) { return this.peer(authority) + ':' + startId }

  /** Lease and scopes, applied to every entry point. */
  private fence(authority: TerminalAuthority) {
    if (!authority.scopes.includes(VIEW) || !authority.scopes.includes(CONTROL)) throw new Error('TERMINAL_CONTROL_REQUIRED')
    if (!authority.current() || authority.validForMs() <= 0) throw new Error('TERMINAL_AUTHORITY_CHANGED')
  }
  /** A run is usable only inside the exact authorization that created it. */
  private own(run: Run, authority: TerminalAuthority) {
    if (run.authority.accountId !== authority.accountId || run.authority.deviceId !== authority.deviceId ||
      run.authority.authorizationId !== authority.authorizationId) throw new Error('TERMINAL_AUTHORIZATION_CHANGED')
    return run
  }
  private find(authority: TerminalAuthority, sessionId: string) {
    const run = this.runs.get(this.key(authority, sessionId))
    return run ? this.own(run, authority) : undefined
  }
  private runsFor(authority: TerminalAuthority) {
    return [...this.runs.values()].filter((run) => !run.closed && this.peer(run.authority) === this.peer(authority) &&
      run.authority.authorizationId === authority.authorizationId)
  }

  /** Params in, result out: both go through the protocol validators. */
  async invoke(method: string, raw: unknown, authority: TerminalAuthority): Promise<unknown> {
    this.fence(authority)
    const params = validateOperationParams(method as TerminalMethod, raw) as any
    let result: unknown
    switch (method) {
      case 'terminal.list': result = this.list(authority); break
      case 'terminal.open': result = await this.open(params, authority); break
      case 'terminal.attach': result = await this.attach(params.sessionId, authority); break
      case 'terminal.write': result = this.write(params, authority); break
      case 'terminal.resize': result = this.resize(params, authority); break
      case 'terminal.close': result = await this.close(params.sessionId, params.reason, authority); break
      default: throw new Error('UNSUPPORTED_OPERATION')
    }
    return validateTerminalResult(method as TerminalMethod, result)
  }

  /** Unresolved starts stay invisible until the desktop has a real cwd. */
  list(authority: TerminalAuthority) {
    return { sessions: this.runsFor(authority).filter((run) => run.info.cwd !== '').map((run) => run.info) }
  }

  supported() { return this.deps.supported ? this.deps.supported() : true }

  descriptors(scopes: readonly MobileLinkScope[]) {
    const supported = this.supported()
    const authorized = scopes.includes(VIEW) && scopes.includes(CONTROL)
    if (!supported || !authorized) return []
    return TERMINAL_METHODS.map((operation) => ({ operation, schemaVersion: 1, resourceKind: 'terminal',
      supported, enabled: true, authorized, online: true, allowedActions: ['control'] }))
  }

  capabilities(scopes: readonly MobileLinkScope[]) {
    return this.descriptors(scopes).length ? [TERMINAL_CAPABILITY] : []
  }

  /**
   * Captures the sequence boundary before the flush, so the returned snapshot
   * covers exactly those events and nothing newer is dropped.
   */
  private async snapshot(run: Run): Promise<TerminalSnapshot> {
    const boundary = run.outputSequence
    const session = { ...run.info }, inputSequence = run.inputSequence
    const text = await run.screen.capture()
    const snapshot = utf8Length(text) > TERMINAL_LIMITS.snapshotBytes ? safeReplay(text) : text
    this.dropThrough(run, boundary)
    return { state: session.state, session, snapshot, sequence: boundary,
      inputSequence, epoch: session.epoch }
  }

  async open(params: any, authority: TerminalAuthority) {
    if (!this.supported()) throw new Error('TERMINAL_UNSUPPORTED')
    const known = this.startIds.get(this.startKey(authority, params.startId))
    if (known?.closed) throw new Error('TERMINAL_START_RETIRED')
    if (known) {
      const run = this.runs.get(this.key(authority, known.sessionId))
      if (!run || run.closed) throw new Error('TERMINAL_START_RETIRED')
      this.own(run, authority)
      // A duplicate start waits for the first spawn and never reports an empty cwd.
      await run.starting
      if (run.closed) throw new Error('TERMINAL_START_RETIRED')
      if (!this.sameRequest(run, params)) throw new Error('INVALID_REQUEST')
      this.fence(authority)
      if (run.detached) return this.attach(run.info.sessionId, authority)
      run.authority = authority
      return this.snapshot(run)
    }
    if (this.runsFor(authority).length >= TERMINAL_LIMITS.sessionsPerPeer || this.runs.size >= TERMINAL_LIMITS.sessions) throw new Error('BACKPRESSURE')
    const cols = params.cols ?? TERMINAL_LIMITS.defaultCols
    const rows = params.rows ?? TERMINAL_LIMITS.defaultRows
    const sessionId = this.id()
    const run: Run = {
      key: this.key(authority, sessionId), authority, cancelled: false,
      info: { schemaVersion: 1, startId: params.startId, sessionId, epoch: 1, origin: { ...params.origin }, cwd: '', cols, rows, state: 'running' },
      request: { origin: { ...params.origin }, cols, rows },
      starting: Promise.resolve(), startSettled: false, stopConfirmed: false,
      screen: this.screens.create(cols, rows), outputSequence: 0, queue: [], queued: 0,
      flushing: false, suspended: false, detached: false, inputSequence: 0, closed: false
    }
    this.startIds.set(this.startKey(authority, params.startId), { sessionId, closed: false })
    this.runs.set(run.key, run)
    run.work = this.start(run)
    run.starting = this.bounded(run, run.work)
    try {
      await run.starting
      if (run.cancelled || run.closed) throw new Error('TERMINAL_START_CANCELLED')
      return await this.snapshot(run)
    } catch (error) {
      const cancelled = run.cancelled || run.closed
      run.cancelled = true
      run.closed = true
      await this.closeRun(run, 'start_failed').catch(() => {})
      if (error instanceof Error && error.message === 'TERMINAL_START_TIMEOUT') throw error
      if (cancelled) throw new Error('TERMINAL_START_CANCELLED')
      if (error instanceof Error && /^[A-Z_]+$/.test(error.message)) throw error
      throw new Error('TERMINAL_ORIGIN_UNAVAILABLE')
    }
  }

  private sameRequest(run: Run, params: any) {
    return run.request.origin.kind === params.origin.kind && run.request.origin.id === params.origin.id &&
      run.request.cols === (params.cols ?? TERMINAL_LIMITS.defaultCols) &&
      run.request.rows === (params.rows ?? TERMINAL_LIMITS.defaultRows)
  }

  /** A timeout marks the run cancelled so a late spawn is killed, never leaked. */
  private bounded(run: Run, work: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        run.cancelled = true
        reject(new Error('TERMINAL_START_TIMEOUT'))
      }, TERMINAL_LIMITS.startTimeoutMs)
      work.then(() => { clearTimeout(timer); resolve() }, (error) => { clearTimeout(timer); reject(error) })
    })
  }

  private async start(run: Run) {
    try {
      const resolved = await this.deps.resolveOrigin(run.authority, run.info.origin)
      if (run.cancelled || run.closed) return
      if (!run.authority.current()) { run.cancelled = true; return }
      run.info = { ...run.info, cwd: validCwd(resolved?.cwd) }
      const session = await this.deps.spawn(
        { origin: run.info.origin, cwd: run.info.cwd, cols: run.info.cols, rows: run.info.rows },
        { data: (data) => this.receive(run, data), exit: (exitCode, signal) => this.exit(run, exitCode, signal) },
        () => run.cancelled || run.closed || !run.authority.current()
      )
      // Keep the handle even if late cancellation cleanup fails: sweep/End must retry it.
      run.session = session
      this.showActivity(run)
      if (run.cancelled || run.closed) await this.stopTree(run)
    } catch (error) {
      // A failed launch can still own a process tree. Keep it visible and retryable.
      if (error instanceof TerminalSpawnError) {
        run.session = error.pty
        this.showActivity(run)
      }
      this.deps.log?.('terminal start failed', { sessionId: run.info.sessionId, message: error instanceof Error ? error.message : String(error) })
      throw error
    } finally {
      run.startSettled = true
    }
  }

  /** Waits for the real start, bounded, so close never hangs on it. */
  private async settle(run: Run) {
    if (run.startSettled) return
    await Promise.race([
      (run.work ?? run.starting).catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, TERMINAL_LIMITS.closeTimeoutMs))
    ])
  }

  private receive(run: Run, data: string) {
    if (run.closed || run.info.state !== 'running') return
    if (run.outputSequence >= CAP) { void this.closeRun(run, 'sequence_exhausted').catch(() => {}); return }
    try {
      run.screen.write(data)
      if (!run.parserPaused && (run.screen.pendingBytes ?? 0) >= TERMINAL_LIMITS.outputBytes / 2) {
        run.parserPaused = true
        run.session?.pause?.()
        void run.screen.flush().then(() => {
          run.parserPaused = false
          if (!run.closed && run.info.state === 'running') run.session?.resume?.()
        }).catch(() => { void this.closeRun(run, 'parser_failed').catch(() => {}) })
      }
    } catch {
      void this.closeRun(run, 'parser_overflow').catch(() => {})
      return
    }
    for (const piece of splitOutput(data)) this.enqueue(run, piece)
    this.schedule(run)
  }

  private enqueue(run: Run, data: string) {
    if (run.outputSequence >= CAP) return
    const bytes = utf8Length(data)
    const limit = TERMINAL_LIMITS.outputBytes
    while (run.queue.length && (run.queue.length >= TERMINAL_LIMITS.outputBacklog || run.queued + bytes > limit)) {
      run.queued -= run.queue.shift()!.bytes
    }
    run.queue.push({ sequence: ++run.outputSequence, bytes, data })
    run.queued += bytes
  }

  /** Drops only chunks the snapshot already covers; newer ones stay queued. */
  private dropThrough(run: Run, boundary: number) {
    run.queue = run.queue.filter((item) => item.sequence > boundary)
    run.queued = run.queue.reduce((total, item) => total + item.bytes, 0)
  }
  private dropQueue(run: Run) { run.queue = []; run.queued = 0 }

  private schedule(run: Run) {
    if (run.flushing) return
    run.flushing = true
    setTimeout(() => this.flush(run), FLUSH_DELAY)
  }

  private flush(run: Run) {
    run.flushing = false
    if (run.closed) { this.dropQueue(run); return }
    // Detached (socket gone) or re-attaching: hold output, never close the PTY.
    if (run.detached || run.suspended) return
    while (run.queue.length) {
      const item = run.queue.shift()!
      run.queued -= item.bytes
      this.emit(run, { event: 'terminal.output', sessionId: run.info.sessionId, epoch: run.info.epoch, sequence: item.sequence, data: item.data, lossy: true })
    }
    if (run.pendingExit) {
      const exit = run.pendingExit
      run.pendingExit = undefined
      if (run.outputSequence >= CAP) return
      this.emit(run, { event: 'terminal.exited', sessionId: run.info.sessionId, epoch: run.info.epoch, sequence: ++run.outputSequence, exitCode: exit.exitCode, ...(exit.signal ? { signal: exit.signal } : {}) })
    }
  }

  private emit(run: Run, event: TerminalEvent) {
    if (!run.authority.current()) return
    try { run.authority.emit(event) } catch (error) { this.deps.log?.('terminal emit failed', error) }
  }

  private exit(run: Run, exitCode: number, signal?: string) {
    if (run.closed) return
    run.info = { ...run.info, state: 'exited', exitCode, ...(signal ? { signal } : {}) }
    run.pendingExit = { exitCode, ...(signal ? { signal } : {}) }
    run.exitAt = this.now()
    // Shell exit is not tree exit: nohup/background jobs may still be alive.
    void (run.work ?? Promise.resolve()).then(() => this.stopTree(run))
      .catch((error) => this.deps.log?.('terminal exit cleanup unconfirmed', error))
    this.flush(run)
    this.hideActivity()
  }

  private async attach(sessionId: string, authority: TerminalAuthority) {
    const run = this.runs.get(this.key(authority, sessionId))
    if (!run || run.closed) return { state: 'missing' as const }
    if (run.authority.accountId !== authority.accountId || run.authority.deviceId !== authority.deviceId ||
      run.authority.authorizationId !== authority.authorizationId) {
      // Revoked or re-authorized: the old session must never be adopted.
      void this.closeRun(run, 'authorization_changed').catch(() => {})
      return { state: 'missing' as const }
    }
    if (run.info.epoch >= CAP) {
      void this.closeRun(run, 'sequence_exhausted').catch(() => {})
      return { state: 'missing' as const }
    }
    // Fresh closures and expiry for the reconnecting controller.
    run.authority = authority
    run.detached = false
    run.detachedAt = undefined
    run.info = { ...run.info, epoch: run.info.epoch + 1 }
    run.inputSequence = 0
    run.suspended = true
    const snapshot = await this.snapshot(run)
    setTimeout(() => {
      run.suspended = false
      if (!run.closed) this.flush(run)
    }, 0)
    return snapshot
  }

  private write(params: any, authority: TerminalAuthority) {
    const run = this.find(authority, params.sessionId)
    if (!run || run.closed || run.info.state !== 'running' || !run.session) throw new Error('TERMINAL_SESSION_ENDED')
    if (run.detached) throw new Error('TERMINAL_SESSION_DETACHED')
    if (params.epoch !== run.info.epoch) throw new Error('TERMINAL_STALE_EPOCH')
    if (run.inputSequence >= CAP) throw new Error('TERMINAL_SESSION_ENDED')
    if (params.sequence <= run.inputSequence) return { accepted: true as const, sequence: run.inputSequence }
    if (params.sequence > run.inputSequence + 1) throw new Error('TERMINAL_SEQUENCE_GAP')
    try {
      run.session.write(params.data)
    } catch (error) {
      this.deps.log?.('terminal write failed', error)
      throw new Error('TERMINAL_SESSION_ENDED')
    }
    run.inputSequence = params.sequence
    return { accepted: true as const, sequence: params.sequence }
  }

  private resize(params: any, authority: TerminalAuthority) {
    const run = this.find(authority, params.sessionId)
    if (!run || run.closed || run.info.state !== 'running' || !run.session) throw new Error('TERMINAL_SESSION_ENDED')
    if (run.detached) throw new Error('TERMINAL_SESSION_DETACHED')
    try {
      run.session.resize(params.cols, params.rows)
    } catch (error) {
      this.deps.log?.('terminal resize failed', error)
      throw new Error('TERMINAL_SESSION_ENDED')
    }
    run.screen.resize(params.cols, params.rows)
    run.info = { ...run.info, cols: params.cols, rows: params.rows }
    return { accepted: true as const, cols: params.cols, rows: params.rows }
  }

  /** One retryable ownership stop shared by natural exit, close and sweep. */
  private stopTree(run: Run): Promise<void> {
    if (run.stopConfirmed) return Promise.resolve()
    if (run.treeStopping) return run.treeStopping
    const attempt = (async () => {
      if (run.session) {
        await run.session.kill()
        run.session = undefined
      } else if (!run.startSettled) throw new Error('TERMINAL_CLOSE_UNCONFIRMED')
      run.stopConfirmed = true
      this.hideActivity()
    })()
    run.treeStopping = attempt.finally(() => { run.treeStopping = undefined })
    return run.treeStopping
  }

  private close(sessionId: string, reason: string, authority: TerminalAuthority) {
    const run = this.find(authority, sessionId)
    if (!run) return { state: 'missing' as const }
    return this.closeRun(run, reason)
  }

  /**
   * Idempotent while a stop is pending. Confirmed only after the PTY is known
   * gone; otherwise the session stays closed-but-retryable, stays visible in the
   * activity strip, and the sweep retries the stop.
   */
  private closeRun(run: Run, reason: string): Promise<CloseResult> {
    if (run.closePromise) return run.closePromise
    run.cancelled = true
    run.closed = true
    run.pendingClose = reason
    this.dropQueue(run)
    const attempt = (async (): Promise<CloseResult> => {
      await this.settle(run)
      await this.stopTree(run)
      if (!run.stopConfirmed) throw new Error('TERMINAL_CLOSE_UNCONFIRMED')
      run.pendingClose = undefined
      this.retire(run)
      return { state: 'closed', sessionId: run.info.sessionId, reason, confirmed: true }
    })()
    run.closePromise = attempt.catch((error) => {
      run.closePromise = undefined
      this.deps.log?.('terminal close unconfirmed', error)
      throw new Error('TERMINAL_CLOSE_UNCONFIRMED')
    })
    return run.closePromise
  }

  private retire(run: Run) {
    this.runs.delete(run.key)
    run.screen.dispose()
    this.startIds.set(this.startKey(run.authority, run.info.startId), { sessionId: run.info.sessionId, closed: true })
    while (this.startIds.size > TERMINAL_LIMITS.tombstones) {
      const oldest = this.startIds.keys().next().value
      if (oldest === undefined) break
      this.startIds.delete(oldest)
    }
    this.hideActivity()
  }

  /** A deliberate detach keeps the PTY and blocks input/output until retention. */
  private detach(run: Run) {
    if (run.closed || run.info.state !== 'running') return
    run.detached = true
    run.detachedAt = this.now()
  }

  peerGone(deviceId: string) {
    for (const run of this.runs.values()) if (run.authority.deviceId === deviceId) this.detach(run)
    this.hideActivity()
  }

  detachAll() {
    for (const run of this.runs.values()) this.detach(run)
    this.hideActivity()
  }

  /** Explicit revocation or authorization change: kill now, not by retention. */
  authorityChanged(deviceId: string) {
    for (const run of [...this.runs.values()]) {
      if (run.authority.deviceId !== deviceId) continue
      void this.closeRun(run, 'authorization_changed').catch((error) => this.deps.log?.('terminal close unconfirmed', error))
    }
  }

  /** Propagates unconfirmed stops so shutdown cannot claim a clean exit. */
  async stopAll(reason = 'host_stopped') {
    const results = await Promise.allSettled([...this.runs.values()].map((run) => this.closeRun(run, reason)))
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    this.hideActivity()
    if (failures.length) throw new AggregateError(failures, 'TERMINAL_CLOSE_UNCONFIRMED')
  }

  /** Reclamation plus retries of unconfirmed stops. */
  async sweep() {
    const now = this.now()
    for (const run of [...this.runs.values()]) {
      if (run.pendingClose) {
        await this.closeRun(run, run.pendingClose).catch(() => {})
        continue
      }
      if (run.closed) continue
      if (run.info.state === 'exited' && !run.stopConfirmed) await this.stopTree(run).catch(() => {})
      if (run.authority.validForMs() <= 0) {
        await this.closeRun(run, 'authorization_expired').catch(() => {})
        continue
      }
      // A dropped socket is not a revocation; detached sessions keep their PTY.
      if (!run.detached && !run.authority.current()) {
        await this.closeRun(run, 'authorization_expired').catch(() => {})
        continue
      }
      if (run.info.state === 'exited' && run.exitAt !== undefined && now - run.exitAt >= TERMINAL_LIMITS.retentionMs) {
        await this.closeRun(run, 'retention_expired').catch(() => {})
        continue
      }
      if (run.detachedAt !== undefined && now - run.detachedAt >= TERMINAL_LIMITS.retentionMs) {
        await this.closeRun(run, 'retention_expired').catch(() => {})
      }
    }
  }

  private showActivity(run: Run) {
    const peer = run.authority.deviceId
    if (this.activityShown === peer) return
    this.activityShown = peer
    try { this.deps.activity?.show(peer, () => { void this.stopAll('host_user_ended').catch(() => {}) }) } catch (error) { this.deps.log?.('terminal indicator failed', error) }
  }
  private hideActivity() {
    if (!this.activityShown) return
    // Keep the strip while any process may still be alive.
    if ([...this.runs.values()].some((run) => !run.stopConfirmed)) return
    this.activityShown = undefined
    try { this.deps.activity?.hide() } catch { /* best effort */ }
  }
}
