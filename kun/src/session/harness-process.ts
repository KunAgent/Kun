/**
 * Owned harness agent process (generalized from `acp-process.ts`):
 * launched through `spawnOwnedProcess` so the child joins the host's
 * process-group/job-object supervision and is reclaimed on shutdown.
 *
 * stderr is captured into a bounded tail buffer — only the last bytes are kept
 * for error reporting; `sanitizedStderrTail()` strips credential-shaped
 * fragments before any of it can reach a log or user-facing error.
 */
import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { redactApprovalSensitiveText } from '../domain/approval.js'
import {
  isOwnedProcess,
  spawnOwnedProcess,
  stopOwnedProcess,
  type SpawnOwnedProcessOptions
} from '../process/owned-process.js'
import { buildHarnessEnv } from '../harness/harness-env.js'
import { harnessExecutableEnv } from '../harness/harness-executable-env.js'
import type { HarnessSpawnFn } from './harness-session.js'

export const HARNESS_STDERR_TAIL_BYTES = 64 * 1024

export type HarnessProcessExitInfo = {
  code: number | null
  signal: NodeJS.Signals | null
}

export class HarnessProcess {
  readonly child: ChildProcess
  readonly exit: Promise<HarnessProcessExitInfo>
  private readonly stderrDecoder = new StringDecoder('utf8')
  private stderrText = ''
  private readonly maxTailBytes: number

  constructor(child: ChildProcess, options: { stderrTailBytes?: number } = {}) {
    this.child = child
    this.maxTailBytes = options.stderrTailBytes ?? HARNESS_STDERR_TAIL_BYTES
    this.exit = new Promise<HarnessProcessExitInfo>((resolve) => {
      child.once('exit', (code, signal) => {
        this.stderrText += this.stderrDecoder.end()
        resolve({ code, signal })
      })
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      // Child streams may split a UTF-8 character across data events; decode
      // incrementally so multibyte stderr survives chunk boundaries.
      this.stderrText +=
        typeof chunk === 'string' ? chunk : this.stderrDecoder.write(chunk)
      const bytes = Buffer.byteLength(this.stderrText, 'utf8')
      if (bytes > this.maxTailBytes) {
        // Drop from the front until under the cap. Slicing by code units may
        // cut a UTF-8 sequence at the boundary, but this text is only a
        // diagnostics tail — never parsed.
        let cut = this.stderrText.length - this.maxTailBytes
        while (cut > 0 && Buffer.byteLength(this.stderrText.slice(cut), 'utf8') > this.maxTailBytes) {
          cut += 1
        }
        this.stderrText = this.stderrText.slice(cut)
      }
    })
  }

  get stdin() {
    return this.child.stdin
  }

  get stdout() {
    return this.child.stdout
  }

  /** Raw stderr tail for internal diagnostics — never user-facing unsanitized. */
  stderrTail(): string {
    return this.stderrText
  }

  /** Credential-bearing fragments removed; safe for logs and error text. */
  sanitizedStderrTail(): string {
    // Terminal colour codes from CLIs (e.g. OpenCode's error banner) are noise in UI text.
    return redactApprovalSensitiveText(stripTerminalEscapes(this.stderrText)).slice(-4_096)
  }

  async stop(graceMs = 1_000, timeoutMs = 5_000): Promise<void> {
    if (isOwnedProcess(this.child)) {
      await stopOwnedProcess(this.child, { graceMs, timeoutMs })
    } else {
      // Test-injected children have no containment registration.
      this.child.kill('SIGKILL')
    }
    await this.exit.catch(() => undefined)
  }
}

/** The OS could not create a process right now; the launch itself is fine. */
const TRANSIENT_SPAWN_CODES = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM'])
const TRANSIENT_SPAWN_MESSAGE = /\b(EAGAIN|EMFILE|ENFILE|ENOMEM)\b/
/** Waits before the second and third launch attempts. */
export const HARNESS_SPAWN_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000]

export function isTransientSpawnError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 8; depth += 1) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof code === 'string' && TRANSIENT_SPAWN_CODES.has(code)) return true
    if (typeof message === 'string' && TRANSIENT_SPAWN_MESSAGE.test(message)) return true
    current = cause
  }
  return false
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * A loaded machine can refuse a fork (`EAGAIN`) or run out of descriptors for
 * a moment; the user used to see the turn fail and resend it by hand. A failed
 * spawn never started the agent, so starting again cannot repeat its work.
 */
async function spawnWithTransientRetry(
  launch: () => Promise<ChildProcess>,
  signal: AbortSignal | undefined,
  retryDelaysMs: readonly number[]
): Promise<ChildProcess> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await launch()
    } catch (error) {
      const wait = retryDelaysMs[attempt]
      if (wait === undefined || signal?.aborted || !isTransientSpawnError(error)) throw error
      await delay(wait, signal)
    }
  }
}

export async function startHarnessProcess(input: {
  signal?: AbortSignal
  validateLaunch?: () => Promise<unknown>
  command: string
  args?: readonly string[]
  /** Non-sensitive launch env from the harness definition. */
  env?: Record<string, string>
  /** Resolved secretEnv values; overrides plain env entries. */
  secretEnv?: Record<string, string>
  /** Credential env from credential resolution (injected last, wins). */
  credentialEnv?: Record<string, string>
  /** Extra caller-specific strip keys beyond the shared denylist. */
  stripEnv?: readonly string[]
  cwd?: string
  /** Injectable for tests; production uses the owned-process launcher. */
  spawn?: HarnessSpawnFn
  stderrTailBytes?: number
  /** Injectable for tests; defaults to `HARNESS_SPAWN_RETRY_DELAYS_MS`. */
  spawnRetryDelaysMs?: readonly number[]
}): Promise<HarnessProcess> {
  const spawn =
    input.spawn ??
    ((command, args, options) => spawnOwnedProcess(command, args, options))
  const env = buildHarnessEnv({
    base: harnessExecutableEnv(),
    strip: input.stripEnv,
    add: { ...input.env, ...input.secretEnv, ...input.credentialEnv }
  })
  const beforeLaunch = async (): Promise<void> => {
    input.signal?.throwIfAborted()
    await input.validateLaunch?.()
    input.signal?.throwIfAborted()
  }
  await beforeLaunch()
  const child = await spawnWithTransientRetry(
    () => spawn(input.command, input.args ?? [], {
      beforeLaunch,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      ...(input.cwd ? { cwd: input.cwd } : {})
    }),
    input.signal,
    input.spawnRetryDelaysMs ?? HARNESS_SPAWN_RETRY_DELAYS_MS
  )
  const process = new HarnessProcess(child, { stderrTailBytes: input.stderrTailBytes })
  if (input.signal?.aborted) {
    await process.stop().catch(() => undefined)
    input.signal.throwIfAborted()
  }
  return process
}

/** Remove ANSI/VT control sequences (colours, cursor moves) from captured CLI output. */
export function stripTerminalEscapes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g, '')
}
