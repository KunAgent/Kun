#!/usr/bin/env node

'use strict'

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const sharp = require('sharp')
const { makeTreeWritable } = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeSettings,
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
  findWorkbenchWindow
} = require('./smoke-packaged-video-editor-desktop.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const PROCESS_OUTPUT_LIMIT = 128 * 1024
const WIDE_BOUNDS = Object.freeze({ width: 1_800, height: 1_100 })
const NARROW_BOUNDS = Object.freeze({ width: 960, height: 900 })
const UI_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/
const OVERFLOW_TOLERANCE_PX = 1
const CONTENT_COLUMN_CLEARANCE_PX = 32
const SCENE_CONTENT_CLEARANCE_PX = 16

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: node scripts/smoke-development-ui-plugin-layout.cjs ' +
      '--plugins-root <directory> --evidence-dir <directory> ' +
      '[--ids id-one,id-two] [--timeout-ms 120000] [--repository-root <directory>]\n'
    )
    return
  }

  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const repositoryRoot = resolve(argumentValue('--repository-root') ?? join(__dirname, '..'))
  const pluginsRoot = resolve(requiredArgumentValue('--plugins-root'))
  const evidenceRoot = resolve(requiredArgumentValue('--evidence-dir'))
  const requestedIds = commaSeparatedIdsArgument('--ids')
  const plugins = await discoverPlugins(pluginsRoot, requestedIds)
  assertPresentationPluginsReady(plugins)

  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable],
    ['Vite CLI', viteCli],
    ['development renderer config', rendererConfig],
    ['built development Main entry', mainEntry]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-development-ui-plugin-layout-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const installedPluginsRoot = join(home, '.kun', 'ui-plugins')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'ui-plugin-development-layout-'))
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let electronApplication
  let electronProcess
  let rendererProcess
  let rendererOutput = ''
  let electronOutput = ''
  let primaryError
  const cleanupErrors = []
  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    pluginsRoot,
    evidenceRoot,
    wideWindow: WIDE_BOUNDS,
    narrowWindow: NARROW_BOUNDS,
    themes: []
  }

  try {
    await Promise.all([
      mkdir(profile, { recursive: true }),
      mkdir(installedPluginsRoot, { recursive: true }),
      mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }),
      mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(evidenceRoot, { recursive: true })
    ])
    await Promise.all(plugins.map(async (plugin) => {
      await cp(plugin.sourceDir, join(installedPluginsRoot, plugin.id), {
        recursive: true,
        force: true
      })
    }))

    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'zh',
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
    const appendRendererOutput = (chunk) => {
      rendererOutput = `${rendererOutput}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT)
    }
    rendererProcess.stdout?.on('data', appendRendererOutput)
    rendererProcess.stderr?.on('data', appendRendererOutput)
    rendererProcess.once('error', (error) => {
      appendRendererOutput(`\nrenderer launch error: ${String(error)}\n`)
    })
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
    const appendElectronOutput = (chunk) => {
      electronOutput = `${electronOutput}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT)
    }
    electronProcess.stdout?.on('data', appendElectronOutput)
    electronProcess.stderr?.on('data', appendElectronOutput)

    let workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
    await workbench.evaluate(() => {
      localStorage.setItem('kun.layout.leftSidebarCollapsed', '0')
      localStorage.setItem('kun.focusMode', '0')
    })
    // On macOS the OS may clamp an initial 1800px BrowserWindow to the work
    // area while Electron still accepts later renderer surface resizes. Prime
    // the minimum-size layout first so every theme, including the first one,
    // receives the same requested wide renderer surface and capture size.
    await setWorkbenchBounds(electronApplication, NARROW_BOUNDS)

    for (const plugin of plugins) {
      const wideWindowState = await setWorkbenchBounds(electronApplication, WIDE_BOUNDS, {
        emulateRequestedWidth: true
      })
      await workbench.evaluate((id) => {
        localStorage.setItem('kun.uiMode', id)
        localStorage.setItem('kun.ikunMode', id === 'ikun' ? '1' : '0')
        localStorage.setItem('kun.layout.leftSidebarCollapsed', '0')
        localStorage.setItem('kun.focusMode', '0')
      }, plugin.id)
      await workbench.reload({ waitUntil: 'domcontentloaded' })
      workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
      await waitForActivePresentation(workbench, plugin.id, timeoutMs)
      await workbench.waitForTimeout(250)

      const wide = await readLayoutSnapshot(workbench)
      assertWidePresentation(plugin.id, wide)
      const screenshotPath = join(evidenceRoot, `${plugin.id}-kun-ui-plugin.png`)
      await captureWorkbench(electronApplication, screenshotPath)

      const narrowWindowState = await setWorkbenchBounds(electronApplication, NARROW_BOUNDS)
      await waitForNarrowPresentationHidden(workbench, plugin.id, timeoutMs)
      await workbench.waitForTimeout(150)
      const narrow = await readLayoutSnapshot(workbench)
      assertNarrowPresentation(plugin.id, narrow)

      report.themes.push({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        screenshotPath,
        wideWindowState,
        narrowWindowState,
        wide,
        narrow
      })
      await writeReport(evidenceRoot, report)
      process.stdout.write(formatThemeResult(plugin.id, wide, narrow, screenshotPath))
    }

    report.overviewPath = await writeOverview(evidenceRoot, plugins)
    const reportPath = await writeReport(evidenceRoot, report)
    process.stdout.write(
      `Development Kun UI Plugin layout smoke OK (${process.platform}/${process.arch}): ` +
      `${plugins.length} theme(s); evidence=${evidenceRoot}; report=${reportPath}\n`
    )
  } catch (error) {
    primaryError = error
    if (existsSync(evidenceRoot)) {
      await writeReport(evidenceRoot, {
        ...report,
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      }).catch((reportError) => cleanupErrors.push(reportError))
    }
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

    if (process.env.KUN_KEEP_DEVELOPMENT_UI_PLUGIN_LAYOUT_SMOKE === '1') {
      process.stderr.write(`Preserved development UI Plugin profile: ${temporaryRoot}\n`)
      process.stderr.write(`Preserved development UI Plugin workspace: ${workspaceRoot}\n`)
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
        ? 'Development UI Plugin layout smoke cleanup failed'
        : String(primaryError)
    const cleanup = cleanupErrors.length > 0
      ? `\nCleanup failures:\n${cleanupErrors.map(String).join('\n')}`
      : ''
    const renderer = rendererOutput.trim()
      ? `\nRenderer development server output (tail):\n${rendererOutput.trim()}`
      : ''
    const electron = electronOutput.trim()
      ? `\nElectron output (tail):\n${electronOutput.trim()}`
      : ''
    throw new Error(`${message}${cleanup}${renderer}${electron}`)
  }
}

