import { TERMINAL_LIMITS } from '@kun/remote-protocol'
import { spawnPtyBehindGate } from '../terminal/pty-launch-gate'
import { buildShellEnv, loadNodePty, resolveTerminalShellCandidates } from '../terminal/pty-environment'
import { registerOwnedProcessGroup } from '../../../kun/src/process/owned-process.js'
import { TerminalSpawnError, type TerminalHost, type TerminalPty, type TerminalReceiver } from './session-service'

/** A phone shell uses the desktop's ownership gate before user startup files run. */
type PtyLaunchOptions = {
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env?: NodeJS.ProcessEnv
}

const KILL_TIMEOUT_MS = Math.min(TERMINAL_LIMITS.closeTimeoutMs, 2_000)

export async function terminalSupported(): Promise<boolean> {
  return (await loadNodePty()) !== null
}

export async function spawnPty(options: PtyLaunchOptions, receive: TerminalReceiver, cancelled: () => boolean): Promise<TerminalPty> {
  const module = await loadNodePty()
  if (!module) throw new Error('TERMINAL_UNSUPPORTED')
  if (cancelled()) throw new Error('TERMINAL_START_CANCELLED')
  const launch = await spawnPtyBehindGate(module, options.file, options.args, {
    name: 'xterm-256color', cols: options.cols, rows: options.rows, cwd: options.cwd,
    env: options.env ?? buildShellEnv('native'), useConpty: true
  }, cancelled)

  let ownership = launch.ownership
  let stopping: Promise<void> | undefined
  const stop = async () => {
    // Without ownership the POSIX gate has not been released; only that gate ran.
    if (ownership) await ownership.stop()
    try { launch.pty.kill() } catch { /* gate or owned tree already exited */ }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([launch.exited, new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TERMINAL_CLOSE_UNCONFIRMED')), KILL_TIMEOUT_MS)
      })])
    } finally { clearTimeout(timer) }
  }
  const handle: TerminalPty = {
    write: (data) => { launch.pty.write(data) },
    resize: (cols, rows) => { launch.pty.resize(cols, rows) },
    pause: () => launch.pty.pause(),
    resume: () => launch.pty.resume(),
    kill: () => {
      if (!stopping) stopping = stop().catch((error) => { stopping = undefined; throw error })
      return stopping
    }
  }
  try {
    await launch.ready
    ownership ??= process.platform === 'win32' ? undefined :
      await registerOwnedProcessGroup(launch.pty.pid, { trackDescendants: true, ownerLossGraceMs: 5_000 })
    if (!ownership) throw new Error('TERMINAL_UNSUPPORTED')
    if (cancelled()) throw new Error('TERMINAL_START_CANCELLED')
    launch.pty.onData((data) => receive.data(data))
    const initial = launch.takeInitialOutput()
    if (initial) receive.data(initial)
    launch.pty.onExit(({ exitCode, signal }) => receive.exit(exitCode, signal ? String(signal) : undefined))
    launch.release()
  } catch (error) {
    try { await handle.kill() }
    catch (cleanupError) { throw new TerminalSpawnError(handle, cleanupError) }
    throw error
  }
  return handle
}

/** The phone never chooses a program; fallback is allowed only after proven cleanup. */
export const spawnRemoteTerminal: TerminalHost['spawn'] = async (spec, receive, cancelled) => {
  const failures: string[] = []
  for (const candidate of resolveTerminalShellCandidates()) {
    if (cancelled()) throw new Error('TERMINAL_START_CANCELLED')
    const env = buildShellEnv('native')
    if (candidate.gitBash) env.CHERE_INVOKING = '1'
    try {
      return await spawnPty({ file: candidate.file, args: candidate.args, cwd: spec.cwd, cols: spec.cols, rows: spec.rows, env }, receive, cancelled)
    } catch (error) {
      if (error instanceof TerminalSpawnError || cancelled()) throw error
      failures.push(`${candidate.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.warn('[remote-terminal] no shell started', failures)
  throw new Error('TERMINAL_UNSUPPORTED')
}
