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
