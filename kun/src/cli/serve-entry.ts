#!/usr/bin/env node
import process from 'node:process'
import { parseServeOptionsSafe, SERVE_USAGE, ServeExitCode } from './serve.js'
import {
  KUN_CLI_USAGE,
  runAgentCommand,
  splitKunCliCommand
} from './agent-cli.js'
import { startKunServe, type KunServeHandle } from '../server/runtime-factory.js'
import {
  resolveEventLoopStallThresholdMs,
  startEventLoopMonitor
} from '../server/event-loop-monitor.js'

export const KUN_READY_PREFIX = 'KUN_READY '

/**
 * Serve mode runs unattended under the GUI. An uncaught error must not
 * leave a half-dead process: report it on stderr (the GUI captures the
 * tail), attempt a bounded graceful close, then exit non-zero so the
 * GUI supervisor can restart us.
 */
function installServeCrashHandlers(getHandle: () => KunServeHandle | null): void {
  let crashing = false
  const crash = (kind: string, error: unknown): void => {
    if (crashing) return
    crashing = true
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`kun serve: ${kind}: ${detail}\n`)
    const finish = (): void => process.exit(ServeExitCode.runtime)
    const handle = getHandle()
    if (!handle) {
      finish()
      return
    }
    const deadline = setTimeout(finish, 3000)
    deadline.unref()
    void handle
      .close()
      .catch(() => undefined)
      .finally(finish)
  }
  process.on('uncaughtException', (error) => crash('uncaughtException', error))
  process.on('unhandledRejection', (reason) => crash('unhandledRejection', reason))
}

/**
 * Serve-mode command. Kept separate from the dispatcher so GUI startup
 * still has the exact same KUN_READY handshake behavior.
 */
async function serveMain(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(SERVE_USAGE)
    return ServeExitCode.ok
  }
  const parsed = parseServeOptionsSafe(argv, process.env)
  if (!parsed.ok) {
    process.stderr.write(`kun serve: ${parsed.message}\n`)
    if (parsed.issues) {
      process.stderr.write(`${JSON.stringify(parsed.issues, null, 2)}\n`)
    }
    return parsed.exitCode
  }
  let handle: KunServeHandle | null = null
  installServeCrashHandlers(() => handle)
  const server = await startKunServe(parsed.options)
  handle = server
  await selfVerifyHealth(server.host, server.port)
  const info = server.runtime.info()
  const startupInfo = {
    service: 'kun',
    mode: 'serve',
    host: server.host,
    port: server.port,
    configPath: info.configPath,
    dataDir: info.dataDir,
    model: info.model,
    approvalPolicy: info.approvalPolicy,
    sandboxMode: info.sandboxMode,
    insecure: info.insecure,
    startedAt: info.startedAt,
    pid: info.pid,
    message: `kun runtime listening on http://${server.host}:${server.port}`
  }
  process.stdout.write(`${KUN_READY_PREFIX}${JSON.stringify(startupInfo)}\n`)
  process.stdout.write(JSON.stringify(startupInfo, null, 2) + '\n')
  // Watch for event-loop stalls so a hang that starves /health (and trips the
  // GUI watchdog) is attributable to CPU starvation vs a hard deadlock (#621).
  const loopMonitor = startEventLoopMonitor({
    stallThresholdMs: resolveEventLoopStallThresholdMs(process.env)
  })
  await new Promise<void>((resolve) => {
    const stop = () => {
      loopMonitor.stop()
      void server.close().finally(resolve)
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  })
  return ServeExitCode.ok
}

/**
 * When the GUI launches kun without `ELECTRON_RUN_AS_NODE` (the host
 * computer-use mode on darwin), the child runs as a real Electron instance.
 * libnut's first screen-grab / mouse / keyboard call invokes
 * `[NSApplication sharedApplication]`, which promotes the process to a
 * regular Cocoa app and macOS adds a second Dock icon. Hiding it via
 * `app.dock.hide()` is the official Electron API; we never open a window
 * here so the icon serves no purpose. A no-op when running as Node.
 */
async function hideMacosDockIfRunningAsElectron(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (!process.versions.electron) return
  try {
    const electron = (await import(/* @vite-ignore */ 'electron')) as {
      app?: { dock?: { hide?: () => void } }
    }
    electron.app?.dock?.hide?.()
  } catch {
    // Best-effort: when the electron module is unavailable (pure Node
    // fallback), leave the dock alone. The user still gets host control.
  }
}

const SELF_VERIFY_TIMEOUT_MS = 5_000
const SELF_VERIFY_POLL_MS = 100

async function selfVerifyHealth(host: string, port: number): Promise<void> {
  const url = `http://${host}:${port}/health`
  const deadline = Date.now() + SELF_VERIFY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(1_000)
      })
      if (res.ok) {
        const body = (await res.json()) as { status?: string }
        if (body?.status === 'ok') return
      }
    } catch {
      // retry
    }
    await new Promise<void>((r) => setTimeout(r, SELF_VERIFY_POLL_MS))
  }
  process.stderr.write(
    `[kun] warning: self-health-probe on http://${host}:${port}/health did not pass within ${SELF_VERIFY_TIMEOUT_MS}ms — proceeding anyway\n`
  )
}

export async function main(argv: readonly string[]): Promise<number> {
  await hideMacosDockIfRunningAsElectron()
  const command = splitKunCliCommand(argv)
  if (command.command === 'help') {
    if (command.error) {
      process.stderr.write(`kun: ${command.error}\n`)
      process.stderr.write(KUN_CLI_USAGE)
      return ServeExitCode.usage
    }
    process.stdout.write(KUN_CLI_USAGE)
    return ServeExitCode.ok
  }
  if (command.command === 'serve') {
    return serveMain(command.args)
  }
  return runAgentCommand(command.command, command.args, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    cwd: () => process.cwd()
  })
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exit(code)
  },
  (error) => {
    process.stderr.write(`kun serve: ${String(error)}\n`)
    process.exit(ServeExitCode.runtime)
  }
)
