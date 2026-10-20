import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

/**
 * Interpreter for Kun's long-lived Node children (Service Manager, Runtime,
 * persistent host). The terminal UI may itself run on a separate Node 26
 * interpreter for its native renderer; it passes the installation's own
 * interpreter down so native modules built for that ABI (better-sqlite3)
 * keep loading in the Runtime.
 *
 * - KUN_PACKAGED_RUNTIME_EXECUTABLE: the desktop app's Electron binary, run
 *   with ELECTRON_RUN_AS_NODE=1.
 * - KUN_HOST_NODE_EXECUTABLE: a plain Node interpreter (development and
 *   standalone installs).
 */
export type HostNodeLaunch = { command: string; runAsNode: boolean; isCurrentProcess: boolean }

export function hostNodeLaunch(env: NodeJS.ProcessEnv = process.env): HostNodeLaunch {
  const packaged = env.KUN_PACKAGED_RUNTIME_EXECUTABLE?.trim()
  if (packaged) return { command: packaged, runAsNode: true, isCurrentProcess: packaged === process.execPath }
  const host = env.KUN_HOST_NODE_EXECUTABLE?.trim()
  if (host) return { command: host, runAsNode: false, isCurrentProcess: host === process.execPath }
  return { command: process.execPath, runAsNode: Boolean(process.versions.electron), isCurrentProcess: true }
}

let electronHostProbe: string | null | undefined

/**
 * A development checkout rebuilds better-sqlite3 for the desktop app's
 * Electron ABI, so a plain Node launcher (`npm run dev:tui`) cannot load it
 * and the Manager silently degrades to JSONL scans of every thread. When the
 * module fails on this interpreter with an ABI mismatch, returns the
 * checkout's Electron binary (run as Node) whose ABI it was built for.
 */
export function electronHostForNativeModules(
  load: (id: string) => unknown = createRequire(import.meta.url)
): string | null {
  if (electronHostProbe !== undefined) return electronHostProbe
  electronHostProbe = null
  if (process.versions.electron) return electronHostProbe
  try {
    const Database = load('better-sqlite3') as new (path: string) => { close(): void }
    new Database(':memory:').close()
    return electronHostProbe
  } catch (error) {
    if (!/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED/u.test(`${(error as NodeJS.ErrnoException)?.code ?? ''} ${String(error)}`)) {
      return electronHostProbe
    }
  }
  try {
    const electron = load('electron')
    if (typeof electron === 'string' && existsSync(electron)) electronHostProbe = electron
  } catch {
    // No Electron next to this checkout; keep the current interpreter.
  }
  return electronHostProbe
}

export function resetElectronHostProbeForTest(): void {
  electronHostProbe = undefined
}
