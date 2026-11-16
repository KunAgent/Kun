import { spawnOwnedProcess, stopOwnedProcess } from '../../../../kun/src/process/owned-process'

/** The app's process guard owns TeX and descendants even if Electron exits unexpectedly. */
export async function runLatexProcess(command: string, args: string[], options: {
  cwd: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLog?: (text: string) => void
  timeoutMs?: number; idleMs?: number
}): Promise<{ code: number | null; log: string; cancelled: boolean }> {
  if (options.signal?.aborted) return { code: null, log: '', cancelled: true }
  const child = await spawnOwnedProcess(command, args, { cwd: options.cwd, env: options.env ?? process.env,
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], trackDescendants: true })
  let log = ''
  let activity = Date.now()
  const started = activity
  let stopping: Promise<void> | undefined
  let cleanupError: unknown
  const stop = (): void => {
    stopping ??= stopOwnedProcess(child, { graceMs: 250, timeoutMs: 3000 }).catch((error) => { cleanupError = error })
  }
  const append = (chunk: Buffer): void => {
    activity = Date.now()
    const text = chunk.toString('utf8')
    log = (log + text).slice(-256 * 1024)
    options.onLog?.(text.slice(-4096))
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  options.signal?.addEventListener('abort', stop, { once: true })
  if (options.signal?.aborted) stop()
  const timer = setInterval(() => {
    if (stopping) return
    if (Date.now() - started > (options.timeoutMs ?? 120_000) || Date.now() - activity > (options.idleMs ?? 30_000)) {
      log += '\nKun: TeX compilation timed out.\n'
      stop()
    }
  }, 250)
  timer.unref()
  try {
    const code = await exited
    await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 3000 })
    await closed
    await stopping
    if (cleanupError) throw cleanupError
    return { code, log, cancelled: options.signal?.aborted === true }
  } finally {
    clearInterval(timer)
    options.signal?.removeEventListener('abort', stop)
    await stopOwnedProcess(child, { graceMs: 0, timeoutMs: 3000 })
  }
}
