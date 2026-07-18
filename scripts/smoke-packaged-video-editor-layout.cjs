#!/usr/bin/env node

'use strict'

const assert = require('node:assert/strict')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  makeTreeWritable,
  resolvePackagedRuntimeExecutable,
  resolveResources,
  validatePackagedResources
} = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  resolveDesktopLaunchSelection,
  runPackagedKun,
  terminateProcessTree,
  waitForPortsClosed
} = require('./smoke-packaged-extension-desktop.cjs')
const {
  CONTRIBUTION_ID,
  EXTENSION_ID,
  EXTENSION_VERSION,
  desktopVideoEditorSettings,
  findWorkbenchWindow,
  launchPackagedDesktop,
  openVideoEditor,
  resolveVideoEditorArchive
} = require('./smoke-packaged-video-editor-desktop.cjs')

const DEFAULT_TIMEOUT_MS = 120_000
const TARGET_WIDTHS = Object.freeze([760, 560, 360, 280])
const EVIDENCE_WIDTHS = new Set([280, 560])
const HEIGHT_TOLERANCE_PX = 3
const WIDTH_TOLERANCE_PX = 4

async function main() {
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const resourcesDir = resolveResources(argumentValue('--resources'))
  const packagedRuntimeExecutable = resolvePackagedRuntimeExecutable(resourcesDir)
  const runtimeExecutable = resolvePackagedRuntimeExecutable(
    resourcesDir,
    argumentValue('--runtime-executable')
  )
  if (!runtimeExecutable) {
    throw new Error(`The packaged Kun application at ${resourcesDir} is not host-native for ${process.arch}`)
  }
  const desktopLaunchSelection = resolveDesktopLaunchSelection({
    resourcesDir,
    runtimeExecutable,
    packagedRuntimeExecutable,
    desktopExecutable: argumentValue('--desktop-executable')
  })
  const unpackedRoot = join(resourcesDir, 'app.asar.unpacked')
  const runtimeEntry = join(unpackedRoot, 'kun', 'dist', 'cli', 'serve-entry.js')
  validatePackagedResources(resourcesDir, unpackedRoot)
  const archive = await resolveVideoEditorArchive(resourcesDir, argumentValue('--archive'))

  const repositoryRoot = resolve(argumentValue('--repository-root') ?? join(__dirname, '..'))
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-video-editor-layout-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'video-editor-layout-'))
  const evidenceRoot = resolve(
    argumentValue('--evidence-dir') ?? join(tmpdir(), 'kun-video-editor-layout-evidence')
  )
  const runtimePort = await availablePort()
  const cleanupErrors = []
  let primaryError
  let electronApplication
  let electronProcess

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

    const isolatedEnvironment = createIsolatedEnvironment(process.env, {
      home,
      appData,
      localAppData,
      temporaryDirectory
    })
    runPackagedKun(
      desktopLaunchSelection.cliExecutable,
      runtimeEntry,
      [
        'extension', 'install', archive,
        '--data-dir', profile,
        '--accept-permissions',
        '--json'
      ],
      isolatedEnvironment,
      timeoutMs
    )
    await grantVideoEditorWorkspaceTrust(unpackedRoot, profile, workspaceRoot)

    electronApplication = await launchPackagedDesktop({
      desktopLaunchSelection,
      userData,
      home,
      environment: isolatedEnvironment,
      timeoutMs
    })
    electronProcess = electronApplication.process()
    let workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
    await electronApplication.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())
      if (!window) throw new Error('Kun workbench BrowserWindow is unavailable')
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
          join(evidenceRoot, `kun-video-editor-sidebar-${width}.png`),
          Buffer.from(guestPngBase64, 'base64')
        )
      }
    }

    process.stdout.write(
      `Packaged Kun Video Editor layout smoke OK (${process.platform}/${process.arch}): ` +
      `${measurements.map(({ targetWidth, host, guest }) =>
        `${targetWidth}px host=${Math.round(host.width)}x${Math.round(host.height)} ` +
        `guest=${guest.innerWidth}x${guest.innerHeight} scroll=${guest.scrollWidth}`
      ).join('; ')}; evidence=${evidenceRoot}\n`
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
    await waitForPortsClosed([runtimePort], 2_000).catch((error) => cleanupErrors.push(error))
    if (process.env.KUN_KEEP_PACKAGED_VIDEO_EDITOR_LAYOUT_SMOKE === '1') {
      process.stderr.write(`Preserved packaged layout profile: ${temporaryRoot}\n`)
      process.stderr.write(`Preserved packaged layout workspace: ${workspaceRoot}\n`)
    } else {
      await Promise.all([temporaryRoot, workspaceRoot].map(async (path) => {
        await makeTreeWritable(path).catch(() => undefined)
        await rm(path, { recursive: true, force: true }).catch((error) => cleanupErrors.push(error))
      }))
    }
    if (primaryError && cleanupErrors.length > 0) {
      process.stderr.write(
        `Packaged layout smoke cleanup warnings: ${cleanupErrors.map(String).join(' | ')}\n`
      )
    }
  }
  if (primaryError) throw primaryError
  if (cleanupErrors.length > 0) {
    throw new Error(`Packaged layout smoke cleanup failed: ${cleanupErrors.map(String).join(' | ')}`)
  }
}

