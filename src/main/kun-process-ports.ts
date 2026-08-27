import { createServer } from 'node:net'
import type { RuntimeFlavor } from '../../kun/src/contracts/runtime-flavor.js'
import {
  readRuntimeHandoffDiscovery,
  type RuntimeHandoffDiscoveryRecord
} from '../../kun/src/server/runtime-discovery.js'
import { identityMatchesExpectedRuntime } from './kun-process-identity'
import { appendManagedLogLine } from './logger'
import {
  execFileAsync,
  formatKunLogLine,
  MAX_TCP_PORT,
  processController,
  sleep
} from './kun-process-state'

export type KunPortReclaimContext = {
  dataDir: string
  flavor?: RuntimeFlavor
  expectedServeEntryPath?: string
}

export async function reclaimKunPort(
  port: number,
  context?: KunPortReclaimContext
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (port <= 0) return { ok: true }
  if (await canBindTcpPort(port, '127.0.0.1')) return { ok: true }
  if (await killStaleKunOnPort(port, context) && await canBindTcpPort(port, '127.0.0.1')) {
    return { ok: true }
  }
  return { ok: false, message: `port ${port} is in use` }
}

export async function resolveAvailableKunPort(
  preferredPort: number,
  context?: KunPortReclaimContext
): Promise<{ port: number; changed: boolean; message?: string }> {
  if (preferredPort > 0) {
    // A temporarily unresponsive managed child still owns its configured
    // endpoint. Moving settings to another port here strands the live child
    // and makes every concurrent request launch/probe a port with no server.
    if (processController.isRunning() && processController.childPort === preferredPort) {
      return { port: preferredPort, changed: false }
    }
    if (await canBindTcpPort(preferredPort, '127.0.0.1')) {
      return { port: preferredPort, changed: false }
    }
    // Prefer reclaiming the configured port from a stale kun left by a
    // crashed previous app run over silently moving to a new port.
    if (
      await killStaleKunOnPort(preferredPort, context) &&
      await canBindTcpPort(preferredPort, '127.0.0.1')
    ) {
      return { port: preferredPort, changed: false }
    }
    for (let port = preferredPort + 1; port <= MAX_TCP_PORT; port += 1) {
      if (await canBindTcpPort(port, '127.0.0.1')) {
        return {
          port,
          changed: true,
          message: `port ${preferredPort} is in use`
        }
      }
    }
  }
  const port = await allocateTcpPort('127.0.0.1')
  return {
    port,
    changed: true,
    ...(preferredPort > 0 ? { message: `port ${preferredPort} is in use` } : {})
  }
}

/**
 * Kill a stale kun serve process from a previous app run that is still
 * holding the configured port. Only processes whose command line looks
 * like our serve entry are touched; anything else keeps the port and we
 * fall back to allocating a different one.
 *
 * Safe by construction on every platform: any failure to positively
 * identify the holder as our own serve-entry leaves it untouched and the
 * caller allocates a different port instead.
 */
export async function killStaleKunOnPort(
  port: number,
  context?: KunPortReclaimContext
): Promise<boolean> {
  // Generic port probes do not know a runtime owner, so they intentionally
  // fail closed and let callers choose another available port.
  if (!context) return false
  const pids = await listListeningPidsOnPort(port)
  let reclaimed = false
  for (const pid of pids) {
    if (processController.isCurrentPid(pid)) continue
    const verifyTarget = async (): Promise<boolean> => {
      const identity = await processIdentity(pid)
      const discovery = await readKunPortOwner(context, port)
      return Boolean(discovery && identityMatchesExpectedRuntime(
        identity,
        discovery,
        context.dataDir,
        context.flavor ?? 'production',
        context.expectedServeEntryPath
      ))
    }
    if (!(await verifyTarget())) {
      void appendManagedLogLine(
        'kun',
        formatKunLogLine('lifecycle', pid, `skipped non-kun listener on port ${port}`)
      )
      continue
    }
    void appendManagedLogLine(
      'kun',
      formatKunLogLine('lifecycle', pid, `killing stale kun process holding port ${port}`)
    )
    if (await terminateVerifiedPid(pid, verifyTarget)) reclaimed = true
  }
  return reclaimed
}

async function readKunPortOwner(
  context: KunPortReclaimContext,
  port: number
): Promise<RuntimeHandoffDiscoveryRecord | null> {
  try {
    const discovery = await readRuntimeHandoffDiscovery(context.dataDir, context.flavor ?? 'production')
    return discovery?.port === port ? discovery : null
  } catch {
    return null
  }
}

/**
 * PIDs listening on `port`, excluding our own process. Uses `lsof` on
 * macOS/Linux and `netstat -ano` on Windows.
 */
export async function listListeningPidsOnPort(port: number): Promise<number[]> {
  if (packagedUpdateHandoffInspectionDenied()) return []
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync('netstat', ['-ano'], {
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 8 * 1024 * 1024
      })
      return parseListeningPidsFromNetstat(stdout, port)
    } catch {
      return []
    }
  }
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'])
    return stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  } catch {
    return []
  }
}

/**
 * Parse `netstat -ano` output into the PIDs holding a LISTENING TCP socket
 * on `port`. Columns are `Proto  Local  Foreign  State  PID`; UDP rows
 * (no State column) and non-matching ports are ignored. Matches both IPv4
 * (`127.0.0.1:<port>`) and IPv6 (`[::1]:<port>`) local addresses.
 */
export function parseListeningPidsFromNetstat(stdout: string, port: number): number[] {
  const pids = new Set<number>()
  for (const raw of stdout.split(/\r?\n/)) {
    const cols = raw.trim().split(/\s+/)
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue
    if (cols[3].toUpperCase() !== 'LISTENING') continue
    if (!cols[1].endsWith(`:${port}`)) continue
    const pid = Number(cols[cols.length - 1])
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid)
  }
  return [...pids]
}

