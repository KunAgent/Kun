/**
 * Owned ACP agent process: launched through `spawnOwnedProcess` so the child
 * joins the host's process-group/job-object supervision (POSIX group + start
 * gate, Windows Job) and is reclaimed on shutdown.
 *
 * stderr is captured into a bounded tail buffer — only the last bytes are kept
 * for error reporting; `sanitizedStderrTail()` strips credential-shaped
 * fragments before any of it can reach a log or user-facing error.
 */
import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { redactApprovalSensitiveText } from '../../domain/approval.js'
import {
  isOwnedProcess,
  spawnOwnedProcess,
  stopOwnedProcess,
  type SpawnOwnedProcessOptions
} from '../../process/owned-process.js'
import { buildHarnessEnv } from '../../harness/harness-env.js'
import type { AcpProcessExitInfo } from './acp-jsonrpc.js'

export const ACP_STDERR_TAIL_BYTES = 64 * 1024

export type AcpSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOwnedProcessOptions
) => Promise<ChildProcess>

export class AcpProcess {
  readonly child: ChildProcess
  readonly exit: Promise<AcpProcessExitInfo>
  private readonly stderrDecoder = new StringDecoder('utf8')
  private stderrText = ''
  private readonly maxTailBytes: number

  constructor(child: ChildProcess, options: { stderrTailBytes?: number } = {}) {
    this.child = child
    this.maxTailBytes = options.stderrTailBytes ?? ACP_STDERR_TAIL_BYTES
    this.exit = new Promise<AcpProcessExitInfo>((resolve) => {
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
    return redactApprovalSensitiveText(this.stderrText).slice(-4_096)
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

export async function startAcpProcess(input: {
  command: string
  args?: readonly string[]
  /** Non-sensitive launch env from the harness definition. */
  env?: Record<string, string>
  /** Credential env from credential resolution (injected last, wins). */
  credentialEnv?: Record<string, string>
  /** Extra caller-specific strip keys beyond the shared denylist. */
  stripEnv?: readonly string[]
  cwd?: string
  /** Injectable for tests; production uses the owned-process launcher. */
  spawn?: AcpSpawnFn
  stderrTailBytes?: number
}): Promise<AcpProcess> {
  const spawn =
    input.spawn ??
    ((command, args, options) => spawnOwnedProcess(command, args, options))
  const env = buildHarnessEnv({
    base: process.env,
    strip: input.stripEnv,
    add: { ...input.env, ...input.credentialEnv }
  })
  const child = await spawn(input.command, input.args ?? [], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    ...(input.cwd ? { cwd: input.cwd } : {})
  })
  return new AcpProcess(child, { stderrTailBytes: input.stderrTailBytes })
}
