import { app } from 'electron'
import { copyFile, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspectPackagedInstallHealth } from './packaged-install-health'
import { mainBundleDirectory } from './main-bundle-path'

export type UpdateHealthProbeProgress = (
  phase: string,
  detail?: Record<string, string | number | boolean | null | undefined>
) => void

export type UpdateHealthProbeContext = {
  deadlineAt: number
  diagnosticBasePath: string
  reportProgress: UpdateHealthProbeProgress
}

export type UpdateHealthProbeDeps = {
  isPackaged: () => boolean
  executablePath: () => string
  resourcesPath: () => string
  inspectInstall: typeof inspectPackagedInstallHealth
  loadRuntimeAdapter: () => Promise<unknown>
  /** Probe the renderer surface: preload, renderer entry, and an IPC ping. */
  probeRendererWindow: (context: UpdateHealthProbeContext) => Promise<void>
  /**
   * Exercise the runtime against an isolated temporary data directory:
   * start the gateway, create a throwaway thread, read it back, delete it.
   */
  probeRuntimeServices: (dataDir: string, context: UpdateHealthProbeContext) => Promise<void>
  createTempDir: () => Promise<string>
  removeTempDir: (dir: string) => Promise<void>
}

async function defaultCreateTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'kun-update-health-'))
}

async function defaultRemoveTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

function timeoutFor(context: UpdateHealthProbeContext, maximumMs?: number): number {
  const remaining = context.deadlineAt - Date.now()
  if (remaining <= 0) throw new Error('The update health deadline expired.')
  return Math.max(1, Math.min(remaining, maximumMs ?? remaining))
}

