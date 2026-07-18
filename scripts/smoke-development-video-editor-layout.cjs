#!/usr/bin/env node

'use strict'

const { spawn, spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const { _electron } = require('playwright-core')
const {
  makeTreeWritable
} = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  platformDesktopArguments,
  terminateProcessTree,
  waitForPortsClosed
} = require('./smoke-packaged-extension-desktop.cjs')
const {
  developmentRendererEnvironment
} = require('./development-renderer-environment.cjs')
const {
  EXTENSION_ID,
  EXTENSION_VERSION,
  desktopVideoEditorSettings,
  findWorkbenchWindow,
  openVideoEditor
} = require('./smoke-packaged-video-editor-desktop.cjs')
const {
  TARGET_WIDTHS,
  assertLayoutGeometry,
  ensureProject,
  readGuestGeometry,
  readHostGeometry,
  resizeRightSidebar,
  visibleGuestWebContentsId,
  waitForVisibleGuestReady
} = require('./smoke-packaged-video-editor-layout.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const EVIDENCE_WIDTHS = new Set([280, 560])
const PROCESS_OUTPUT_LIMIT = 128 * 1024

async function main() {
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const repositoryRoot = resolve(argumentValue('--repository-root') ?? join(__dirname, '..'))
  const extensionRoot = join(repositoryRoot, 'examples', 'extensions', 'kun-video-editor')
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  const extensionEntry = join(extensionRoot, 'dist', 'host', 'extension.js')
  const extensionRuntimeModule = join(repositoryRoot, 'kun', 'dist', 'extensions', 'index.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable],
    ['Vite CLI', viteCli],
    ['development renderer config', rendererConfig],
    ['built development Main entry', mainEntry],
    ['built development extension entry', extensionEntry],
    ['built Kun extension runtime', extensionRuntimeModule]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-video-editor-development-layout-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'video-editor-development-layout-'))
  const evidenceRoot = resolve(
    argumentValue('--evidence-dir') ?? join(tmpdir(), 'kun-video-editor-development-layout-evidence')
  )
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let electronApplication
  let electronProcess
  let rendererProcess
  let rendererOutput = ''
  let primaryError
  const cleanupErrors = []

  try {
    await Promise.all([
      mkdir(profile, { recursive: true }),
      mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }),
      mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(evidenceRoot, { recursive: true })
    ])
    const settings = desktopVideoEditorSettings({
      runtimePort,
      workspaceRoot,
      dataDir: profile,
      modelBaseUrl: 'http://127.0.0.1:9/v1'
    })
    const serializedSettings = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({
      platform: process.platform,
      home,
      appData,
      explicitUserData: userData
    }).map(async (directory) => {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'kun-settings.json'), serializedSettings)
    }))

    const isolatedEnvironment = developmentRendererEnvironment(
      createIsolatedEnvironment(process.env, {
        home,
        appData,
        localAppData,
        temporaryDirectory
      }),
      { rendererPort, temporaryRoot }
    )
    isolatedEnvironment.NODE_ENV = 'development'

    runRepositoryKun([
      'extension', 'install',
      '--development', extensionRoot,
      '--data-dir', profile,
      '--accept-permissions',
      '--json'
    ], repositoryRoot, isolatedEnvironment, timeoutMs)
    await grantDevelopmentWorkspaceTrust(extensionRuntimeModule, profile, workspaceRoot)

    rendererProcess = spawn(process.execPath, [viteCli, '--config', rendererConfig, '--logLevel', 'warn'], {
      cwd: repositoryRoot,
      env: isolatedEnvironment,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const appendRendererOutput = (chunk) => {
      rendererOutput = `${rendererOutput}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT)
    }
    rendererProcess.stdout?.on('data', appendRendererOutput)
    rendererProcess.stderr?.on('data', appendRendererOutput)
    rendererProcess.once('error', (error) => appendRendererOutput(`\nrenderer launch error: ${String(error)}\n`))
    await waitForPortOpen(rendererPort, timeoutMs, () => processState(rendererProcess))

    electronApplication = await _electron.launch({
      executablePath: electronExecutable,
      args: [
        `--user-data-dir=${userData}`,
        '--no-first-run',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        ...platformDesktopArguments(process.platform),
        repositoryRoot
      ],
      cwd: repositoryRoot,
      env: isolatedEnvironment,
      chromiumSandbox: true,
      timeout: timeoutMs
    })
    electronProcess = electronApplication.process()
    let workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
    await electronApplication.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      if (!window) throw new Error('Kun development workbench BrowserWindow is unavailable')
      const bounds = window.getBounds()
      window.setBounds({ ...bounds, width: 1_800, height: 1_100 }, false)
    })
    await workbench.evaluate(() => {
      localStorage.setItem('kun.layout.leftSidebarCollapsed', '1')
    })
    await workbench.reload({ waitUntil: 'domcontentloaded' })
    workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
    await openVideoEditor(workbench, electronApplication, timeoutMs)
    const guestWebContentsId = await visibleGuestWebContentsId(workbench)
    await waitForVisibleGuestReady(electronApplication, guestWebContentsId, timeoutMs)
    await ensureProject(electronApplication, guestWebContentsId, timeoutMs)

    const measurements = []
    for (const width of TARGET_WIDTHS) {
      await resizeRightSidebar(workbench, width, Math.min(timeoutMs, 15_000))
      const host = await readHostGeometry(workbench)
      const guest = await readGuestGeometry(electronApplication, guestWebContentsId)
      assertLayoutGeometry({ targetWidth: width, host, guest })
      measurements.push({ targetWidth: width, host, guest })
      if (EVIDENCE_WIDTHS.has(width)) {
        const guestPngBase64 = await electronApplication.evaluate(
          async ({ webContents }, guestId) => {
            const guest = webContents.fromId(guestId)
            if (!guest || guest.isDestroyed()) throw new Error(`Guest ${guestId} is unavailable for capture`)
            return (await guest.capturePage()).toPNG().toString('base64')
          },
          guestWebContentsId
        )
        await writeFile(
          join(evidenceRoot, `kun-video-editor-development-sidebar-${width}.png`),
          Buffer.from(guestPngBase64, 'base64')
        )
      }
    }

    process.stdout.write(
      `Development Kun Video Editor layout smoke OK (${process.platform}/${process.arch}): ` +
      `${measurements.map(({ targetWidth, host, guest }) =>
        `${targetWidth}px host=${Math.round(host.width)}x${Math.round(host.height)} ` +
        `guest=${guest.innerWidth}x${guest.innerHeight} scroll=${guest.scrollWidth}`
      ).join('; ')}; development=${extensionRoot}; evidence=${evidenceRoot}\n`
    )
  } catch (error) {
    primaryError = error
  } finally {
    if (electronApplication) {
      await electronApplication.close().catch((error) => cleanupErrors.push(error))
    }
    if (electronProcess && !electronProcess.killed) {
      await terminateProcessTree(electronProcess, process.platform, {
        timeoutMs: 15_000,
        ports: [runtimePort]
      }).catch((error) => cleanupErrors.push(error))
    }
    if (rendererProcess) {
      await terminateProcessTree(rendererProcess, process.platform, {
        timeoutMs: 15_000,
        ports: [rendererPort]
      }).catch((error) => cleanupErrors.push(error))
    }
    await waitForPortsClosed([runtimePort, rendererPort], 2_000)
      .catch((error) => cleanupErrors.push(error))
    if (process.env.KUN_KEEP_DEVELOPMENT_VIDEO_EDITOR_LAYOUT_SMOKE === '1') {
      process.stderr.write(`Preserved development layout profile: ${temporaryRoot}\n`)
      process.stderr.write(`Preserved development layout workspace: ${workspaceRoot}\n`)
    } else {
      await Promise.all([temporaryRoot, workspaceRoot].map(async (path) => {
        await makeTreeWritable(path).catch(() => undefined)
        await rm(path, { recursive: true, force: true }).catch((error) => cleanupErrors.push(error))
      }))
    }
  }

  if (primaryError || cleanupErrors.length > 0) {
    const message = primaryError instanceof Error
      ? primaryError.stack ?? primaryError.message
      : primaryError === undefined
        ? 'Development layout smoke cleanup failed'
        : String(primaryError)
    const cleanup = cleanupErrors.length > 0
      ? `\nCleanup failures:\n${cleanupErrors.map(String).join('\n')}`
      : ''
    const renderer = rendererOutput.trim()
      ? `\nRenderer development server output (tail):\n${rendererOutput.trim()}`
      : ''
    throw new Error(`${message}${cleanup}${renderer}`)
  }
}

function runRepositoryKun(args, repositoryRoot, environment, timeoutMs) {
  const cli = join(repositoryRoot, 'examples', 'extensions', 'run-repository-kun-cli.mjs')
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    env: environment,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Repository Kun CLI failed (${result.signal ?? result.status ?? 'unknown'}): ` +
      `${String(result.stderr || result.stdout).trim().slice(-8_000)}`
    )
  }
}

