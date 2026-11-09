import { logWarn } from '../logger'
import { RemoteTerminalService } from './session-service'
import { spawnRemoteTerminal, terminalSupported } from './pty-host'
import { createReplayScreens, loadTerminalScreens, type TerminalScreenFactory } from './screen'
import { TerminalActivityIndicator } from './indicator'
import { resolveOriginWorkspace, type RuntimeInvoke, type WorkspaceReader } from './origin-workspace'

/**
 * Main-process terminal engine for phone sessions.
 *
 * One service per app with real PTY and headless-screen backends behind ports,
 * a bounded sweep timer and an app-quit stop. The origin must be authorized
 * through the existing remote read, and its directory must come from the host's
 * own thread record (`readWorkspace`); a host that cannot supply one advertises
 * nothing and every open fails closed.
 */
const SWEEP_MS = 5_000
const engines = new Set<{ service: RemoteTerminalService; timer: ReturnType<typeof setInterval> }>()

export type TerminalEnginePorts = {
  /** Authorized runtime read (`code.history`/`agent.history`) through the relay lease. */
  invoke: RuntimeInvoke
  /** Host-side lookup of the approved project directory for that origin. */
  readWorkspace: WorkspaceReader
}

export function createTerminalEngine(ports: TerminalEnginePorts): RemoteTerminalService {
  let screens: TerminalScreenFactory = createReplayScreens()
  let supported = false
  const service = new RemoteTerminalService({
    resolveOrigin: (authority, origin) => resolveOriginWorkspace(ports.invoke, ports.readWorkspace, authority, origin),
    spawn: spawnRemoteTerminal,
    screens: { create: (cols, rows) => screens.create(cols, rows) },
    supported: () => supported,
    activity: new TerminalActivityIndicator(),
    log: (message, detail) => logWarn('remote-terminal', message, detail)
  })
  void Promise.all([loadTerminalScreens(), terminalSupported()])
    .then(([loaded, ready]) => {
      screens = loaded
      supported = ready && loaded.fullScreen === true
      if (!supported) logWarn('remote-terminal', 'PTY or headless emulator unavailable; phone terminals are not advertised')
    })
    .catch((error) => logWarn('remote-terminal', 'terminal backend probe failed', {
      message: error instanceof Error ? error.message : String(error)
    }))
  const timer = setInterval(() => { void service.sweep() }, SWEEP_MS)
  if (typeof timer.unref === 'function') timer.unref()
  engines.add({ service, timer })
  return service
}

export async function stopBuiltinTerminalEngines(): Promise<void> {
  const results = await Promise.allSettled([...engines].map(async (engine) => {
    await engine.service.stopAll('application_quit')
    clearInterval(engine.timer)
    engines.delete(engine)
  }))
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length) throw new AggregateError(failures, 'TERMINAL_CLOSE_UNCONFIRMED')
}