async function withHealthDeadline<T>(
  work: Promise<T>,
  context: UpdateHealthProbeContext,
  label: string,
  maximumMs?: number
): Promise<T> {
  const timeoutMs = timeoutFor(context, maximumMs)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} exceeded its ${timeoutMs} ms health-check budget.`))
        }, timeoutMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForHealthDelay(
  context: UpdateHealthProbeContext,
  maximumMs: number
): Promise<void> {
  const delayMs = timeoutFor(context, maximumMs)
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs)
    timer.unref?.()
  })
}

async function finishCleanup(work: Promise<unknown>, maximumMs = 5_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maximumMs)
        timer.unref?.()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const defaultDeps: UpdateHealthProbeDeps = {
  isPackaged: () => app.isPackaged,
  executablePath: () => process.execPath,
  resourcesPath: () => process.resourcesPath,
  inspectInstall: inspectPackagedInstallHealth,
  loadRuntimeAdapter: () => import('./runtime/kun-adapter'),
  probeRendererWindow: defaultProbeRendererWindow,
  probeRuntimeServices: defaultProbeRuntimeServices,
  createTempDir: defaultCreateTempDir,
  removeTempDir: defaultRemoveTempDir
}

let rendererProbeRegistered = false
const HEALTH_BUNDLE_DIR = mainBundleDirectory(import.meta.url)

export function registerUpdateHealthRendererIpc(
  main: Pick<typeof import('electron').ipcMain, 'handle'>
): void {
  if (rendererProbeRegistered) return
  // The preload bridge exposes startup.getState() over this existing channel.
  // Registering an unrelated health-only channel leaves the invoke pending in
  // health mode because the normal shell IPC surface is intentionally absent.
  main.handle('startup:state:get', () => ({
    phase: 'bootstrapping',
    detail: 'update-health-probe'
  }))
  rendererProbeRegistered = true
}

/**
 * Renderer-surface probe: load the production preload and renderer entry in a
 * hidden window and complete one renderer -> main IPC round trip. This catches
 * missing preload builds, broken renderer chunks, and dead IPC channels before
 * the installer commits the payload switch.
 */
async function defaultProbeRendererWindow(context: UpdateHealthProbeContext): Promise<void> {
  const { BrowserWindow, ipcMain } = await import('electron')
  registerUpdateHealthRendererIpc(ipcMain)
  const preloadPath = (await import('./main-paths')).resolveNamedPreloadPath(
    HEALTH_BUNDLE_DIR, 'index'
  )
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true
    }
  })
  try {
    await withHealthDeadline(
      window.loadFile(join(HEALTH_BUNDLE_DIR, '../renderer/index.html')),
      context,
      'Renderer file load',
      30_000
    )
    context.reportProgress('renderer_loaded')
    context.reportProgress('renderer_ipc_checking')
    const pong = await withHealthDeadline(
      window.webContents.executeJavaScript(
        'window.kunGui ? window.kunGui.startup.getState() : Promise.reject(new Error("preload bridge missing"))',
        true
      ),
      context,
      'Renderer IPC bootstrap',
      15_000
    )
    if (!pong || typeof pong !== 'object' || pong.phase !== 'bootstrapping') {
      throw new Error('The renderer IPC ping returned an invalid payload.')
    }
    context.reportProgress('renderer_ready')
  } finally {
    window.destroy()
  }
}

async function findAvailableLoopbackPort(context: UpdateHealthProbeContext): Promise<number> {
  const server = createServer()
  try {
    await withHealthDeadline(new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    }), context, 'Runtime probe port selection', 5_000)
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('The runtime probe could not reserve a loopback port.')
    }
    return address.port
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined)
  }
}

type RuntimeExit = {
  code: number | null
  error?: Error
  signal: NodeJS.Signals | null
}

function runtimeExitError(exit: RuntimeExit): Error {
  if (exit.error) return new Error(`The candidate runtime failed to start: ${exit.error.message}`)
  return new Error(
    `The candidate runtime exited before the probe completed ` +
    `(code=${exit.code ?? 'null'}, signal=${exit.signal ?? 'null'}).`
  )
}

type IsolatedManagerDiscovery = {
  baseUrl: string
  instanceId: string
  managerToken: string
  pid: number
}

function safeIsolatedManagerDiscovery(value: unknown): IsolatedManagerDiscovery | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<IsolatedManagerDiscovery>
  if (
    typeof candidate.baseUrl !== 'string' ||
    typeof candidate.instanceId !== 'string' ||
    typeof candidate.managerToken !== 'string' ||
    !Number.isInteger(candidate.pid) ||
    Number(candidate.pid) <= 0
  ) return null
  try {
    const url = new URL(candidate.baseUrl)
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(url.hostname)
    ) {
      return null
    }
  } catch {
    return null
  }
  return candidate as IsolatedManagerDiscovery
}

async function shutdownIsolatedHealthManager(
  controlDir: string,
  context: UpdateHealthProbeContext
): Promise<void> {
  const managerLogPath = join(controlDir, 'manager.log')
  await copyFile(managerLogPath, `${context.diagnosticBasePath}.manager.log`).catch(() => undefined)
  let discovery: IsolatedManagerDiscovery | null = null
  try {
    discovery = safeIsolatedManagerDiscovery(JSON.parse(
      await readFile(join(controlDir, 'manager.json'), 'utf8')
    ))
  } catch {
    return
  }
  if (!discovery) return
  context.reportProgress('manager_stopping', { managerPid: discovery.pid })
  let shutdownAccepted = false
  try {
    const response = await fetch(`${discovery.baseUrl.replace(/\/$/u, '')}/v1/manager/shutdown`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${discovery.managerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ instanceId: discovery.instanceId }),
      signal: AbortSignal.timeout(5_000)
    })
    shutdownAccepted = response.ok
  } catch {
    // The manager can close its socket before the response is observed.
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      process.kill(discovery.pid, 0)
    } catch {
      context.reportProgress('manager_stopped', { managerPid: discovery.pid })
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (shutdownAccepted) {
    try {
      process.kill(discovery.pid, 'SIGTERM')
      context.reportProgress('manager_force_stop_requested', { managerPid: discovery.pid })
    } catch {
      context.reportProgress('manager_stopped', { managerPid: discovery.pid })
      return
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        process.kill(discovery.pid, 0)
      } catch {
        context.reportProgress('manager_stopped', { managerPid: discovery.pid })
        return
      }
    }
  }
  context.reportProgress('manager_stop_incomplete', { managerPid: discovery.pid })
}

export function updateHealthRuntimeEnvironment(
  resolutionKind: 'custom' | 'node-script',
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...source,
    ...(resolutionKind === 'node-script' ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  }
}

export function isolatedUpdateHealthRuntimeEnvironment(
  input: {
    dataDir: string
    managerControlDir: string
    managerSettingsPath: string
    resolutionKind: 'custom' | 'node-script'
    runtimeToken: string
  },
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...updateHealthRuntimeEnvironment(input.resolutionKind, source),
    KUN_MANAGER_BASE_URL: '',
    KUN_MANAGER_CONTROL_DIR: input.managerControlDir,
    KUN_MANAGER_DATA_DIR: '',
    KUN_MANAGER_INSTANCE_ID: '',
    KUN_MANAGER_SETTINGS_PATH: input.managerSettingsPath,
    KUN_MANAGER_TOKEN: '',
    KUN_RUNTIME_LAUNCH_MODE: 'update-health-probe',
    KUN_RUNTIME_DISCOVERY_DIR: join(input.dataDir, 'runtime-discovery'),
    KUN_RUNTIME_TOKEN: input.runtimeToken
  }
}

/**
 * Runtime-service probe against an isolated data directory: no user data is
 * touched. A throwaway thread is created, read back, and deleted through the
 * local gateway to prove the adapter, HTTP surface, and storage all work in
 * the candidate payload.
 */
async function defaultProbeRuntimeServices(
  dataDir: string,
  context: UpdateHealthProbeContext
): Promise<void> {
  const { spawn } = await import('node:child_process')
  const { resolveKunExecutableForCurrentApp } = await import('./kun-process')
  const { resolveKunRuntimeBuildId } = await import('./resolve-kun-binary')
  const resolution = resolveKunExecutableForCurrentApp()
  const buildId = await resolveKunRuntimeBuildId(resolution)
  if (!buildId) throw new Error('The candidate Kun Runtime build identity is missing.')

  const port = await findAvailableLoopbackPort(context)
  const token = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const stdoutPath = `${context.diagnosticBasePath}.runtime.stdout.log`
  const stderrPath = `${context.diagnosticBasePath}.runtime.stderr.log`
  const managerControlDir = join(dataDir, 'manager', 'control')
  const managerSettingsPath = join(dataDir, 'manager', 'kun-settings.json')
  await mkdir(dirname(stdoutPath), { recursive: true })
  const [stdoutLog, stderrLog] = await Promise.all([
    open(stdoutPath, 'a'),
    open(stderrPath, 'a')
  ])
  context.reportProgress('runtime_spawning', { port, stdoutPath, stderrPath })
  const child = spawn(resolution.command, [
    ...resolution.args,
    'serve',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--data-dir', dataDir,
    '--approval-policy', 'never',
    '--sandbox-mode', 'read-only',
    '--approval-reviewer', 'user',
    '--token-economy-mode', 'false'
  ], {
    env: isolatedUpdateHealthRuntimeEnvironment({
      dataDir,
      managerControlDir,
      managerSettingsPath,
      resolutionKind: resolution.kind,
      runtimeToken: token
    }),
    stdio: ['ignore', stdoutLog.fd, stderrLog.fd],
    windowsHide: true
  })
  let runtimeExit: RuntimeExit | undefined
  const runtimeExited = new Promise<RuntimeExit>((resolve) => {
    child.once('error', (error) => {
      runtimeExit = { code: null, error, signal: null }
      resolve(runtimeExit)
    })
    child.once('exit', (code, signal) => {
      runtimeExit = { code, signal }
      resolve(runtimeExit)
    })
  })
  try {
    await withHealthDeadline(Promise.race([
      new Promise<void>((resolve) => child.once('spawn', () => resolve())),
      runtimeExited.then((exit) => { throw runtimeExitError(exit) })
    ]), context, 'Runtime process spawn', 10_000)
    context.reportProgress('runtime_waiting', {
      port,
      runtimePid: child.pid ?? null,
      stdoutPath,
      stderrPath
    })
    const base = `http://127.0.0.1:${port}`
    const headers = { Authorization: `Bearer ${token}` }
    let ready = false
    while (Date.now() < context.deadlineAt) {
      const outcome = await Promise.race([
        fetch(`${base}/health`, {
          headers,
          signal: AbortSignal.timeout(timeoutFor(context, 2_000))
        }).then(
          (response) => ({ response }),
          () => ({ response: undefined })
        ),
        runtimeExited.then((exit) => ({ exit }))
      ])
      if ('exit' in outcome) {
        context.reportProgress('runtime_exited', {
          exitCode: outcome.exit.code,
          exitSignal: outcome.exit.signal
        })
        throw runtimeExitError(outcome.exit)
      }
      if (outcome.response?.ok) { ready = true; break }
      await waitForHealthDelay(context, 500)
    }
    if (!ready) throw new Error('The candidate runtime gateway did not become healthy.')
    context.reportProgress('runtime_ready', { port, runtimePid: child.pid ?? null })

    const fetchWhileRunning = async (
      url: string,
      init: RequestInit,
      label: string
    ): Promise<Response> => {
      if (runtimeExit) throw runtimeExitError(runtimeExit)
      return withHealthDeadline(Promise.race([
        fetch(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutFor(context, 15_000))
        }),
        runtimeExited.then((exit) => { throw runtimeExitError(exit) })
      ]), context, label, 15_000)
    }

    context.reportProgress('thread_creating')
    const createResponse = await fetchWhileRunning(`${base}/v1/threads`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'update-health-probe',
        workspace: dataDir,
        model: 'probe-model'
      })
    }, 'Runtime thread creation')
    if (createResponse.status !== 201) {
      throw new Error(`The candidate runtime could not create a thread (${createResponse.status}).`)
    }
    const created = await createResponse.json() as { id?: string }
    if (!created?.id) throw new Error('The candidate runtime returned a thread without an id.')

    context.reportProgress('thread_reading')
    const readResponse = await fetchWhileRunning(`${base}/v1/threads/${created.id}`, {
      headers
    }, 'Runtime thread read')
    if (!readResponse.ok) {
      throw new Error(`The candidate runtime could not read the probe thread (${readResponse.status}).`)
    }

    context.reportProgress('thread_deleting')
    const deleteResponse = await fetchWhileRunning(`${base}/v1/threads/${created.id}`, {
      method: 'DELETE', headers
    }, 'Runtime thread deletion')
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      throw new Error(`The candidate runtime could not delete the probe thread (${deleteResponse.status}).`)
    }
  } finally {
    if (!runtimeExit) child.kill()
    if (!runtimeExit) {
      await new Promise<void>((resolveExit) => {
        const timer = setTimeout(() => resolveExit(), 5_000)
        timer.unref?.()
        child.once('exit', () => { clearTimeout(timer); resolveExit() })
      })
    }
    if (!runtimeExit && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await Promise.race([
        runtimeExited,
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ])
    }
    await Promise.all([
      stdoutLog.close().catch(() => undefined),
      stderrLog.close().catch(() => undefined)
    ])
    context.reportProgress('runtime_stopped', { runtimePid: child.pid ?? null })
    await shutdownIsolatedHealthManager(managerControlDir, context)
  }
}

