/**
 * ACP terminal/* client methods (docs/ade/03 §8.2). Each handle is an owned
 * process — `spawnOwnedProcess` launch, `stopOwnedProcess` reclamation — so
 * the process tree dies with its terminal. Handles are scoped by sessionId +
 * turnId; the client host reclaims everything when the turn ends.
 *
 * Output is a byte-bounded ring: the buffer keeps the newest
 * `outputByteLimit` bytes and `truncated` reports whether anything fell off.
 */
import type { ChildProcess } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from '../../process/owned-process.js'
import { ACP_RPC_ERROR, AcpError } from './acp-schema.js'

/** Default and ceiling for the per-terminal output ring. */
export const ACP_TERMINAL_DEFAULT_BYTE_LIMIT = 256 * 1024
export const ACP_TERMINAL_MAX_BYTE_LIMIT = 4 * 1024 * 1024

export type AcpTerminalExitStatus = {
  exitCode: number | null
  signal: string | null
}

type TerminalHandle = {
  id: string
  sessionId: string
  turnId: string
  child: ChildProcess
  /** Newest bytes retained, capped at byteLimit. */
  buffer: Buffer
  /** Total bytes ever seen — truncated when > buffer.byteLength. */
  totalBytes: number
  byteLimit: number
  exited: AcpTerminalExitStatus | null
  exitPromise: Promise<AcpTerminalExitStatus>
}

export type AcpTerminalCreateInput = {
  sessionId: string
  turnId: string
  command: string
  args?: readonly string[]
  env?: NodeJS.ProcessEnv
  cwd: string
  outputByteLimit?: number | null
}

export type AcpTerminalSpawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Promise<ChildProcess>

export type AcpTerminalStop = (child: ChildProcess) => Promise<void>

export class AcpTerminalRegistry {
  private readonly terminals = new Map<string, TerminalHandle>()
  private counter = 0
  private readonly spawn: AcpTerminalSpawn
  private readonly stop: AcpTerminalStop

  constructor(input: { spawn?: AcpTerminalSpawn; stop?: AcpTerminalStop } = {}) {
    this.spawn = input.spawn ?? ((command, args, options) =>
      spawnOwnedProcess(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe']
      }))
    this.stop = input.stop ?? ((child) =>
      stopOwnedProcess(child, { graceMs: 200, timeoutMs: 3_000 }))
  }

  get size(): number {
    return this.terminals.size
  }

  async create(input: AcpTerminalCreateInput): Promise<{ terminalId: string }> {
    const id = `acp_term_${++this.counter}`
    const byteLimit = Math.min(
      Math.max(1, Math.trunc(input.outputByteLimit ?? ACP_TERMINAL_DEFAULT_BYTE_LIMIT)),
      ACP_TERMINAL_MAX_BYTE_LIMIT
    )
    const child = await this.spawn(input.command, input.args ?? [], {
      cwd: input.cwd,
      env: input.env ?? {}
    })
    let resolveExit: (status: AcpTerminalExitStatus) => void
    const exitPromise = new Promise<AcpTerminalExitStatus>((resolve) => {
      resolveExit = resolve
    })
    const handle: TerminalHandle = {
      id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      child,
      buffer: Buffer.alloc(0),
      totalBytes: 0,
      byteLimit,
      exited: null,
      exitPromise
    }
    const append = (chunk: Buffer | string): void => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      handle.totalBytes += bytes.byteLength
      handle.buffer = Buffer.concat([handle.buffer, bytes])
      if (handle.buffer.byteLength > handle.byteLimit) {
        handle.buffer = handle.buffer.subarray(
          handle.buffer.byteLength - handle.byteLimit
        )
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (handle.exited) return
      handle.exited = { exitCode, signal }
      resolveExit(handle.exited)
    }
    child.once('exit', onExit)
    child.once('error', () => onExit(null, null))
    this.terminals.set(id, handle)
    exitPromise.catch(() => undefined)
    return { terminalId: id }
  }

  output(terminalId: string): {
    output: string
    truncated: boolean
    exitStatus?: AcpTerminalExitStatus
  } {
    const handle = this.lookup(terminalId)
    return {
      output: handle.buffer.toString('utf8'),
      truncated: handle.totalBytes > handle.buffer.byteLength,
      ...(handle.exited ? { exitStatus: handle.exited } : {})
    }
  }

  async waitForExit(
    terminalId: string,
    signal?: AbortSignal
  ): Promise<AcpTerminalExitStatus> {
    const handle = this.lookup(terminalId)
    if (handle.exited) return handle.exited
    if (!signal) return handle.exitPromise
    return Promise.race([
      handle.exitPromise,
      new Promise<AcpTerminalExitStatus>((_, reject) => {
        if (signal.aborted) {
          reject(new AcpError('request_aborted', 'terminal/wait_for_exit aborted'))
          return
        }
        signal.addEventListener(
          'abort',
          () => reject(new AcpError('request_aborted', 'terminal/wait_for_exit aborted')),
          { once: true }
        )
      })
    ])
  }

  async kill(terminalId: string): Promise<Record<string, never>> {
    const handle = this.lookup(terminalId)
    if (!handle.exited) {
      await this.stop(handle.child).catch(() => undefined)
    }
    return {}
  }

  async release(terminalId: string): Promise<Record<string, never>> {
    const handle = this.terminals.get(terminalId)
    if (!handle) return {}
    this.terminals.delete(terminalId)
    if (!handle.exited) {
      await this.stop(handle.child).catch(() => undefined)
    }
    handle.child.stdout?.removeAllListeners('data')
    handle.child.stderr?.removeAllListeners('data')
    return {}
  }

  /** Reclaim every terminal a turn spawned — called on turn end/cancel. */
  async releaseForTurn(turnId: string): Promise<void> {
    const ids = [...this.terminals.values()]
      .filter((handle) => handle.turnId === turnId)
      .map((handle) => handle.id)
    for (const id of ids) {
      await this.release(id)
    }
  }

  /** Reclaim every terminal a session ever spawned (session teardown). */
  async releaseForSession(sessionId: string): Promise<void> {
    const ids = [...this.terminals.values()]
      .filter((handle) => handle.sessionId === sessionId)
      .map((handle) => handle.id)
    for (const id of ids) {
      await this.release(id)
    }
  }

  private lookup(terminalId: string): TerminalHandle {
    const handle = this.terminals.get(terminalId)
    if (!handle) {
      throw new AcpError('policy_denied', `unknown terminal: ${terminalId}`, {
        rpcCode: ACP_RPC_ERROR.invalidParams
      })
    }
    return handle
  }
}
