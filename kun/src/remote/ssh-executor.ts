/**
 * SSH command executor (Issue #647) — the real `spawn('ssh', ...)` runner.
 *
 * Bridges the pure argv/quoting layer to an actual child process. Always
 * `shell: false` (no local shell injection); the host alias is validated; the
 * remote working directory is quoted for the remote shell. Results are
 * structured and always carry the target, remote dir, and exit status so the
 * model never confuses remote and local execution. The `spawn` implementation
 * is injectable so this is unit-testable without a real SSH connection.
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { assertSafeSshAlias, buildSshExecArgv, type SshConnectionOptions } from './ssh-command.js'

export type SshExecOutcome = {
  alias: string
  remoteDir?: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  /** True when the caller's AbortSignal terminated the process. */
  aborted?: boolean
  /** True when stdout/stderr was capped to avoid unbounded memory growth. */
  truncated?: boolean
}

export interface SshChildStream {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void
}

export interface SshChildProcess {
  stdout: SshChildStream | null
  stderr: SshChildStream | null
  stdin?: { end(data?: string | Buffer): void }
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  kill(signal?: NodeJS.Signals): void
}

export type SshSpawnFn = (command: string, args: readonly string[]) => SshChildProcess

export type SshExecutorOptions = Omit<SshConnectionOptions, 'alias' | 'batchMode'> & {
  alias: string
  remoteDir?: string
  /** Injectable spawn for tests; defaults to `child_process.spawn('ssh', …, {shell:false})`. */
  spawn?: SshSpawnFn
  nowMs?: () => number
  /** Max bytes retained per stream (stdout/stderr) before capping. Default 8 MiB. */
  maxOutputBytes?: number
  /** Grace period after SIGTERM before escalating to SIGKILL. Default 2000ms. */
  killGraceMs?: number
}

const DEFAULT_SPAWN: SshSpawnFn = (command, args) => nodeSpawn(command, [...args], { shell: false }) as unknown as SshChildProcess
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1_024 * 1_024
const DEFAULT_KILL_GRACE_MS = 2_000

export class SshExecutor {
  private readonly spawn: SshSpawnFn
  private readonly nowMs: () => number

  constructor(private readonly options: SshExecutorOptions) {
    assertSafeSshAlias(options.alias)
    this.spawn = options.spawn ?? DEFAULT_SPAWN
    this.nowMs = options.nowMs ?? (() => Date.now())
  }

  /**
   * Run a command on the remote target. `batchMode` is forced on so a missing
   * key or unknown host fails fast instead of hanging on a prompt. An optional
   * `timeoutMs` kills the process and reports `timedOut: true`.
   */
  async exec(command: string, options: { timeoutMs?: number; signal?: AbortSignal; input?: string | Buffer } = {}): Promise<SshExecOutcome> {
    const argv = buildSshExecArgv({
      alias: this.options.alias,
      ...(this.options.remoteDir ? { remoteDir: this.options.remoteDir } : {}),
      command,
      batchMode: true,
      ...(this.options.controlPath ? { controlPath: this.options.controlPath } : {}),
      ...(this.options.connectTimeoutSec ? { connectTimeoutSec: this.options.connectTimeoutSec } : {}),
      ...(this.options.controlPersistSec ? { controlPersistSec: this.options.controlPersistSec } : {})
    })
    const start = this.nowMs()
    const child = this.spawn('ssh', argv)
    const maxBytes = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let aborted = false
    const appendCapped = (chunks: Buffer[], currentBytes: number, chunk: Buffer | string): number => {
      if (currentBytes >= maxBytes) {
        truncated = true
        return currentBytes
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = maxBytes - currentBytes
      if (bytes.length > remaining) {
        truncated = true
        chunks.push(bytes.subarray(0, remaining))
        return maxBytes
      }
      chunks.push(bytes)
      return currentBytes + bytes.length
    }
    child.stdout?.on('data', (chunk) => { stdoutBytes = appendCapped(stdoutChunks, stdoutBytes, chunk) })
    child.stderr?.on('data', (chunk) => { stderrBytes = appendCapped(stderrChunks, stderrBytes, chunk) })
    child.stdin?.end(options.input)

    return await new Promise<SshExecOutcome>((resolve, reject) => {
      let settled = false
      let hardKillTimer: ReturnType<typeof setTimeout> | undefined
      // A remote `ssh` that ignores SIGTERM (stuck in uninterruptible I/O, a
      // wedged PTY, …) must not linger forever. Escalate to SIGKILL after a
      // grace period so the timeout / abort actually frees the process.
      const killGraceMs = this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS
      const terminate = (): void => {
        child.kill('SIGTERM')
        if (!hardKillTimer) {
          hardKillTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, killGraceMs)
          if (hardKillTimer && typeof hardKillTimer === 'object' && 'unref' in hardKillTimer) {
            ;(hardKillTimer as { unref: () => void }).unref()
          }
        }
      }
      const finish = (outcome: SshExecOutcome): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(outcome)
      }
      const timer = options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => { timedOut = true; terminate() }, options.timeoutMs)
        : undefined
      const onAbort = (): void => { aborted = true; terminate() }
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        if (hardKillTimer) clearTimeout(hardKillTimer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      if (options.signal) {
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }
      child.on('error', (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
      child.on('close', (code, signal) => {
        const decode = (chunks: Buffer[]): string => {
          const decoder = new StringDecoder('utf8')
          // Intentionally do not call end(): when a capped stream ends in the
          // middle of a multibyte sequence, the incomplete suffix is dropped
          // instead of emitting U+FFFD and corrupting the visible text.
          return decoder.write(Buffer.concat(chunks))
        }
        finish({
          alias: this.options.alias,
          ...(this.options.remoteDir ? { remoteDir: this.options.remoteDir } : {}),
          command,
          stdout: decode(stdoutChunks),
          stderr: decode(stderrChunks),
          exitCode: code,
          signal: signal ?? null,
          durationMs: this.nowMs() - start,
          timedOut,
          ...(aborted ? { aborted: true } : {}),
          ...(truncated ? { truncated: true } : {})
        })
      })
    })
  }

  /**
   * Lightweight read-only liveness probe: runs `true` on the remote and reports
   * latency. Used by the connection state machine to move connected/degraded.
   */
  async probe(timeoutMs = 8_000): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    try {
      const outcome = await this.exec('true', { timeoutMs })
      if (outcome.timedOut) return { ok: false, error: 'probe timed out' }
      return outcome.exitCode === 0
        ? { ok: true, latencyMs: outcome.durationMs }
        : { ok: false, error: outcome.stderr.trim() || `probe exited ${outcome.exitCode}` }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