/**
 * Check the candidate payload before its installation transaction commits.
 * The probe now also exercises the renderer surface (preload, entry chunk,
 * IPC) and the runtime services (gateway, thread read/write) against an
 * isolated temporary data directory, because a successful probe triggers the
 * irreversible CommitUpdateTransaction. Persistent user-data migrations still
 * intentionally begin on the first normal launch after the commit succeeds.
 */
export async function runMinimalUpdateProbe(
  deps: UpdateHealthProbeDeps = defaultDeps,
  context: UpdateHealthProbeContext = {
    deadlineAt: Date.now() + 120_000,
    diagnosticBasePath: join(tmpdir(), `kun-update-health-${process.pid}`),
    reportProgress: () => undefined
  }
): Promise<void> {
  context.reportProgress('electron_waiting')
  await withHealthDeadline(app.whenReady(), context, 'Electron readiness', 15_000)
  context.reportProgress('electron_ready')
  // Calling getVersion confirms Electron's main-process binding is available.
  app.getVersion()

  context.reportProgress('payload_checking')
  const installHealth = deps.inspectInstall({
    isPackaged: deps.isPackaged(),
    executablePath: deps.executablePath(),
    resourcesPath: deps.resourcesPath()
  })
  if (!installHealth.ok) {
    throw new Error(`Kun installation is incomplete (${installHealth.missing.join(', ')}).`)
  }
  context.reportProgress('payload_ready')

  // This verifies the packaged runtime module graph without resolving settings,
  // starting a Manager/Runtime, or touching user data.
  context.reportProgress('runtime_module_loading')
  await withHealthDeadline(
    deps.loadRuntimeAdapter(), context, 'Runtime adapter module load', 15_000
  )
  context.reportProgress('runtime_module_ready')

  // Renderer surface: preload bridge, renderer entry, and one IPC round trip.
  context.reportProgress('renderer_loading')
  await deps.probeRendererWindow(context)

  // Runtime services against an isolated data directory; never user data.
  const dataDir = await withHealthDeadline(
    deps.createTempDir(), context, 'Runtime probe data-directory creation', 5_000
  )
  try {
    context.reportProgress('runtime_services_starting')
    await deps.probeRuntimeServices(dataDir, context)
  } finally {
    await finishCleanup(deps.removeTempDir(dataDir))
  }
}
