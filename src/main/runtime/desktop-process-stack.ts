import {
  createOwnedServiceManagerSession,
  type OwnedServiceManagerSession
} from '../../../kun/src/manager/owned-service-manager-session.js'
import type {
  EnsureServiceManagerInput,
  ServiceManagerConnection
} from '../../../kun/src/manager/manager-client.js'
import { openManagerClientAdmission } from '../../../kun/src/manager/manager-client-lifetime.js'
import { StartupAttempt, type StartupProgress } from '../../../kun/src/manager/startup-attempt.js'

/** Application lifetime fence. A connection is never authority to adopt a foreign process. */
export class DesktopProcessStack {
  private session: OwnedServiceManagerSession | undefined
  private input: EnsureServiceManagerInput | undefined
  private stopping = false
  private terminal = false
  private epoch = 0
  private recovery: Promise<ServiceManagerConnection> | undefined
  private onManagerExit: (() => void) | undefined
  private watched = new WeakSet<object>()
  private attempt: StartupAttempt | undefined

  get startupAttempt(): StartupAttempt | undefined { return this.attempt }

  beginStartup(timeoutMs: number, onProgress: (progress: StartupProgress) => void): void {
    this.assertCanStart()
    this.attempt ??= new StartupAttempt(timeoutMs, undefined, onProgress)
  }

  finishStartup(): void {
    this.attempt?.check()
    this.attempt?.note('ready')
    this.attempt?.dispose()
    this.attempt = undefined
  }

  constructor(private readonly createSession = () =>
    createOwnedServiceManagerSession({ ownerKind: 'gui' })) {}

  managerChild() { return this.session?.current()?.child }
  isStopping(): boolean { return this.stopping || this.terminal }

  setManagerExitHandler(handler: () => void): void { this.onManagerExit = handler }

  assertCanStart(): void {
    if (this.stopping || this.terminal) throw new Error('Kun application is shutting down')
    this.attempt?.check()
  }

  beginStop(terminal = false): void {
    this.attempt?.abort(new Error('Kun application startup was cancelled'))
    this.attempt?.dispose()
    this.stopping = true
    this.terminal ||= terminal
    this.epoch += 1
  }

  resumeAfterFailedUpdate(): void {
    if (!this.terminal) this.stopping = false
  }

  async ensureManager(input: EnsureServiceManagerInput): Promise<ServiceManagerConnection> {
    this.assertCanStart()
    openManagerClientAdmission()
    const epoch = this.epoch
    this.input = input
    const session = this.session ??= this.createSession()
    const connection = await session.ensure(this.attempt ? { ...input, startupAttempt: this.attempt } : input)
    if (this.epoch !== epoch || this.stopping || this.terminal) {
      await session.stop({ deadline: Date.now() + 5_000 })
      throw new Error('Kun application closed during Service Manager startup')
    }
    const child = session.current()?.child
    if (child && !this.watched.has(child)) {
      this.watched.add(child)
      child.once('exit', () => {
        if (!this.stopping && !this.terminal && !this.recovery && session.current()?.child === child) {
          this.onManagerExit?.()
        }
      })
    }
    return connection
  }

  async recoverManager(
    stopRuntime: () => Promise<void>,
    force = false
  ): Promise<ServiceManagerConnection | undefined> {
    this.assertCanStart()
    if (!this.input) return undefined
    if (this.recovery) return this.recovery
    const input = this.input
    const current = this.session?.current()
    if (!force && current && current.child.exitCode === null && current.child.signalCode === null) {
      return current.connection
    }
    const epoch = this.epoch
    const attempt = this.attempt ?? new StartupAttempt(input.timeoutMs, input.signal, input.onStartupProgress)
    const recovery = (async () => {
      attempt.note('previous-processes')
      attempt.check()
      await stopRuntime()
      attempt.check()
      this.assertCanStart()
      if (epoch !== this.epoch) throw new Error('Kun Manager recovery was superseded')
      await this.session?.stop({ deadline: Date.now() + Math.min(5_000, Math.max(1, attempt.workDeadline - performance.now())) })
      attempt.check()
      this.assertCanStart()
      return this.ensureManager({ ...input, startupAttempt: attempt })
    })()
    this.recovery = recovery
    try { return await recovery } finally {
      if (attempt !== this.attempt) attempt.dispose()
      if (this.recovery === recovery) this.recovery = undefined
    }
  }

  async stopManager(deadline: number, terminal = false): Promise<void> {
    this.beginStop(terminal)
    const session = this.session
    if (!session) return
    if (this.terminal) await session.close({ deadline })
    else await session.stop({ deadline })
  }
}

export const desktopProcessStack = new DesktopProcessStack()
