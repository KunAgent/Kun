#!/usr/bin/env node

'use strict'

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { dirname, extname, join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeSettings,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  platformDesktopArguments,
  terminateProcessTree
} = require('./smoke-packaged-extension-desktop.cjs')
const { developmentRendererEnvironment } = require('./development-renderer-environment.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OPERATION_TIMEOUT_MS = 30_000
const MAX_CLEANUP_TIMEOUT_MS = 15_000

async function main() {
  const repositoryRoot = resolve(join(__dirname, '..'))
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const evidencePath = argumentValue('--evidence')
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable],
    ['Vite CLI', viteCli],
    ['renderer config', rendererConfig],
    ['built Main entry', mainEntry]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-graph-workbench-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'graph-workbench-'))
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let rendererProcess
  let electronApplication
  let electronProcess
  let rendererOutput = ''
  let electronOutput = ''
  try {
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(profile, { recursive: true }),
      mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }),
      mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true })
    ])
    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'en',
      theme: 'light'
    }
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
    rendererProcess = spawn(
      process.execPath,
      [viteCli, '--config', rendererConfig, '--logLevel', 'warn'],
      {
        cwd: repositoryRoot,
        env: isolatedEnvironment,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    rendererProcess.stdout?.on('data', (chunk) => {
      rendererOutput = `${rendererOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    rendererProcess.stderr?.on('data', (chunk) => {
      rendererOutput = `${rendererOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    await waitForPortOpen(rendererPort, timeoutMs, rendererProcess)

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
    electronProcess.stdout?.on('data', (chunk) => {
      electronOutput = `${electronOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    electronProcess.stderr?.on('data', (chunk) => {
      electronOutput = `${electronOutput}${String(chunk)}`.slice(-64 * 1024)
    })
    const operationTimeoutMs = Math.min(timeoutMs, MAX_OPERATION_TIMEOUT_MS)
    await withTimeout(
      electronApplication.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
        window?.setBounds({ x: 20, y: 20, width: 1200, height: 900 })
      }),
      operationTimeoutMs,
      'resizing the Graph workbench window'
    )
    const page = await findWorkbenchWindow(electronApplication, timeoutMs)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1_000)
    // Graph is lazy in the production workbench. The first development import
    // can make Vite optimize @xyflow/react and reload the renderer. Warm that
    // dependency before mounting so a reload cannot erase the smoke fixture.
    await withTimeout(
      page.evaluate(async () => {
        await import('/src/components/graph/GraphWorkbenchSmokeFixture.tsx')
      }),
      operationTimeoutMs,
      'warming the Graph workbench fixture'
    ).catch(() => undefined)
    await page.waitForTimeout(1_500)
    await page.waitForLoadState('domcontentloaded')
    await withTimeout(
      page.evaluate(async () => {
        const fixture = await import('/src/components/graph/GraphWorkbenchSmokeFixture.tsx')
        fixture.mountGraphWorkbenchSmokeFixture(1060)
      }),
      operationTimeoutMs,
      'mounting the Graph workbench fixture'
    )
    const canvas = page.locator('[data-graph-interaction-root]')
    await canvas.waitFor({ state: 'visible', timeout: timeoutMs })
    await page.waitForTimeout(500)
    const visibleText = await page.locator('body').innerText()
    if (/token (?:budget|ceiling|limit)/iu.test(visibleText)) {
      throw new Error('Graph workbench still exposes a token budget or ceiling')
    }

    const appRegion = await page.locator('.graph-run-canvas').evaluate((element) =>
      getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    if (appRegion.trim() !== 'no-drag') {
      throw new Error(`Graph canvas is still inside Electron drag region: ${appRegion || 'unset'}`)
    }
    const inspector = page.locator('.graph-run-inspector')
    if (await inspector.isVisible()) {
      throw new Error('A preselected Graph node unexpectedly opened the inspector')
    }

    const viewport = page.locator('.graph-run-canvas .react-flow__viewport')
    const pane = page.locator('.graph-run-canvas .react-flow__pane')
    const viewportBeforePan = await viewport.getAttribute('style')
    const paneBox = await pane.boundingBox()
    if (!paneBox) throw new Error('Graph pane has no pointer target')
    await page.mouse.move(paneBox.x + paneBox.width * 0.55, paneBox.y + paneBox.height * 0.68)
    await page.mouse.down()
    await page.mouse.move(
      paneBox.x + paneBox.width * 0.55 + 110,
      paneBox.y + paneBox.height * 0.68 + 56,
      { steps: 10 }
    )
    await page.mouse.up()
    await page.waitForTimeout(120)
    const viewportAfterPan = await viewport.getAttribute('style')
    if (viewportBeforePan === viewportAfterPan) {
      throw new Error(`Hand drag did not change the React Flow viewport: ${viewportAfterPan}`)
    }

    await page.mouse.move(paneBox.x + paneBox.width * 0.48, paneBox.y + paneBox.height * 0.52)
    const viewportBeforeZoom = await viewport.getAttribute('style')
    await page.mouse.wheel(0, -520)
    await page.waitForTimeout(180)
    const viewportAfterZoom = await viewport.getAttribute('style')
    if (viewportBeforeZoom === viewportAfterZoom) {
      throw new Error(`Wheel input did not zoom the Graph viewport: ${viewportAfterZoom}`)
    }

    const viewportBeforeMinimap = await viewport.getAttribute('style')
    const minimapBox = await page.locator('.graph-run-canvas .react-flow__minimap').boundingBox()
    if (!minimapBox) throw new Error('Graph minimap has no pointer target')
    await page.mouse.move(minimapBox.x + minimapBox.width * 0.48, minimapBox.y + minimapBox.height * 0.52)
    await page.mouse.down()
    await page.mouse.move(
      minimapBox.x + minimapBox.width * 0.62,
      minimapBox.y + minimapBox.height * 0.62,
      { steps: 8 }
    )
    await page.mouse.up()
    await page.waitForTimeout(120)
    const viewportAfterMinimap = await viewport.getAttribute('style')
    if (viewportBeforeMinimap === viewportAfterMinimap) {
      throw new Error(`Minimap drag did not pan the Graph viewport: ${viewportAfterMinimap}`)
    }

    const viewportBeforeFit = await viewport.getAttribute('style')
    await page.getByRole('button', { name: 'Fit graph to view' }).click()
    await page.waitForTimeout(300)
    const viewportAfterFit = await viewport.getAttribute('style')
    if (viewportBeforeFit === viewportAfterFit) {
      throw new Error(`Fit view did not reconcile the Graph viewport: ${viewportAfterFit}`)
    }

    await page.getByRole('button', { name: 'Select and move nodes' }).click()
    const node = page.locator('.react-flow__node[data-id="research"]')
    const nodeBefore = await node.getAttribute('style')
    const nodeBox = await node.boundingBox()
    if (!nodeBox) throw new Error('Graph node has no pointer target')
    await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 96, nodeBox.y + nodeBox.height / 2 + 42, {
      steps: 10
    })
    await page.mouse.up()
    await page.waitForTimeout(120)
    const nodeAfter = await node.getAttribute('style')
    if (nodeBefore === nodeAfter) {
      throw new Error(`Select drag did not change the Graph node position: ${nodeAfter}`)
    }

    if (await inspector.isVisible()) {
      throw new Error('Dragging a Graph node unexpectedly opened the inspector')
    }
    await node.click()
    await page.waitForTimeout(120)
    if (await inspector.isVisible()) {
      throw new Error('Single-clicking a Graph node unexpectedly opened the inspector')
    }
    const viewportBeforeInspect = await viewport.getAttribute('style')
    await node.dblclick()
    await inspector.waitFor({ state: 'visible' })
    const viewportAfterInspect = await viewport.getAttribute('style')
    if (viewportBeforeInspect !== viewportAfterInspect) {
      throw new Error(
        `Double-click inspection unexpectedly changed the Graph viewport: ${viewportBeforeInspect} -> ${viewportAfterInspect}`
      )
    }
    await page.getByRole('button', { name: 'Execution' }).click()
    const inspectorWidthBeforeResize = (await inspector.boundingBox())?.width
    const separator = page.getByRole('separator', { name: 'Resize Graph details' })
    const separatorBox = await separator.boundingBox()
    if (!inspectorWidthBeforeResize || !separatorBox) {
      throw new Error('Wide Graph inspector has no resize target')
    }
    await page.mouse.move(separatorBox.x + separatorBox.width / 2, separatorBox.y + separatorBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(separatorBox.x - 52, separatorBox.y + separatorBox.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(120)
    const inspectorWidthAfterResize = (await inspector.boundingBox())?.width ?? 0
    if (inspectorWidthAfterResize <= inspectorWidthBeforeResize) {
      throw new Error(
        `Inspector divider did not increase width: ${inspectorWidthBeforeResize} -> ${inspectorWidthAfterResize}`
      )
    }
    if (evidencePath) {
      const absoluteEvidencePath = resolve(evidencePath)
      await mkdir(dirname(absoluteEvidencePath), { recursive: true })
      await page.screenshot({ path: absoluteEvidencePath })
    }
    await page.getByRole('button', { name: 'Close details' }).click()
    await inspector.waitFor({ state: 'hidden' })

    await withTimeout(
      page.evaluate(async () => {
        const fixture = await import('/src/components/graph/GraphWorkbenchSmokeFixture.tsx')
        fixture.setGraphWorkbenchSmokeWidth(680)
      }),
      operationTimeoutMs,
      'resizing the Graph workbench fixture'
    )
    await page.waitForTimeout(120)
    await node.dblclick()
    await inspector.waitFor({ state: 'visible' })
    const layout = await page.locator('.graph-run-workspace').getAttribute('data-inspector-layout')
    if (layout !== 'overlay') throw new Error(`Expected narrow overlay inspector, received ${layout}`)

    if (evidencePath) {
      const absoluteEvidencePath = resolve(evidencePath)
      const extension = extname(absoluteEvidencePath)
      const narrowPath = extension
        ? `${absoluteEvidencePath.slice(0, -extension.length)}-narrow${extension}`
        : `${absoluteEvidencePath}-narrow.png`
      await page.screenshot({ path: narrowPath })
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      platform: process.platform,
      appRegion: appRegion.trim(),
      pan: { before: viewportBeforePan, after: viewportAfterPan },
      zoom: { before: viewportBeforeZoom, after: viewportAfterZoom },
      minimap: { before: viewportBeforeMinimap, after: viewportAfterMinimap },
      fitView: { before: viewportBeforeFit, after: viewportAfterFit },
      nodeDrag: { before: nodeBefore, after: nodeAfter },
      inspectorGesture: {
        preselectedOpened: false,
        dragOpened: false,
        singleClickOpened: false,
        doubleClickOpened: true,
        doubleClickZoomed: false
      },
      tokenCeilingVisible: false,
      inspectorResize: {
        before: inspectorWidthBeforeResize,
        after: inspectorWidthAfterResize
      },
      narrowInspector: layout
    }, null, 2) + '\n')
  } catch (error) {
    const diagnostics = [
      rendererOutput.trim() ? `Renderer output:\n${rendererOutput.trim()}` : '',
      electronOutput.trim() ? `Electron output:\n${electronOutput.trim()}` : ''
    ].filter(Boolean).join('\n\n')
    throw new Error(`${error instanceof Error ? error.stack ?? error.message : String(error)}${
      diagnostics ? `\n\n${diagnostics}` : ''
    }`)
  } finally {
    await cleanupGraphWorkbenchProcesses({
      electronApplication,
      electronProcess,
      rendererProcess
    })
    await Promise.all([
      makeTreeWritable(temporaryRoot),
      makeTreeWritable(workspaceRoot)
    ]).catch(() => undefined)
    await withTimeout(
      Promise.all([
        rm(temporaryRoot, {
          recursive: true,
          force: true,
          maxRetries: 8,
          retryDelay: 250
        }),
        rm(workspaceRoot, {
          recursive: true,
          force: true,
          maxRetries: 8,
          retryDelay: 250
        })
      ]),
      MAX_CLEANUP_TIMEOUT_MS,
      'removing Graph workbench smoke directories'
    )
  }
}

async function withTimeout(operation, timeoutMs, description) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out while ${description}`)),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function cleanupGraphWorkbenchProcesses({
  electronApplication,
  electronProcess,
  rendererProcess,
  platform = process.platform,
  terminate = terminateProcessTree,
  closeTimeoutMs = MAX_CLEANUP_TIMEOUT_MS
}) {
  const terminateOptions = {
    timeoutMs: MAX_CLEANUP_TIMEOUT_MS,
    detached: platform !== 'win32'
  }

  // Playwright's close can wait forever while its Electron process is still
  // alive. Stop the process tree first so its transport can close.
  if (electronProcess) {
    await terminate(electronProcess, platform, terminateOptions).catch(() => undefined)
  }
  if (electronApplication) {
    await withTimeout(
      Promise.resolve().then(() => electronApplication.close()),
      closeTimeoutMs,
      'closing the Graph workbench Electron application'
    ).catch(() => undefined)
  }
  if (rendererProcess) {
    await terminate(rendererProcess, platform, terminateOptions).catch(() => undefined)
  }
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
  if (!port) throw new Error('Could not allocate a Graph workbench smoke port')
  return port
}

async function waitForPortOpen(port, timeoutMs, process) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) {
      throw new Error(`Renderer exited before port ${port} opened`)
    }
    if (await isPortOpen(port)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for renderer port ${port}`)
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

module.exports = { cleanupGraphWorkbenchProcesses, withTimeout }