async function grantVideoEditorWorkspaceTrust(unpackedRoot, profile, workspaceRoot) {
  const modulePath = join(unpackedRoot, 'kun', 'dist', 'extensions', 'index.js')
  const extensionModule = await import(
    `${pathToFileURL(modulePath).href}?layout-smoke=${Date.now()}-${Math.random()}`
  )
  const paths = new extensionModule.ExtensionPaths({
    packageRoot: join(profile, 'extensions'),
    dataRoot: join(profile, 'extension-data')
  })
  const registry = new extensionModule.ExtensionRegistry(paths)
  const entry = await registry.get(EXTENSION_ID)
  const active = entry?.useDevelopment
    ? entry.development
    : entry?.selectedVersion
      ? entry.versions[entry.selectedVersion]
      : undefined
  if (!active || active.manifest.version !== EXTENSION_VERSION) {
    throw new Error(`Layout smoke expected ${EXTENSION_ID} ${EXTENSION_VERSION} to be selected`)
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

async function ensureProject(electronApplication, guestWebContentsId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let before
  while (Date.now() < deadline) {
    before = await evaluateVisibleVideoEditorGuest(electronApplication, guestWebContentsId, `(() => ({
      hasProject: Boolean(document.querySelector('.workbench-tabs')),
      hasPrimary: Boolean(document.querySelector('.empty-project-primary')),
      text: document.body?.innerText?.slice(0, 2_000) ?? ''
    }))()`)
    if (before.hasProject || before.hasPrimary) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  if (!before?.hasProject && !before?.hasPrimary) {
    throw new Error(
      `Video editor did not reach a project or empty-project surface: ${before?.text ?? 'unavailable'}`
    )
  }
  if (!before.hasProject) {
    assert.equal(before.hasPrimary, true, 'Empty project must expose its primary create action')
    const clicked = await evaluateVisibleVideoEditorGuest(electronApplication, guestWebContentsId, `(() => {
      const button = document.querySelector('.empty-project-primary')
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false
      button.click()
      return true
    })()`)
    assert.equal(clicked, true, 'Layout smoke could not activate the empty-project primary action')
  }
  while (Date.now() < deadline) {
    const projectId = await evaluateVisibleVideoEditorGuest(
      electronApplication,
      guestWebContentsId,
      `document.querySelector('.project-controls select')?.value ?? ''`
    )
    if (projectId) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('Timed out waiting for layout-smoke project creation')
}

async function visibleGuestWebContentsId(workbench) {
  return workbench.evaluate((contributionId) => {
    const webview = [...document.querySelectorAll(`webview[data-contribution-id="${contributionId}"]`)]
      .map((candidate) => ({ candidate, rectangle: candidate.getBoundingClientRect() }))
      .sort((left, right) => right.rectangle.width * right.rectangle.height - left.rectangle.width * left.rectangle.height)[0]?.candidate
    if (!webview || typeof webview.getWebContentsId !== 'function') {
      throw new Error('Visible video editor Webview does not expose its guest WebContents ID')
    }
    return webview.getWebContentsId()
  }, CONTRIBUTION_ID)
}

async function evaluateVisibleVideoEditorGuest(electronApplication, guestWebContentsId, expression) {
  return electronApplication.evaluate(async ({ webContents }, input) => {
    const guest = webContents.fromId(input.guestWebContentsId)
    if (!guest || guest.isDestroyed() || guest.getType() !== 'webview') {
      throw new Error(`Visible Kun Video Editor guest ${input.guestWebContentsId} is unavailable`)
    }
    return guest.executeJavaScript(input.expression, true)
  }, { guestWebContentsId, expression })
}

async function waitForVisibleGuestReady(electronApplication, guestWebContentsId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    const state = await evaluateVisibleVideoEditorGuest(
      electronApplication,
      guestWebContentsId,
      `(() => ({
        ready: document.readyState === 'complete' && typeof globalThis.kunExtension?.request === 'function',
        surface: Boolean(document.querySelector('.empty-project-primary, .workbench-tabs')),
        text: document.body?.innerText?.slice(0, 2_000) ?? ''
      }))()`
    )
    last = state.text
    if (state.ready && state.surface) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Timed out waiting for visible video editor guest initialization: ${last}`)
}

async function resizeRightSidebar(workbench, targetWidth, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const geometry = await readHostGeometry(workbench)
    if (Math.abs(geometry.configuredWidth - targetWidth) <= WIDTH_TOLERANCE_PX) return
    const startX = geometry.divider.left + geometry.divider.width / 2
    const startY = geometry.divider.top + Math.min(geometry.divider.height / 2, 320)
    const targetX = startX + geometry.configuredWidth - targetWidth
    await workbench.mouse.move(startX, startY)
    await workbench.mouse.down()
    await workbench.mouse.move(targetX, startY, { steps: 8 })
    await workbench.mouse.up()
    await workbench.waitForTimeout(100)
  }
  const geometry = await readHostGeometry(workbench)
  throw new Error(
    `Right sidebar did not reach ${targetWidth}px; geometry=${JSON.stringify(geometry)}`
  )
}

async function readHostGeometry(workbench) {
  return workbench.evaluate((contributionId) => {
    const candidates = [...document.querySelectorAll(`webview[data-contribution-id="${contributionId}"]`)]
      .map((candidate) => ({ candidate, rectangle: candidate.getBoundingClientRect() }))
      .sort((left, right) => right.rectangle.width * right.rectangle.height - left.rectangle.width * left.rectangle.height)
    const webview = candidates[0]?.candidate
    if (!(webview instanceof HTMLElement)) throw new Error('Video editor Host webview is unavailable')
    const section = webview.closest('.ds-extension-view')
    const container = section?.parentElement
    const divider = container?.previousElementSibling
    if (!(section instanceof HTMLElement) || !(divider instanceof HTMLElement)) {
      throw new Error('Video editor right-sidebar geometry is unavailable')
    }
    const rectangle = webview.getBoundingClientRect()
    const sectionRectangle = section.getBoundingClientRect()
    const containerRectangle = container?.getBoundingClientRect()
    const dividerRectangle = divider.getBoundingClientRect()
    const shellRectangle = document.querySelector('.ds-workbench-shell')?.getBoundingClientRect()
    const configuredWidth = Number.parseFloat(container?.style.width ?? '')
    const uiScale = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--ds-ui-scale')
    )
    return {
      display: getComputedStyle(webview).display,
      uiScale: Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1,
      windowWidth: window.innerWidth,
      width: rectangle.width,
      height: rectangle.height,
      containerWidth: containerRectangle?.width ?? null,
      configuredWidth: Number.isFinite(configuredWidth) ? configuredWidth : rectangle.width,
      sectionHeight: sectionRectangle.height,
      shellWidth: shellRectangle?.width ?? null,
      storedLeftWidth: localStorage.getItem('kun.layout.leftSidebarWidth'),
      storedRightWidth: localStorage.getItem('kun.layout.rightInspectorWidth'),
      webviews: candidates.map(({ candidate, rectangle }) => ({
        id: typeof candidate.getWebContentsId === 'function' ? candidate.getWebContentsId() : null,
        width: rectangle.width,
        height: rectangle.height
      })),
      divider: {
        left: dividerRectangle.left,
        top: dividerRectangle.top,
        width: dividerRectangle.width,
        height: dividerRectangle.height
      }
    }
  }, CONTRIBUTION_ID)
}

async function readGuestGeometry(electronApplication, guestWebContentsId) {
  return evaluateVisibleVideoEditorGuest(electronApplication, guestWebContentsId, `(() => {
    const root = document.documentElement
    const body = document.body
    const tabs = [...document.querySelectorAll('.workbench-tabs [role="tab"][data-section]')]
    const panels = [...document.querySelectorAll('.workbench-pane[role="tabpanel"][data-sidebar-active]')]
    return {
      innerWidth,
      innerHeight,
      scrollWidth: Math.max(root?.scrollWidth ?? 0, body?.scrollWidth ?? 0),
      scrollHeight: Math.max(root?.scrollHeight ?? 0, body?.scrollHeight ?? 0),
      tabCount: tabs.length,
      selectedTabCount: tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length,
      visiblePanelCount: panels.filter((panel) => !panel.hidden && getComputedStyle(panel).display !== 'none').length,
      compactMediaQuery: matchMedia('(max-width: 860px)').matches,
      tabsDisplay: getComputedStyle(document.querySelector('.workbench-tabs')).display,
      tabsHeight: document.querySelector('.workbench-tabs')?.getBoundingClientRect().height ?? 0,
      projectBarScrollWidth: document.querySelector('.project-bar')?.scrollWidth ?? 0,
      projectBarClientWidth: document.querySelector('.project-bar')?.clientWidth ?? 0,
      workbenchScrollWidth: document.querySelector('.workbench')?.scrollWidth ?? 0,
      workbenchClientWidth: document.querySelector('.workbench')?.clientWidth ?? 0,
      workbenchDisplay: getComputedStyle(document.querySelector('.workbench')).display,
      workbenchGridTemplateColumns: getComputedStyle(document.querySelector('.workbench')).gridTemplateColumns,
      tabsText: tabs.map((tab) => tab.textContent?.trim() ?? ''),
      previewOpen: document.querySelector('.preview-drawer')?.hasAttribute('open') ?? null,
      documentOverflowX: getComputedStyle(body).overflowX
    }
  })()`)
}

function assertLayoutGeometry({ targetWidth, host, guest }) {
  assert.equal(host.display, 'flex', 'Host webview must remain display:flex for Electron shadow iframe fill')
  assert.ok(host.height > 400, `Host webview height collapsed to ${host.height}px`)
  assert.ok(
    Math.abs(host.height - guest.innerHeight * host.uiScale) <= HEIGHT_TOLERANCE_PX,
    `Guest height ${guest.innerHeight}px at ${host.uiScale} scale does not fill Host webview ${host.height}px`
  )
  assert.ok(
    Math.abs(host.configuredWidth - targetWidth) <= WIDTH_TOLERANCE_PX,
    `Host configured width ${host.configuredWidth}px does not match ${targetWidth}px target`
  )
  assert.ok(
    Math.abs(host.width - guest.innerWidth * host.uiScale) <= WIDTH_TOLERANCE_PX,
    `Guest width ${guest.innerWidth}px at ${host.uiScale} scale does not match Host width ${host.width}px`
  )
  assert.ok(
    guest.scrollWidth <= guest.innerWidth + 1,
    `Guest document overflows horizontally at ${targetWidth}px (${guest.scrollWidth} > ${guest.innerWidth})`
  )
  assert.equal(guest.tabCount, 5, 'Sidebar must expose five primary workspaces')
  assert.equal(guest.selectedTabCount, 1, 'Sidebar must expose one selected workspace tab')
  assert.equal(guest.visiblePanelCount, 1, 'Sidebar must expose one visible primary workspace')
  assert.equal(guest.compactMediaQuery, true, 'Visible guest must use the compact sidebar media query')
  assert.equal(guest.tabsDisplay, 'flex', 'Primary workspace tabs must be visible in the sidebar')
  assert.ok(guest.tabsHeight > 0, 'Primary workspace tabs must occupy visible layout space')
  assert.ok(
    guest.projectBarScrollWidth <= guest.projectBarClientWidth + 1,
    `Project bar clips controls at ${targetWidth}px (${guest.projectBarScrollWidth} > ${guest.projectBarClientWidth})`
  )
  assert.ok(
    guest.workbenchScrollWidth <= guest.workbenchClientWidth + 1,
    `Workbench clips primary content at ${targetWidth}px (${guest.workbenchScrollWidth} > ${guest.workbenchClientWidth})`
  )
  assert.equal(guest.previewOpen, false, 'Compact sidebar preview must start collapsed')
  assert.equal(guest.documentOverflowX, 'hidden', 'Guest document must confine horizontal overflow locally')
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
  if (!port) throw new Error('Could not allocate a packaged layout smoke port')
  return port
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

module.exports = {
  TARGET_WIDTHS,
  assertLayoutGeometry,
  ensureProject,
  readGuestGeometry,
  readHostGeometry,
  resizeRightSidebar,
  visibleGuestWebContentsId,
  waitForVisibleGuestReady
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
