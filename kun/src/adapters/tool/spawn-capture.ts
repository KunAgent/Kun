import { setPriority } from 'node:os'
import { spawnOwnedProcess } from '../../process/owned-process.js'
import { normalizePositiveInteger, shellSpawnEnv, terminateSpawnTree } from './builtin-shell-utils.js'

/** Combined stdout/stderr ceiling for helper subprocesses such as rg and git. */
export const DEFAULT_SPAWN_CAPTURE_MAX_BYTES = 1024 * 1024
/**
 * Scheduling niceness for bulk source scans. On POSIX this is a nice value;
 * Node maps it to BELOW_NORMAL on Windows. Interactive work keeps priority.
 */
export const LOW_PRIORITY_HELPER_NICENESS = 10

export type SpawnCaptureOptions = {
  cwd: string
  signal?: AbortSignal
  maxOutputBytes?: number
  timeoutMs?: number
  /**
   * Stop the producer after stdout has emitted this many newline-terminated
   * rows. Bounded callers use it to end a scan as soon as they have enough
   * candidates instead of waiting for the whole tree to be walked.
   */
  maxLines?: number
  /** Lower the helper's scheduling priority so bulk scans yield to the UI. */
  lowPriority?: boolean
}

export type SpawnCaptureResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  outputTruncated: boolean
  timedOut: boolean
  /** True when `maxLines` stopped the producer before it finished. */
  lineLimitReached?: boolean
}

export async function spawnCapture(
  file: string,
  args: string[],
  options: SpawnCaptureOptions
): Promise<SpawnCaptureResult> {
  const maxOutputBytes = normalizePositiveInteger(options.maxOutputBytes, DEFAULT_SPAWN_CAPTURE_MAX_BYTES)
  const maxLines = options.maxLines === undefined
    ? undefined
    : normalizePositiveInteger(options.maxLines, 1)
  const child = await spawnOwnedProcess(file, args, {
    cwd: options.cwd,
    env: shellSpawnEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  if (options.lowPriority && child.pid) {
    try {
      setPriority(child.pid, LOW_PRIORITY_HELPER_NICENESS)
    } catch {
      // The helper may already have exited, or the platform may refuse the
      // change. Priority is an optimization, never a correctness condition.
    }
  }
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let outputBytes = 0
  let stdoutLines = 0
  let outputTruncated = false
  let lineLimitReached = false
  let outputTerminationRequested = false
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const stopProducer = () => {
    if (outputTerminationRequested) return
    outputTerminationRequested = true
    terminateSpawnTree(child)
    // A malicious helper can ignore SIGTERM. Escalate shortly afterward so a
    // capped capture also releases its process and pipe resources.
    forceKillTimer = setTimeout(() => terminateSpawnTree(child, { signal: 'SIGKILL' }), 250)
    forceKillTimer.unref?.()
  }
  const appendOutput = (target: Buffer[], chunk: Buffer | string) => {
    if (lineLimitReached) return
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (maxLines !== undefined && target === stdout) {
      let cut = -1
      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] !== 0x0a) continue
        stdoutLines += 1
        if (stdoutLines >= maxLines) {
          cut = index + 1
          break
        }
      }
      if (cut >= 0) {
        buffer = buffer.subarray(0, cut)
        lineLimitReached = true
      }
    }
    const remaining = Math.max(0, maxOutputBytes - outputBytes)
    if (remaining > 0) {
      const kept = buffer.subarray(0, Math.min(buffer.length, remaining))
      target.push(kept)
      outputBytes += kept.length
    }
    if (buffer.length > remaining) {
      outputTruncated = true
      stopProducer()
    }
    if (lineLimitReached) stopProducer()
  }
  const onAbort = () => terminateSpawnTree(child)
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) onAbort()
  const timeoutMs = options.timeoutMs === undefined
    ? undefined
    : normalizePositiveInteger(options.timeoutMs, 1)
  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true
      stopProducer()
    }, timeoutMs)
    timeoutTimer.unref?.()
  }
  child.stdout?.on('data', (chunk: Buffer | string) => {
    appendOutput(stdout, chunk)
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    appendOutput(stderr, chunk)
  })
  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    child.once('error', rejectPromise)
    child.once('close', (code) => resolvePromise(code))
  }).finally(() => {
    options.signal?.removeEventListener('abort', onAbort)
    if (forceKillTimer) clearTimeout(forceKillTimer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
  })
  if (options.signal?.aborted) throw new Error('command aborted')
  return {
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
    exitCode,
    outputTruncated,
    // A line-limited helper was stopped on purpose; that is not a timeout.
    timedOut: timedOut && !lineLimitReached,
    ...(maxLines !== undefined ? { lineLimitReached } : {})
  }
}
