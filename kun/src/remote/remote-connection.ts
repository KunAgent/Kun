/**
 * Remote connection state machine (Issue #647, #9 "status unknown").
 *
 * Wraps an {@link SshExecutor} with a small lifecycle: disconnected → connecting
 * → connected → degraded (after a drop) → disconnected. A single-flight probe
 * coalesces concurrent liveness checks. The critical reliability rule lives
 * here: when a connection drops mid-command, a READ-ONLY command may be
 * transparently retried after reconnect, but a MUTATING command is reported as
 * `statusUnknown` and NEVER auto-replayed, because we cannot confirm whether the
 * remote already executed it (a duplicate deploy/delete/email is worse than a
 * surfaced "unknown").
 */

import type { SshExecOutcome, SshExecutor } from './ssh-executor.js'
import type { RemoteConnectionStatus } from './remote-target.js'

export type RemoteProbeResult = {
  ok: boolean
  latencyMs?: number
  error?: string
}

export type RemoteRunResult = {
  outcome?: SshExecOutcome
  status: RemoteConnectionStatus
  /** True when the connection dropped before the result was confirmed. */
  statusUnknown: boolean
  /** Set when the command failed without a confirmed remote result. */
  error?: string
}

export type RemoteConnectionDeps = {
  executor: Pick<SshExecutor, 'exec' | 'probe'>
  nowMs?: () => number
}

/** SSH exit code that means the transport itself failed (auth/host/network). */
const SSH_TRANSPORT_EXIT_CODE = 255

function looksLikeTransportDrop(outcome: SshExecOutcome): boolean {
  if (outcome.timedOut) return true
  if (outcome.exitCode === SSH_TRANSPORT_EXIT_CODE) {
    const stderr = outcome.stderr.toLowerCase()
    return (
      stderr.includes('connection') ||
      stderr.includes('broken pipe') ||
      stderr.includes('timed out') ||
      stderr.includes('route to host') ||
      stderr.includes('reset by peer') ||
      stderr.includes('connection closed') ||
      stderr.includes('lost connection') ||
      stderr === '' // bare 255 with no body is almost always a transport failure
    )
  }
  return false
}

export class RemoteConnection {
  private _status: RemoteConnectionStatus = 'disconnected'
  private _latencyMs?: number
  private _lastError?: string
  private probePromise?: Promise<RemoteProbeResult>
  private readonly executor: Pick<SshExecutor, 'exec' | 'probe'>

  constructor(private readonly deps: RemoteConnectionDeps) {
    this.executor = deps.executor
  }

  status(): RemoteConnectionStatus {
    return this._status
  }

  latencyMs(): number | undefined {
    return this._latencyMs
  }

  lastError(): string | undefined {
    return this._lastError
  }

  /**
   * Single-flight liveness probe. Concurrent callers share one underlying
   * `ssh true`. Moves the status to connected on success; degraded/disconnected
   * on failure depending on the prior state.
   */
  async probe(timeoutMs = 8_000): Promise<RemoteProbeResult> {
    if (this.probePromise) return this.probePromise
    const previous = this._status
    if (previous === 'disconnected' || previous === 'error') {
      this._status = 'connecting'
    }
    this.probePromise = (async () => {
      try {
        const result = await this.executor.probe(timeoutMs)
        if (result.ok) {
          this._status = 'connected'
          this._latencyMs = result.latencyMs
          this._lastError = undefined
        } else {
          this._status = previous === 'connected' ? 'degraded' : 'error'
          this._lastError = result.error
        }
        return result
      } catch (error) {
        this._status = previous === 'connected' ? 'degraded' : 'error'
        this._lastError = error instanceof Error ? error.message : String(error)
        return { ok: false, error: this._lastError }
      } finally {
        this.probePromise = undefined
      }
    })()
    return this.probePromise
  }

  /**
   * Run a command, classifying any transport drop. `writes` decides the
   * post-drop behavior: read-only commands may be retried by the caller after a
   * successful reconnect; mutating commands are surfaced as `statusUnknown`.
   */
  async run(
    command: string,
    options: { writes: boolean; timeoutMs?: number; signal?: AbortSignal; input?: string | Buffer }
  ): Promise<RemoteRunResult> {
    // Re-establish before running when not actively connected. `degraded` is
    // included: after a prior drop we must re-probe, not blindly exec.
    if (this._status !== 'connected') {
      await this.probe(options.timeoutMs)
      const status = this.status()
      if (status !== 'connected') {
        return { status, statusUnknown: false, ...(this._lastError ? { error: this._lastError } : {}) }
      }
    }
    const first = await this.execOnce(command, options)
    if (!first.dropped) {
      this._status = 'connected'
      this._latencyMs = first.outcome?.durationMs ?? this._latencyMs
      this._lastError = undefined
      return { ...(first.outcome ? { outcome: first.outcome } : {}), status: 'connected', statusUnknown: false }
    }
    // Transport drop. A read-only command is safe to transparently retry once
    // after a successful reconnect; a mutating command must NOT be replayed
    // because the remote may already have run it.
    this._status = 'degraded'
    this._lastError = first.error
    if (options.writes) {
      return { ...(first.outcome ? { outcome: first.outcome } : {}), status: 'degraded', statusUnknown: true, ...(first.error ? { error: first.error } : {}) }
    }
    const probe = await this.probe(options.timeoutMs)
    if (!probe.ok) {
      return { ...(first.outcome ? { outcome: first.outcome } : {}), status: this.status(), statusUnknown: false, ...(first.error ? { error: first.error } : {}) }
    }
    const second = await this.execOnce(command, options)
    if (!second.dropped) {
      this._status = 'connected'
      this._latencyMs = second.outcome?.durationMs ?? this._latencyMs
      this._lastError = undefined
      return { ...(second.outcome ? { outcome: second.outcome } : {}), status: 'connected', statusUnknown: false }
    }
    this._status = 'degraded'
    this._lastError = second.error
    return { ...(second.outcome ? { outcome: second.outcome } : {}), status: 'degraded', statusUnknown: false, ...(second.error ? { error: second.error } : {}) }
  }

  /** One exec attempt; classifies a transport drop without mutating status. */
  private async execOnce(
    command: string,
    options: { timeoutMs?: number; signal?: AbortSignal; input?: string | Buffer }
  ): Promise<{ outcome?: SshExecOutcome; dropped: boolean; error?: string }> {
    let outcome: SshExecOutcome
    try {
      outcome = await this.executor.exec(command, {
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.input !== undefined ? { input: options.input } : {})
      })
    } catch (error) {
      return { dropped: true, error: error instanceof Error ? error.message : String(error) }
    }
    if (looksLikeTransportDrop(outcome)) {
      return { outcome, dropped: true, error: outcome.stderr.trim() || (outcome.timedOut ? 'command timed out' : 'connection dropped') }
    }
    return { outcome, dropped: false }
  }

  markDisconnected(reason?: string): void {
    this._status = 'disconnected'
    if (reason) this._lastError = reason
  }
}