async function discoverPlugins(pluginsRoot, requestedIds) {
  const details = await stat(pluginsRoot).catch(() => null)
  if (!details?.isDirectory()) throw new Error(`--plugins-root must be a directory: ${pluginsRoot}`)

  const rootManifest = join(pluginsRoot, 'manifest.json')
  const candidates = existsSync(rootManifest)
    ? [pluginsRoot]
    : (await readdir(pluginsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => join(pluginsRoot, entry.name))
        .filter((directory) => existsSync(join(directory, 'manifest.json')))

  const plugins = []
  const ids = new Set()
  for (const sourceDir of candidates) {
    const manifestPath = join(sourceDir, 'manifest.json')
    let manifest
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch (error) {
      throw new Error(
        `Cannot parse UI Plugin manifest ${manifestPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      )
    }
    const id = typeof manifest?.id === 'string' ? manifest.id.trim().toLowerCase() : ''
    if (!UI_PLUGIN_ID_PATTERN.test(id)) {
      throw new Error(`Invalid UI Plugin id in ${manifestPath}: ${JSON.stringify(manifest?.id)}`)
    }
    if (ids.has(id)) throw new Error(`Duplicate UI Plugin id ${id} under ${pluginsRoot}`)
    ids.add(id)
    plugins.push({
      id,
      name: typeof manifest.name === 'string' ? manifest.name : id,
      version: typeof manifest.version === 'string' ? manifest.version : '',
      sourceDir,
      manifest
    })
  }

  if (plugins.length === 0) {
    throw new Error(`No direct child UI Plugin manifests found under ${pluginsRoot}`)
  }
  plugins.sort((left, right) => left.id.localeCompare(right.id))

  if (requestedIds.length === 0) return plugins
  const requested = new Set(requestedIds)
  const missing = requestedIds.filter((id) => !ids.has(id))
  if (missing.length > 0) {
    throw new Error(
      `--ids requested unknown UI Plugin(s): ${missing.join(', ')}; ` +
      `available: ${plugins.map((plugin) => plugin.id).join(', ')}`
    )
  }
  return plugins.filter((plugin) => requested.has(plugin.id))
}

function assertPresentationPluginsReady(plugins) {
  const unready = plugins.flatMap((plugin) => {
    const missing = []
    if (!plugin.manifest?.figures?.portrait) missing.push('figures.portrait')
    if (!plugin.manifest?.presentation) missing.push('presentation')
    return missing.length > 0 ? [`${plugin.id} (${missing.join(' + ')})`] : []
  })
  if (unready.length > 0) {
    throw new Error(
      'The UI Plugin layout smoke requires presentation-ready character themes. ' +
      `Missing fields: ${unready.join(', ')}`
    )
  }
}

async function setWorkbenchBounds(electronApplication, bounds, options = {}) {
  return electronApplication.evaluate(async ({ BrowserWindow }, request) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('Kun development workbench BrowserWindow is unavailable')
    window.webContents.setZoomFactor(1)
    const current = window.getBounds()
    window.setBounds({ ...current, width: request.bounds.width, height: request.bounds.height }, false)
    window.show()
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    const nativeBounds = window.getBounds()
    const nativeViewport = await window.webContents.executeJavaScript(
      '({ width: window.innerWidth, height: window.innerHeight })',
      true
    )
    const zoomFactor = request.emulateRequestedWidth && nativeViewport.width < request.bounds.width
      ? Math.max(0.5, nativeViewport.width / request.bounds.width)
      : 1
    if (zoomFactor !== 1) {
      window.webContents.setZoomFactor(zoomFactor)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    }
    const effectiveViewport = await window.webContents.executeJavaScript(
      '({ width: window.innerWidth, height: window.innerHeight })',
      true
    )
    return {
      requestedBounds: request.bounds,
      nativeBounds,
      nativeViewport,
      zoomFactor,
      effectiveViewport
    }
  }, { bounds, emulateRequestedWidth: options.emulateRequestedWidth === true })
}

async function waitForActivePresentation(workbench, id, timeoutMs) {
  await workbench.waitForFunction((expectedId) => {
    const root = document.documentElement
    const image = document.querySelector('.ds-ui-plugin-character')
    const sceneArtwork = [...document.querySelectorAll('.ds-ui-plugin-scene-artwork')]
    const timeline = document.querySelector('.ds-message-timeline-content')
    const style = document.querySelector('#kun-ui-plugin-theme-cdp')
    const sceneReady = root.getAttribute('data-ui-plugin-scene') !== 'on' || (
      Boolean(root.getAttribute('data-ui-plugin-scene-layout')) &&
      sceneArtwork.length > 0 &&
      sceneArtwork.every((candidate) => (
        candidate instanceof HTMLImageElement &&
        candidate.complete &&
        candidate.naturalWidth > 0 &&
        candidate.naturalHeight > 0
      ))
    )
    return (
      root.getAttribute('data-ui-plugin') === expectedId &&
      root.getAttribute('data-ui-plugin-cdp') === expectedId &&
      root.getAttribute('data-ui-plugin-presentation') === 'on' &&
      style instanceof HTMLStyleElement &&
      style.getAttribute('data-ui-plugin-id') === expectedId &&
      timeline instanceof HTMLElement &&
      image instanceof HTMLImageElement &&
      image.complete &&
      image.naturalWidth > 0 &&
      image.naturalHeight > 0 &&
      sceneReady
    )
  }, id, { timeout: timeoutMs })
}

async function waitForNarrowPresentationHidden(workbench, id, timeoutMs) {
  await workbench.waitForFunction((expectedId) => {
    const root = document.documentElement
    const layers = [...document.querySelectorAll(
      '.ds-ui-plugin-decor-layer, .ds-ui-plugin-character-layer, ' +
      '.ds-ui-plugin-readability-scrim, .ds-ui-plugin-scene-stage-layer, ' +
      '.ds-ui-plugin-scene-visual-zone'
    )]
    if (layers.length === 0) return false
    return (
      root.getAttribute('data-ui-plugin') === expectedId &&
      root.getAttribute('data-ui-plugin-cdp') === expectedId &&
      layers.every((layer) => (
        layer instanceof HTMLElement &&
        getComputedStyle(layer).display === 'none' &&
        layer.getBoundingClientRect().width === 0
      ))
    )
  }, id, { timeout: timeoutMs })
}

async function readLayoutSnapshot(workbench) {
  return workbench.evaluate(() => {
    const root = document.documentElement
    const rect = (element) => {
      if (!(element instanceof Element)) return null
      const value = element.getBoundingClientRect()
      return {
        x: round(value.x),
        y: round(value.y),
        width: round(value.width),
        height: round(value.height),
        right: round(value.right),
        bottom: round(value.bottom)
      }
    }
    const style = (element) => {
      if (!(element instanceof Element)) return null
      const value = getComputedStyle(element)
      return {
        display: value.display,
        visibility: value.visibility,
        opacity: value.opacity,
        overflowX: value.overflowX,
        pointerEvents: value.pointerEvents,
        zIndex: value.zIndex,
        translate: value.translate,
        transform: value.transform
      }
    }
    const elementSnapshot = (selector) => {
      const element = document.querySelector(selector)
      return { selector, rect: rect(element), style: style(element) }
    }
    const overflow = (selector, element) => ({
      selector,
      clientWidth: element ? element.clientWidth : 0,
      scrollWidth: element ? element.scrollWidth : 0,
      excess: element ? Math.max(0, element.scrollWidth - element.clientWidth) : 0
    })
    const character = document.querySelector('.ds-ui-plugin-character')
    const characterLayer = document.querySelector(
      '.ds-ui-plugin-scene-visual-zone, .ds-ui-plugin-character-layer'
    )
    const sceneArtwork = [...document.querySelectorAll('.ds-ui-plugin-scene-artwork')]
    const stage = document.querySelector('.ds-chat-stage')
    const composer = document.querySelector('.ds-floating-composer')
    const cdpStyle = document.querySelector('#kun-ui-plugin-theme-cdp')
    const attributes = Object.fromEntries(
      root.getAttributeNames()
        .filter((name) => name.startsWith('data-ui-plugin') || name === 'data-focus-mode')
        .sort()
        .map((name) => [name, root.getAttribute(name)])
    )

    return {
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      attributes,
      cdpStyle: {
        present: cdpStyle instanceof HTMLStyleElement,
        pluginId: cdpStyle?.getAttribute('data-ui-plugin-id') ?? null,
        textLength: cdpStyle?.textContent?.length ?? 0
      },
      character: {
        ...elementSnapshot('.ds-ui-plugin-character'),
        complete: character instanceof HTMLImageElement ? character.complete : false,
        naturalWidth: character instanceof HTMLImageElement ? character.naturalWidth : 0,
        naturalHeight: character instanceof HTMLImageElement ? character.naturalHeight : 0,
        sourceKind: character instanceof HTMLImageElement
          ? character.currentSrc.startsWith('data:image/') ? 'data-image' : 'other'
          : 'missing',
        visible: character instanceof HTMLElement
          ? character.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : false,
        topmostAtCenter: character instanceof HTMLElement && characterLayer instanceof HTMLElement
          ? characterIsTopmostAtCenter(character, characterLayer)
          : false
      },
      sceneArtwork: {
        count: sceneArtwork.length,
        decoded: sceneArtwork.filter((candidate) => (
          candidate instanceof HTMLImageElement &&
          candidate.complete &&
          candidate.naturalWidth > 0 &&
          candidate.naturalHeight > 0
        )).length
      },
      stage: elementSnapshot('.ds-chat-stage'),
      layers: {
        decor: elementSnapshot('.ds-ui-plugin-decor-layer'),
        character: elementSnapshot('.ds-ui-plugin-character-layer'),
        scrim: elementSnapshot('.ds-ui-plugin-readability-scrim'),
        sceneStage: elementSnapshot('.ds-ui-plugin-scene-stage-layer'),
        sceneVisual: elementSnapshot('.ds-ui-plugin-scene-visual-zone')
      },
      content: {
        stageContent: elementSnapshot('.ds-ui-plugin-stage-content'),
        timeline: elementSnapshot('.ds-message-timeline-content'),
        composer: {
          ...elementSnapshot('.ds-floating-composer'),
          topmostAtCenter: elementOwnsTopmostAtCenter(composer)
        },
        sidebar: elementSnapshot('.ds-sidebar-shell'),
        topbar: elementSnapshot('.ds-topbar-surface')
      },
      overflow: [
        overflow('html', document.documentElement),
        overflow('body', document.body),
        overflow('.ds-workbench-shell', document.querySelector('.ds-workbench-shell')),
        overflow('.ds-chat-stage', stage),
        overflow('.ds-ui-plugin-stage-content', document.querySelector('.ds-ui-plugin-stage-content'))
      ]
    }

    function round(value) {
      return Math.round(value * 100) / 100
    }

    function characterIsTopmostAtCenter(image, layer) {
      const bounds = image.getBoundingClientRect()
      const previousImagePointerEvents = image.style.pointerEvents
      const previousLayerPointerEvents = layer.style.pointerEvents
      image.style.pointerEvents = 'auto'
      layer.style.pointerEvents = 'auto'
      const topmost = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      image.style.pointerEvents = previousImagePointerEvents
      layer.style.pointerEvents = previousLayerPointerEvents
      return topmost === image
    }

    function elementOwnsTopmostAtCenter(element) {
      if (!(element instanceof HTMLElement)) return false
      const bounds = element.getBoundingClientRect()
      const topmost = document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2
      )
      return topmost instanceof Element && element.contains(topmost)
    }
  })
}

function assertWidePresentation(id, snapshot) {
  assertThemeIdentity(id, snapshot)
  const sceneEnabled = snapshot.attributes['data-ui-plugin-scene'] === 'on'
  const sceneLayout = snapshot.attributes['data-ui-plugin-scene-layout']
  const sceneForeground = sceneEnabled && (
    sceneLayout === 'rail-right' ||
    sceneLayout === 'rail-left' ||
    sceneLayout === 'card-right' ||
    sceneLayout === 'card-left'
  )
  if (snapshot.attributes['data-ui-plugin-presentation'] !== 'on') {
    throw new Error(`${id}: data-ui-plugin-presentation is not on`)
  }
  if (!snapshot.cdpStyle.present || snapshot.cdpStyle.pluginId !== id || snapshot.cdpStyle.textLength <= 0) {
    throw new Error(`${id}: host CDP theme style is missing or empty`)
  }
  if (
    !snapshot.character.complete ||
    snapshot.character.naturalWidth <= 0 ||
    snapshot.character.naturalHeight <= 0 ||
    snapshot.character.sourceKind !== 'data-image'
  ) {
    throw new Error(`${id}: portrait image did not decode from a validated data-image source`)
  }
  if (!snapshot.character.visible || !hasArea(snapshot.character.rect)) {
    throw new Error(`${id}: portrait is not visible in the wide Kun workbench`)
  }
  if (!sceneEnabled && !snapshot.character.topmostAtCenter) {
    throw new Error(`${id}: portrait is geometrically visible but occluded at its center`)
  }

  if (sceneEnabled) {
    if (!sceneLayout) throw new Error(`${id}: declarative scene layout marker is missing`)
    if (snapshot.sceneArtwork.count <= 0 || snapshot.sceneArtwork.decoded !== snapshot.sceneArtwork.count) {
      throw new Error(
        `${id}: declarative scene artwork did not decode ` +
        `(${snapshot.sceneArtwork.decoded}/${snapshot.sceneArtwork.count})`
      )
    }
    for (const name of ['sceneStage', 'sceneVisual']) {
      const layer = snapshot.layers[name]
      if (layer.style?.display === 'none' || !hasArea(layer.rect)) {
        throw new Error(`${id}: ${name} layer is hidden in the wide Kun workbench`)
      }
    }
    if (sceneForeground) {
      assertSceneContentClearance(id, sceneLayout, snapshot)
    }
  } else {
    const reserve = snapshot.attributes['data-ui-plugin-content-reserve']
    if (
      reserve !== 'none' &&
      rectanglesOverlap(snapshot.character.rect, snapshot.content.composer.rect)
    ) {
      throw new Error(`${id}: ${reserve} content reserve still overlaps the Composer`)
    }
    if (
      reserve !== 'none' &&
      snapshot.character.rect.x - snapshot.content.composer.rect.right < CONTENT_COLUMN_CLEARANCE_PX
    ) {
      throw new Error(
        `${id}: ${reserve} content reserve leaves less than ` +
        `${CONTENT_COLUMN_CLEARANCE_PX}px between the Kun content column and portrait`
      )
    }
    if (snapshot.layers.character.style?.display === 'none' || !hasArea(snapshot.layers.character.rect)) {
      throw new Error(`${id}: character layer is hidden in the wide Kun workbench`)
    }
  }

  const contentZIndex = numericZIndex(snapshot.content.stageContent.style?.zIndex)
  const layersBelowContent = sceneEnabled
    ? ['sceneStage', 'sceneVisual', 'scrim']
    : ['decor', 'scrim']
  for (const name of layersBelowContent) {
    const layer = snapshot.layers[name]
    const layerZIndex = numericZIndex(layer.style?.zIndex)
    if (layerZIndex === null || contentZIndex === null || layerZIndex >= contentZIndex) {
      throw new Error(
        `${id}: ${name} presentation z-index ${layer.style?.zIndex ?? 'missing'} must stay below ` +
        `Kun content z-index ${snapshot.content.stageContent.style?.zIndex ?? 'missing'}`
      )
    }
  }
  for (const [name, layer] of Object.entries(snapshot.layers)) {
    if (layer.style && layer.style.pointerEvents !== 'none') {
      throw new Error(`${id}: ${name} presentation layer can intercept pointer input`)
    }
  }
  if (!snapshot.content.composer.topmostAtCenter) {
    throw new Error(`${id}: Composer does not own the topmost hit target at its center`)
  }
  const topbarCollisionBounds = sceneEnabled
    ? snapshot.layers.sceneVisual.rect
    : snapshot.character.rect
  if (rectanglesOverlap(topbarCollisionBounds, snapshot.content.topbar.rect)) {
    throw new Error(`${id}: portrait overlaps the Kun top bar`)
  }
  if (!hasArea(snapshot.stage.rect)) throw new Error(`${id}: Kun chat stage is unavailable`)
  const widthRatio = snapshot.character.rect.width / snapshot.stage.rect.width
  if ((!sceneEnabled || sceneForeground) && widthRatio > 0.8) {
    throw new Error(`${id}: portrait occupies ${formatPercent(widthRatio)} of stage width (maximum 80%)`)
  }
  assertNoHorizontalOverflow(id, 'wide', snapshot)
}

function assertNarrowPresentation(id, snapshot) {
  assertThemeIdentity(id, snapshot)
  for (const [name, layer] of Object.entries(snapshot.layers)) {
    if (layer.style && (layer.style.display !== 'none' || hasArea(layer.rect))) {
      throw new Error(`${id}: ${name} presentation layer remains visible in narrow mode`)
    }
  }
  if (snapshot.character.visible || hasArea(snapshot.character.rect)) {
    throw new Error(`${id}: portrait remains visible in narrow mode`)
  }
  assertNoHorizontalOverflow(id, 'narrow', snapshot)
}

function assertSceneContentClearance(id, layout, snapshot) {
  const visual = snapshot.layers.sceneVisual.rect
  if (!visual) throw new Error(`${id}: scene visual zone geometry is unavailable`)
  for (const [name, content] of [
    ['message timeline', snapshot.content.timeline.rect],
    ['Composer', snapshot.content.composer.rect]
  ]) {
    // The empty/new-conversation route may not mount timeline content yet;
    // Composer geometry is always authoritative for the interactive column.
    if (!content && name === 'message timeline') continue
    if (!content) throw new Error(`${id}: ${name} geometry is unavailable`)
    if (rectanglesOverlap(visual, content)) {
      throw new Error(`${id}: ${layout} scene visual zone overlaps the ${name}`)
    }
    const horizontalClearance = layout.endsWith('-left')
      ? content.x - visual.right
      : visual.x - content.right
    const verticalClearance = Math.max(
      content.y - visual.bottom,
      visual.y - content.bottom
    )
    const clearance = Math.max(horizontalClearance, verticalClearance)
    if (clearance < SCENE_CONTENT_CLEARANCE_PX) {
      throw new Error(
        `${id}: ${layout} leaves ${Math.round(clearance)}px effective clearance between the ` +
        'scene visual zone and ' +
        `${name} (minimum ${SCENE_CONTENT_CLEARANCE_PX}px)`
      )
    }
  }
}

function assertThemeIdentity(id, snapshot) {
  if (snapshot.attributes['data-ui-plugin'] !== id) {
    throw new Error(`${id}: renderer active plugin attribute is ${snapshot.attributes['data-ui-plugin'] ?? 'missing'}`)
  }
  if (snapshot.attributes['data-ui-plugin-cdp'] !== id) {
    throw new Error(`${id}: CDP plugin marker is ${snapshot.attributes['data-ui-plugin-cdp'] ?? 'missing'}`)
  }
  if (snapshot.attributes['data-focus-mode'] !== 'off') {
    throw new Error(`${id}: focus mode must be off during visual layout smoke`)
  }
}

function assertNoHorizontalOverflow(id, viewport, snapshot) {
  const offenders = snapshot.overflow.filter((entry) => (
    entry.clientWidth > 0 && entry.excess > OVERFLOW_TOLERANCE_PX
  ))
  if (offenders.length > 0) {
    throw new Error(
      `${id}: ${viewport} horizontal overflow: ` +
      offenders.map((entry) => `${entry.selector} +${entry.excess}px`).join(', ')
    )
  }
}

function hasArea(rect) {
  return Boolean(rect && rect.width > 0 && rect.height > 0)
}

function numericZIndex(value) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function rectanglesOverlap(left, right) {
  if (!left || !right) return false
  return (
    left.x < right.right - OVERFLOW_TOLERANCE_PX &&
    left.right > right.x + OVERFLOW_TOLERANCE_PX &&
    left.y < right.bottom - OVERFLOW_TOLERANCE_PX &&
    left.bottom > right.y + OVERFLOW_TOLERANCE_PX
  )
}

async function captureWorkbench(electronApplication, outputPath) {
  const pngBase64 = await electronApplication.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
    if (!window) throw new Error('Kun development workbench BrowserWindow is unavailable for capture')
    return (await window.capturePage()).toPNG().toString('base64')
  })
  await writeFile(outputPath, Buffer.from(pngBase64, 'base64'))
}

async function writeReport(evidenceRoot, report) {
  const reportPath = join(evidenceRoot, 'kun-ui-plugin-layout-report.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return reportPath
}

async function writeOverview(evidenceRoot, plugins) {
  const columns = 3
  const cardWidth = 560
  const cardHeight = 330
  const gap = 20
  const pagePadding = 40
  const headerHeight = 112
  const rows = Math.ceil(plugins.length / columns)
  const width = pagePadding * 2 + columns * cardWidth + (columns - 1) * gap
  const height = headerHeight + rows * cardHeight + Math.max(0, rows - 1) * gap + 48
  const cards = plugins.map((plugin, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = pagePadding + column * (cardWidth + gap)
    const y = headerHeight + row * (cardHeight + gap)
    return (
      `<g><rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="22" ` +
      'fill="#fff" fill-opacity=".9" stroke="#d9d2dc"/>' +
      `<text x="${x + cardWidth / 2}" y="${y + 310}" fill="#352d38" ` +
      'font-family="Arial, sans-serif" font-size="17" font-weight="700" ' +
      `text-anchor="middle">${plugin.id}</text></g>`
    )
  }).join('')
  const frame = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"><defs><linearGradient id="page" x1="0" y1="0" ` +
    'x2="1" y2="1"><stop stop-color="#fffafa"/><stop offset=".52" stop-color="#f7f2fb"/>' +
    '<stop offset="1" stop-color="#edf8f7"/></linearGradient></defs>' +
    `<rect width="${width}" height="${height}" fill="url(#page)"/>` +
    '<text x="40" y="52" fill="#2f2832" font-family="Arial, sans-serif" font-size="34" ' +
    'font-weight="800">11 REAL KUN UI PLUGIN WORKBENCH CAPTURES</text>' +
    '<text x="42" y="83" fill="#7d727f" font-family="Arial, sans-serif" font-size="14" ' +
    'font-weight="700" letter-spacing="2">HOST CDP · DECLARATIVE UI PLUGIN · WIDE + NARROW VERIFIED</text>' +
    `${cards}</svg>`
  )
  const layers = await Promise.all(plugins.map(async (plugin, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const input = await sharp(join(evidenceRoot, `${plugin.id}-kun-ui-plugin.png`))
      .resize(520, 252, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer()
    return {
      input,
      left: pagePadding + column * (cardWidth + gap) + 20,
      top: headerHeight + row * (cardHeight + gap) + 20
    }
  }))
  const outputPath = join(evidenceRoot, 'kun-ui-plugin-real-overview.png')
  await sharp(frame, { density: 72 })
    .composite(layers)
    .png({ compressionLevel: 9, palette: true, quality: 95 })
    .toFile(outputPath)
  return outputPath
}

function formatThemeResult(id, wide, narrow, screenshotPath) {
  const scene = wide.attributes['data-ui-plugin-scene-layout']
  const frame = scene
    ? `scene:${scene}`
    : wide.attributes['data-ui-plugin-character-frame'] ?? 'unknown'
  const stage = wide.stage.rect
  const character = wide.character.rect
  const narrowExcess = Math.max(...narrow.overflow.map((entry) => entry.excess))
  return (
    `[${id}] frame=${frame}; ` +
    `wide stage=${formatRect(stage)} portrait=${formatRect(character)}; ` +
    `narrow hidden=${!narrow.character.visible} overflow=${narrowExcess}px; ` +
    `screenshot=${screenshotPath}\n`
  )
}

function formatRect(rect) {
  if (!rect) return 'missing'
  return `${Math.round(rect.width)}x${Math.round(rect.height)}@${Math.round(rect.x)},${Math.round(rect.y)}`
}

function formatPercent(ratio) {
  return `${Math.round(ratio * 1_000) / 10}%`
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
  if (!port) throw new Error('Could not allocate a development UI Plugin layout smoke port')
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

function commaSeparatedIdsArgument(name) {
  const raw = argumentValue(name)
  if (raw === undefined) return []
  const ids = raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 0) throw new Error(`${name} requires at least one UI Plugin id`)
  for (const id of ids) {
    if (!UI_PLUGIN_ID_PATTERN.test(id)) throw new Error(`${name} contains an invalid UI Plugin id: ${id}`)
  }
  return [...new Set(ids)]
}

function requiredArgumentValue(name) {
  const value = argumentValue(name)
  if (value === undefined) throw new Error(`${name} is required`)
  return value
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