async function grantDevelopmentWorkspaceTrust(modulePath, profile, workspaceRoot) {
  const extensionModule = await import(
    `${pathToFileURL(modulePath).href}?development-layout=${Date.now()}-${Math.random()}`
  )
  const paths = new extensionModule.ExtensionPaths({
    packageRoot: join(profile, 'extensions'),
    dataRoot: join(profile, 'extension-data')
  })
  const registry = new extensionModule.ExtensionRegistry(paths)
  const entry = await registry.get(EXTENSION_ID)
  const active = entry?.useDevelopment ? entry.development : undefined
  if (!active || active.manifest.version !== EXTENSION_VERSION || !active.mutable) {
    throw new Error(`Development layout smoke expected mutable ${EXTENSION_ID} ${EXTENSION_VERSION}`)
  }
  const workspaceKey = paths.workspaceKey(workspaceRoot)
  await registry.setWorkspaceEnabled(EXTENSION_ID, workspaceKey, true)
  await registry.setWorkspacePermissionGrant(
    EXTENSION_ID,
    workspaceKey,
    [...active.grantedPermissions],
    active.manifest.version
  )
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise())
  })
  if (!port) throw new Error('Could not allocate a development layout smoke port')
  return port
}

async function waitForPortOpen(port, timeoutMs, state) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (state().exited) throw new Error(`Renderer development server exited before port ${port} opened`)
    if (await isPortOpen(port)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for renderer development server on port ${port}`)
}

function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(open)
    }
    socket.setTimeout(250, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.unref()
  })
}

function processState(child) {
  return {
    exited: child.exitCode !== null || child.signalCode !== null || child.killed,
    exitCode: child.exitCode,
    signalCode: child.signalCode
  }
}

function argumentValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function positiveIntegerArgument(name, fallback) {
  const raw = argumentValue(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
