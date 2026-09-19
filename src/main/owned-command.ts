import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from '../../kun/src/process/owned-process'

export type OwnedCommandResult = { stdout: string; stderr: string; exitCode: number | null }
export type OwnedCommandOptions = Pick<SpawnOptions, 'cwd' | 'env' | 'windowsHide'> & {
  timeoutMs: number
  maxOutputBytes?: number
  truncateOutput?: boolean
  signal?: AbortSignal
  input?: string
  messages?: { aborted?: string; timeout?: string; outputLimit?: string }
  onSpawn?(child: ChildProcess): void
  onSettled?(child: ChildProcess): void
}

/** Bounded local helpers must finish their owned process tree before returning. */
export async function runOwnedCommand(
  command: string,
  args: readonly string[],
  options: OwnedCommandOptions
): Promise<OwnedCommandResult> {
  const aborted = () => Object.assign(new Error(options.messages?.aborted ?? 'Command was cancelled.'), { name: 'AbortError' })
  if (options.signal?.aborted) throw aborted()
  const startedAt = Date.now()
  const child = await spawnOwnedProcess(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: options.windowsHide ?? true,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
  })
  options.onSpawn?.(child)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const maxBytes = options.maxOutputBytes ?? 16 * 1024 * 1024
  let stdoutBytes = 0
  let stderrBytes = 0
  let failure: Error | undefined
  let cleanupFailure: unknown
  let stopping: Promise<void> | undefined
  const stop = (error: Error): void => {
    failure ??= error
    stopping ??= stopOwnedProcess(child, { graceMs: 250, timeoutMs: 3000 }).catch((reason) => {
      cleanupFailure = reason
    }).finally(() => {
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
    })
  }
  const append = (target: Buffer[], chunk: Buffer | string, bytes: number): number => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (bytes + buffer.length > maxBytes) {
      if (options.truncateOutput) {
        if (bytes < maxBytes) target.push(buffer.subarray(0, maxBytes - bytes))
        return maxBytes
      }
      stop(new Error(options.messages?.outputLimit ?? 'Command output exceeded its limit.'))
      return bytes
    }
    target.push(buffer)
    return bytes + buffer.length
  }
  child.stdout?.on('data', (chunk: Buffer) => { stdoutBytes = append(stdout, chunk, stdoutBytes) })
  child.stderr?.on('data', (chunk: Buffer) => { stderrBytes = append(stderr, chunk, stderrBytes) })
  child.stdin?.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') stop(error) })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const abort = () => stop(aborted())
  options.signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => stop(new Error(options.messages?.timeout ?? 'Command timed out.')),
    Math.max(0, options.timeoutMs - (Date.now() - startedAt)))
  try {
    if (options.signal?.aborted) abort()
    if (options.input !== undefined) child.stdin?.end(options.input)
    const exitCode = await exited
    await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 3000 })
    await closed
    await stopping
    if (cleanupFailure) throw cleanupFailure
    if (failure) throw failure
    return { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
    try { await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 3000 }) }
    finally { options.onSettled?.(child) }
  }
}