/** Read a process's full command line (best effort, platform-specific). */
export async function processCommandLine(pid: number): Promise<string> {
  if (packagedUpdateHandoffInspectionDenied()) {
    throw Object.assign(new Error('packaged smoke denied process inspection'), { code: 'EPERM' })
  }
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`
      ],
      { windowsHide: true, timeout: 5_000 }
    )
    return stdout.trim()
  }
  const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='])
  return stdout.trim()
}

export type ProcessIdentity = {
  pid: number
  commandLine: string
  executablePath: string | null
  startedAtMs: number | null
}

/**
 * Read immutable process identity attributes so replacement can reject a PID
 * that was recycled after its runtime discovery record was written.
 */
export async function processIdentity(pid: number): Promise<ProcessIdentity | null> {
  if (packagedUpdateHandoffInspectionDenied()) return null
  try {
    if (process.platform === 'win32') return await windowsProcessIdentity(pid)
    const { stdout } = await execFileAsync(
      'ps',
      ['-p', String(pid), '-o', 'lstart=', '-o', 'command='],
      { timeout: 5_000 }
    )
    const line = stdout.trim()
    if (line.length < 25) return null
    const startedAtMs = Date.parse(line.slice(0, 24))
    const commandLine = line.slice(24).trim()
    if (!commandLine || !Number.isFinite(startedAtMs)) return null
    return { pid, commandLine, executablePath: null, startedAtMs }
  } catch {
    return null
  }
}

async function windowsProcessIdentity(pid: number): Promise<ProcessIdentity | null> {
  const { stdout } = await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$process = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($process) { [pscustomobject]@{ ProcessId = $process.ProcessId; ExecutablePath = $process.ExecutablePath; CommandLine = $process.CommandLine; CreationDate = $process.CreationDate } | ConvertTo-Json -Compress }`
    ],
    { windowsHide: true, timeout: 5_000 }
  )
  const record = JSON.parse(stdout.trim()) as {
    ProcessId?: unknown
    ExecutablePath?: unknown
    CommandLine?: unknown
    CreationDate?: unknown
  }
  const commandLine = typeof record.CommandLine === 'string' ? record.CommandLine.trim() : ''
  const startedAtMs = typeof record.CreationDate === 'string'
    ? Date.parse(record.CreationDate)
    : Number.NaN
  if (record.ProcessId !== pid || !commandLine || !Number.isFinite(startedAtMs)) return null
  return {
    pid,
    commandLine,
    executablePath: typeof record.ExecutablePath === 'string' ? record.ExecutablePath : null,
    startedAtMs
  }
}

export function packagedUpdateHandoffInspectionDenied(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE === '1' &&
    env.KUN_PACKAGED_UPDATE_HANDOFF_SMOKE === '1' &&
    env.KUN_PACKAGED_UPDATE_HANDOFF_DENY_INSPECTION === '1'
}

/** Terminate a positively-identified stale kun process. */
export async function terminateStalePid(pid: number): Promise<boolean> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5_000
      })
      return true
    } catch {
      // taskkill exits non-zero when the PID is already gone — treat the
      // port as reclaimed only if the process really is no longer alive.
      return await waitForPidExit(pid, 0)
    }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }
  if (!(await waitForPidExit(pid, 2_000))) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* already gone */
    }
    await waitForPidExit(pid, 1_000)
  }
  return true
}

/**
 * Terminate a process only while a caller can still prove that its identity is
 * the intended target. A PID can be reused between a graceful signal and a
 * forced signal, so Unix rechecks the caller's proof before escalating to
 * SIGKILL. The replacement lifecycle supplies proof from exact runtime
 * discovery, the expected command shape, and the recorded listening port.
 */
export async function terminateVerifiedPid(
  pid: number,
  verifyTarget: () => Promise<boolean>,
  waitForExit: (pid: number, timeoutMs: number) => Promise<boolean> = waitForPidExit,
  system: {
    platform?: NodeJS.Platform
    kill?: typeof process.kill
    execFile?: typeof execFileAsync
  } = {}
): Promise<boolean> {
  const platform = system.platform ?? process.platform
  const kill = system.kill ?? process.kill.bind(process)
  const execFile = system.execFile ?? execFileAsync
  if (!(await verifyTarget())) return false
  if (platform === 'win32') {
    try {
      await execFile('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5_000
      })
    } catch {
      return waitForExit(pid, 0)
    }
    return waitForExit(pid, 2_000)
  }

  try {
    kill(pid, 'SIGTERM')
  } catch {
    return waitForExit(pid, 0)
  }
  if (await waitForExit(pid, 2_000)) return true
  // Do not escalate after PID reuse or an identity change.
  if (!(await verifyTarget())) return false
  try {
    kill(pid, 'SIGKILL')
  } catch {
    return waitForExit(pid, 0)
  }
  return waitForExit(pid, 2_000)
}

export async function waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      // EPERM means the process still exists but belongs to an identity we
      // cannot signal. Treat only a missing PID as an exit.
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    }
    if (Date.now() >= deadline) return false
    await sleep(100)
  }
}

export function canBindTcpPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const server = createServer()
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      resolve(available)
    }
    server.unref()
    server.once('error', () => settle(false))
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => settle(true))
    })
  })
}
export function allocateTcpPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const cleanup = (): void => {
      server.removeAllListeners('error')
      server.removeAllListeners('listening')
    }
    server.unref()
    server.once('error', (error) => {
      cleanup()
      reject(error)
    })
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        cleanup()
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('failed to allocate an available Kun port'))
      })
    })
  })
}
