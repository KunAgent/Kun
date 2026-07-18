#!/usr/bin/env node

'use strict'

const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} = require('node:fs/promises')
const { createServer: createHttpServer } = require('node:http')
const { createServer: createNetServer } = require('node:net')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const {
  makeTreeWritable,
  resolvePackagedRuntimeExecutable,
  resolveResources,
  validatePackagedResources
} = require('./smoke-packaged-extensions.cjs')
const {
  createIsolatedEnvironment,
  desktopSmokeSettings,
  desktopSmokeWorkspaceParent,
  desktopUserDataCandidates,
  platformDesktopArguments,
  resolveDesktopLaunchSelection,
  runPackagedKun,
  terminateProcessTree,
  waitForPortsClosed
} = require('./smoke-packaged-extension-desktop.cjs')
const {
  deterministicFixtureArguments,
  resolveHostMediaExecutables
} = require('./lib/extension-native-media-smoke.cjs')

const EXTENSION_ID = 'kun-examples.kun-video-editor'
const EXTENSION_VERSION = '0.4.4'
const CONTRIBUTION_ID = `extension:${EXTENSION_ID}/editor`
const VIDEO_EDITOR_PERMISSIONS = Object.freeze([
  'agent.run',
  'commands.register',
  'jobs.manage',
  'media.export',
  'media.process',
  'media.read',
  'storage.workspace',
  'tools.register',
  'ui.actions',
  'ui.views',
  'webview',
  'workspace.read',
  'workspace.write'
])
const SUCCESS_MARKER = 'Packaged Kun Video Editor desktop E2E OK ('
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_JOB_TIMEOUT_MS = 120_000
const MAX_CLEANUP_TIMEOUT_MS = 15_000
const MODEL_NAME = 'kun-video-editor-desktop-e2e'

async function main() {
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const jobTimeoutMs = positiveIntegerArgument('--job-timeout-ms', DEFAULT_JOB_TIMEOUT_MS)
  const resourcesDir = resolveResources(argumentValue('--resources'))
  const packagedRuntimeExecutable = resolvePackagedRuntimeExecutable(resourcesDir)
  const runtimeExecutable = resolvePackagedRuntimeExecutable(
    resourcesDir,
    argumentValue('--runtime-executable')
  )
  if (!runtimeExecutable) {
    throw new Error(
      `The packaged Kun application at ${resourcesDir} is not host-native for ${process.arch}`
    )
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

  const repositoryRoot = resolve(argumentValue('--repository-root') ?? join(__dirname, '..'))
  const archive = await resolveVideoEditorArchive(
    resourcesDir,
    argumentValue('--archive')
  )
  const transcriptFixture = join(
    repositoryRoot,
    'examples',
    'extensions',
    'kun-video-editor',
    'fixtures',
    'talking-head.srt'
  )
  assertRegularFile(transcriptFixture, 'committed SRT fixture')

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-video-editor-desktop-e2e-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'video-editor-e2e-'))
  const fixtureDirectory = join(workspaceRoot, 'fixtures')
  const exportDirectory = join(workspaceRoot, 'exports')
  const videoFixture = join(fixtureDirectory, 'desktop-e2e-source.mp4')
  const transcript = join(fixtureDirectory, 'desktop-e2e-source.srt')
  const subtitleOutput = join(exportDirectory, 'desktop-e2e-output.srt')
  const runtimePort = await availablePort()
  const cleanupErrors = []
  let primaryError
  let electronApplication
  let electronProcess
  let firstDesktopPid
  let relaunchedDesktopPid
  let modelFixture
  let mediaExecutables

  try {
    await Promise.all([
      mkdir(profile, { recursive: true }),
      mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }),
      mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }),
      mkdir(fixtureDirectory, { recursive: true }),
      mkdir(exportDirectory, { recursive: true })
    ])

    mediaExecutables = resolveHostMediaExecutables()
    createVideoFixture(mediaExecutables.ffmpeg, videoFixture, workspaceRoot, timeoutMs)
    await copyFile(transcriptFixture, transcript)
    await Promise.all([
      assertNonEmptyFile(videoFixture, 'desktop MP4 fixture'),
      assertNonEmptyFile(transcript, 'desktop SRT fixture')
    ])

    modelFixture = await startOfflineModelFixture()
    const settings = desktopVideoEditorSettings({
      runtimePort,
      workspaceRoot,
      dataDir: profile,
      modelBaseUrl: modelFixture.baseUrl
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
    isolatedEnvironment.KUN_FFMPEG_PATH = mediaExecutables.ffmpeg
    isolatedEnvironment.KUN_FFPROBE_PATH = mediaExecutables.ffprobe

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

    const launch = () => launchPackagedDesktop({
      desktopLaunchSelection,
      userData,
      home,
      environment: isolatedEnvironment,
      timeoutMs
    })

    electronApplication = await launch()
    electronProcess = electronApplication.process()
    firstDesktopPid = electronProcess.pid
    if (!Number.isSafeInteger(firstDesktopPid) || firstDesktopPid <= 0) {
      throw new Error(`Packaged Electron did not expose a valid first-launch PID: ${firstDesktopPid}`)
    }
    await installNativeDialogStubs(electronApplication, {
      openSelections: [[videoFixture], [transcript]],
      saveSelections: [subtitleOutput]
    })
    let workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
    await openUntrustedVideoEditor(
      workbench,
      electronApplication,
      workspaceRoot,
      timeoutMs
    )

    let snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.ready &&
        value.lang.toLowerCase().startsWith('zh') &&
        value.theme === 'light' &&
        value.text.includes('开始你的第一支作品') &&
        value.text.includes('Kun 视频剪辑'),
      'Chinese/light Kun Video Editor View',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'initializing the Chinese/light editor')

    await setGuestFormValue(
      electronApplication,
      '.onboarding-project-card input',
      'Desktop E2E Alpha'
    )
    await submitGuestForm(electronApplication, '.onboarding-project-card')
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.projectName === 'Desktop E2E Alpha' && Boolean(value.projectId) && !value.busy,
      'first video project creation',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'creating the first project')
    const firstProjectId = snapshot.projectId

    await clickGuestButton(electronApplication, '导入媒体', '.project-actions')
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.assets.includes(basename(videoFixture)) &&
        value.selectedAssetName === basename(videoFixture) && value.revision >= 1 && !value.busy,
      'real MP4 import and ffprobe metadata',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'importing MP4 media')

    await clickGuestButton(electronApplication, '导入逐字稿')
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.transcriptCount === 3 &&
        value.text.includes('This range stays editable.') &&
        !value.busy,
      'real SRT import',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'importing the SRT transcript')

    const revisionBeforeEdit = snapshot.revision
    await clickGuestSelector(electronApplication, '.transcript-cut', 1)
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.revision > revisionBeforeEdit && !value.busy,
      'manual transcript-range edit',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'applying the manual edit')

    await clickGuestButton(electronApplication, '生成字幕')
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.captionCount > 0 && !value.busy,
      'caption generation from imported transcript',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'generating captions')

    await clickGuestSelector(electronApplication, '#video-editor-tab-output')
    await clickGuestButton(electronApplication, '导出 SRT', '.output-kind-options')
    await clickGuestButton(electronApplication, '导出 SRT', '.export-primary-row')
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.jobStates.includes('completed') && !value.busy,
      'durable standalone SRT export',
      jobTimeoutMs
    )
    assertNoGuestErrors(snapshot, 'exporting SRT')
    const exportedSubtitle = await readFile(subtitleOutput, 'utf8')
    if (!/\d\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n.+/u.test(exportedSubtitle)) {
      throw new Error('Desktop SRT export did not contain a bounded timed caption cue')
    }

    await clickGuestSelector(electronApplication, '.create-project-toggle')
    await setGuestFormValue(electronApplication, '.new-project-form input', 'Desktop E2E Beta')
    await submitGuestForm(electronApplication, '.new-project-form')
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.projectName === 'Desktop E2E Beta' &&
        value.projectId !== firstProjectId &&
        !value.busy,
      'second project creation',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'creating the second project')

    modelFixture.setTargetProjectId(firstProjectId)
    const turn = await startAgentToolTurn(workbench, workspaceRoot)
    const terminalTurn = await waitForAgentTurn(workbench, turn, timeoutMs)
    if (terminalTurn.status !== 'completed') {
      throw new Error(`Main Agent desktop E2E turn ended as ${terminalTurn.status}: ${terminalTurn.error ?? 'no detail'}`)
    }
    const modelState = modelFixture.snapshot()
    if (!modelState.toolCallIssued || !modelState.toolResultObserved) {
      throw new Error(
        'Main Agent did not complete the real extension ToolHost round-trip; ' +
        `offline model state: ${JSON.stringify(modelState)}`
      )
    }
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.projectId === firstProjectId && value.syncText.length > 0,
      'Main Agent video-project selection reflected in the video editor View',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'synchronizing the Main Agent tool result')

    await applyWorkbenchSettings(workbench, { locale: 'en', theme: 'dark' })
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.lang.toLowerCase().startsWith('en') && value.theme === 'dark' &&
        value.text.toLowerCase().includes('ready to deliver') && value.text.includes('Output mode'),
      'English/dark View update from Kun settings',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'following English/dark Kun settings')

    // Give the debounced View state writer time to commit before exercising a
    // full desktop shutdown/relaunch with the same isolated profile.
    await delay(350)
    const firstRunProcess = electronProcess
    await electronApplication.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0)
    })
    // macOS keeps the application process alive when its last window closes.
    // Let the explicit quit run before Playwright disconnects, then verify the
    // exact launcher PID and its managed runtime are gone before relaunching.
    await delay(1_000)
    await terminateProcessTree(firstRunProcess, process.platform, {
      timeoutMs: MAX_CLEANUP_TIMEOUT_MS,
      ports: [runtimePort]
    })
    await electronApplication.close().catch(() => undefined)
    electronApplication = undefined
    electronProcess = undefined

    electronApplication = await launch()
    electronProcess = electronApplication.process()
    relaunchedDesktopPid = electronProcess.pid
    if (!Number.isSafeInteger(relaunchedDesktopPid) || relaunchedDesktopPid <= 0) {
      throw new Error(`Packaged Electron did not expose a valid relaunch PID: ${relaunchedDesktopPid}`)
    }
    if (relaunchedDesktopPid === firstDesktopPid) {
      throw new Error(`Packaged Electron relaunch reused the original PID ${firstDesktopPid}`)
    }
    await installNativeDialogStubs(electronApplication, {
      openSelections: [],
      saveSelections: []
    })
    workbench = await findWorkbenchWindow(electronApplication, timeoutMs)
    await openVideoEditor(workbench, electronApplication, timeoutMs)
    snapshot = await waitForGuestSnapshot(
      electronApplication,
      (value) => value.projectId === firstProjectId &&
        value.projectName === 'Desktop E2E Alpha' &&
        value.assets.includes(basename(videoFixture)) &&
        value.transcriptCount === 3 &&
        value.captionCount > 0 &&
        value.jobStates.includes('completed') &&
        value.lang.toLowerCase().startsWith('en') &&
        value.theme === 'dark',
      'project, revision, output job, locale and theme recovery after desktop relaunch',
      timeoutMs
    )
    assertNoGuestErrors(snapshot, 'restoring the editor after relaunch')
    process.stdout.write(
      `${SUCCESS_MARKER}${process.platform}/${process.arch}): real packaged Electron, ` +
      `desktop PID ${firstDesktopPid} -> ${relaunchedDesktopPid}, ` +
      'default-hidden first-launch View opened from Extension management with localized protected permission/risk review, ' +
      'main-process native picker stubs, zh/light -> en/dark, ' +
      'real MP4/SRT import, manual transcript edit, durable SRT export, Main Agent extension-tool sync, ' +
      'and close/reopen recovery.\n'
    )
  } catch (error) {
    primaryError = error
  } finally {
    if (electronApplication) {
      await electronApplication.close().catch((error) => cleanupErrors.push(error))
    }
    if (electronProcess && !electronProcess.killed) {
      await terminateProcessTree(electronProcess, process.platform, {
        timeoutMs: MAX_CLEANUP_TIMEOUT_MS,
        ports: [runtimePort]
      }).catch((error) => cleanupErrors.push(error))
    }
    if (modelFixture) {
      await modelFixture.close().catch((error) => cleanupErrors.push(error))
      await waitForPortsClosed([modelFixture.port], 2_000).catch((error) => cleanupErrors.push(error))
    }
    if (process.env.KUN_KEEP_VIDEO_EDITOR_DESKTOP_E2E === '1') {
      process.stderr.write(`Preserved desktop E2E profile: ${temporaryRoot}\n`)
      process.stderr.write(`Preserved desktop E2E workspace: ${workspaceRoot}\n`)
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
        ? 'Kun Video Editor desktop E2E cleanup failed'
        : String(primaryError)
    const cleanup = cleanupErrors.length > 0
      ? `\nCleanup failures:\n${cleanupErrors.map((error) => `- ${error instanceof Error ? error.message : String(error)}`).join('\n')}`
      : ''
    throw new Error(`${message}${cleanup}`)
  }
}

function desktopVideoEditorSettings({ runtimePort, workspaceRoot, dataDir, modelBaseUrl }) {
  const base = desktopSmokeSettings(runtimePort, workspaceRoot, dataDir)
  return {
    ...base,
    locale: 'zh',
    theme: 'light',
    agents: {
      kun: {
        ...base.agents.kun,
        apiKey: 'desktop-e2e-local-placeholder',
        baseUrl: modelBaseUrl,
        providerId: 'deepseek',
        model: MODEL_NAME,
        endpointFormat: 'openai-chat-completions',
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access'
      }
    }
  }
}

async function resolveVideoEditorArchive(resourcesDir, explicit) {
  if (explicit) {
    const archive = resolve(explicit)
    assertRegularFile(archive, 'explicit Kun Video Editor .kunx')
    if (!archive.endsWith('.kunx')) throw new Error(`Video editor archive must end with .kunx: ${archive}`)
    return archive
  }
  const bundledRoot = join(resourcesDir, 'bundled-extensions')
  const catalogPath = join(bundledRoot, 'catalog.json')
  assertRegularFile(catalogPath, 'packaged bundled-extension catalog')
  let catalog
  try {
    catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot parse packaged bundled-extension catalog: ${error instanceof Error ? error.message : String(error)}`)
  }
  const matches = Array.isArray(catalog?.extensions)
    ? catalog.extensions.filter((entry) => entry?.id === EXTENSION_ID)
    : []
  if (matches.length !== 1 || typeof matches[0]?.archive !== 'string') {
    throw new Error(`Packaged bundled-extension catalog must contain exactly one ${EXTENSION_ID}`)
  }
  const archive = join(bundledRoot, matches[0].archive)
  assertRegularFile(archive, 'packaged bundled Kun Video Editor .kunx')
  return archive
}

function createVideoFixture(ffmpegPath, output, cwd, timeoutMs) {
  const result = spawnSync(ffmpegPath, deterministicFixtureArguments(output, 2), {
    cwd,
    env: process.env,
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`.trim().slice(-8_000)
    throw new Error(
      `Cannot create the real MP4 desktop fixture with ${ffmpegPath}. ` +
      'Install an FFmpeg build with libx264 and AAC, or set KUN_FFMPEG_PATH. ' +
      `Exit: ${result.signal ?? result.status ?? 'unknown'}${detail ? `\n${detail}` : ''}`
    )
  }
}

async function launchPackagedDesktop({
  desktopLaunchSelection,
  userData,
  home,
  environment,
  timeoutMs
}) {
  if (process.platform === 'linux' && !environment.DISPLAY && !environment.WAYLAND_DISPLAY) {
    throw new Error(
      'The Playwright Electron desktop E2E needs a display on Linux. ' +
      'Run it under `xvfb-run -a npm run smoke:packaged-video-editor-desktop -- ...`.'
    )
  }
  const { _electron } = require('playwright-core')
  const args = [
    ...(desktopLaunchSelection.applicationEntry
      ? [desktopLaunchSelection.applicationEntry]
      : []),
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    ...platformDesktopArguments(process.platform)
  ]
  return _electron.launch({
    executablePath: desktopLaunchSelection.desktopExecutable,
    args,
    cwd: home,
    env: environment,
    // Match the production desktop security posture. Playwright otherwise
    // injects --no-sandbox on Linux; CI must provide working user namespaces.
    chromiumSandbox: true,
    timeout: timeoutMs
  })
}

async function installNativeDialogStubs(electronApplication, {
  openSelections = [],
  saveSelections = []
}) {
  await electronApplication.evaluate(({ dialog }, queues) => {
    const state = {
      openSelections: queues.openSelections.map((selection) => [...selection]),
      saveSelections: [...queues.saveSelections],
      messageBoxes: [],
      calls: []
    }
    globalThis.__kunVideoEditorDesktopE2eDialogs = state
    dialog.showOpenDialog = async (...args) => {
      const options = args.at(-1) ?? {}
      const selected = state.openSelections.shift()
      state.calls.push({ kind: 'open', title: options.title ?? '', selected: selected ?? null })
      return selected
        ? { canceled: false, filePaths: selected }
        : { canceled: true, filePaths: [] }
    }
    dialog.showSaveDialog = async (...args) => {
      const options = args.at(-1) ?? {}
      const selected = state.saveSelections.shift()
      state.calls.push({ kind: 'save', title: options.title ?? '', selected: selected ?? null })
      return selected
        ? { canceled: false, filePath: selected }
        : { canceled: true, filePath: undefined }
    }
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1) ?? {}
      const buttons = Array.isArray(options.buttons)
        ? options.buttons.map((button) => String(button))
        : []
      const detail = typeof options.detail === 'string' ? options.detail : ''
      const response = Number.isInteger(options.cancelId)
        ? options.cancelId
        : Math.max(buttons.length - 1, 0)
      const record = {
        kind: 'message',
        type: typeof options.type === 'string' ? options.type : '',
        title: typeof options.title === 'string' ? options.title : '',
        message: typeof options.message === 'string' ? options.message : '',
        detail: detail.slice(0, 32_000),
        buttons,
        defaultId: Number.isInteger(options.defaultId) ? options.defaultId : null,
        cancelId: Number.isInteger(options.cancelId) ? options.cancelId : null,
        noLink: options.noLink === true,
        normalizeAccessKeys: options.normalizeAccessKeys === true,
        response
      }
      state.messageBoxes.push(record)
      state.calls.push(record)
      return { response, checkboxChecked: false }
    }
  }, { openSelections, saveSelections })
}

async function findWorkbenchWindow(electronApplication, timeoutMs) {
  return pollUntil(async () => {
    for (const window of electronApplication.windows()) {
      try {
        if (await window.evaluate(() => typeof globalThis.kunGui === 'object')) return window
      } catch {
        // Window may still be navigating.
      }
    }
    return undefined
  }, { timeoutMs, description: 'packaged Kun workbench window' })
}

async function findProtectedConsentWindow(electronApplication, workbench, timeoutMs) {
  return pollUntil(async () => {
    for (const window of electronApplication.windows()) {
      if (window === workbench || window.isClosed()) continue
      try {
        if (
          await window.locator('#consent-approve').count() === 1 &&
          await window.locator('#consent-cancel').count() === 1
        ) return window
      } catch {
        // The protected BrowserWindow may still be loading or closing.
      }
    }
    return undefined
  }, {
    timeoutMs,
    description: `localized protected workspace permission review for ${EXTENSION_ID}`
  })
}

async function readProtectedConsentPrompt(window) {
  return window.evaluate(() => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? ''
    const meta = Object.fromEntries(
      [...document.querySelectorAll('.meta-row')].map((row) => [
        row.querySelector('dt')?.textContent?.trim() ?? '',
        row.querySelector('dd')?.textContent?.trim() ?? ''
      ])
    )
    const scrollRegion = document.querySelector('.scroll-region')
    const footer = document.querySelector('.footer')
    const approve = document.querySelector('#consent-approve')
    const cancel = document.querySelector('#consent-cancel')
    const visibleWithinViewport = (element) => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0 &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.top >= -1 &&
        bounds.left >= -1 &&
        bounds.bottom <= innerHeight + 1 &&
        bounds.right <= innerWidth + 1
    }
    const scrollBounds = scrollRegion?.getBoundingClientRect()
    const footerBounds = footer?.getBoundingClientRect()
    return {
      title: document.title,
      heading: text('.header h1'),
      message: text('.header p'),
      detail: text('.review-text'),
      meta,
      approveLabel: text('#consent-approve'),
      cancelLabel: text('#consent-cancel'),
      approveVisible: visibleWithinViewport(approve),
      cancelVisible: visibleWithinViewport(cancel),
      scrollOverflowY: scrollRegion ? getComputedStyle(scrollRegion).overflowY : '',
      scrollClientHeight: scrollRegion?.clientHeight ?? 0,
      scrollHeight: scrollRegion?.scrollHeight ?? 0,
      scrollTop: scrollBounds?.top ?? -1,
      scrollBottom: scrollBounds?.bottom ?? -1,
      footerTop: footerBounds?.top ?? -1,
      footerBottom: footerBounds?.bottom ?? -1,
      viewportHeight: innerHeight
    }
  })
}

async function openUntrustedVideoEditor(
  workbench,
  electronApplication,
  workspaceRoot,
  timeoutMs
) {
  if (await hasVideoEditorGuest(electronApplication)) {
    throw new Error('Kun Video Editor opened before the first-launch workspace trust review')
  }
  await assertVideoEditorHiddenFromRightRail(workbench, workspaceRoot, timeoutMs)
  const card = await openVideoEditorManagementCard(workbench, timeoutMs)
  const authorize = card.getByRole('button', { name: /^(?:授权后打开 Kun 视频编辑器|Authorize to open Kun Video Editor)$/ })
  await authorize.waitFor({ state: 'visible', timeout: timeoutMs })
  await authorize.click()
  const review = card.getByRole('button', { name: /^(?:在受保护窗口审核并应用|Review and apply in protected window)$/ })
  await review.waitFor({ state: 'visible', timeout: timeoutMs })
  await review.click()
  const permissionPromptWindow = await findProtectedConsentWindow(
    electronApplication,
    workbench,
    timeoutMs
  )
  const permissionPrompt = await readProtectedConsentPrompt(permissionPromptWindow)
  assertLocalizedFirstLaunchPermissionPrompt(permissionPrompt, { workspaceRoot })
  await permissionPromptWindow.locator('#consent-approve').click()
  const open = card.getByRole('button', { name: /^(?:打开 Kun 视频编辑器|Open Kun Video Editor)$/ })
  await open.waitFor({ state: 'visible', timeout: timeoutMs })
  await open.click()
  await waitForVideoEditorGuest(
    workbench,
    electronApplication,
    timeoutMs,
    `authorized Extension management View ${CONTRIBUTION_ID}`
  )
}

async function openVideoEditor(workbench, electronApplication, timeoutMs) {
  if (await hasVideoEditorGuest(electronApplication)) return
  const card = await openVideoEditorManagementCard(workbench, timeoutMs)
  const open = card.getByRole('button', { name: /^(?:打开 Kun 视频编辑器|Open Kun Video Editor)$/ })
  await open.waitFor({ state: 'visible', timeout: timeoutMs })
  await open.click()
  try {
    await waitForVideoEditorGuest(
      workbench,
      electronApplication,
      timeoutMs,
      `Extension management View ${CONTRIBUTION_ID}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${message}\nExtension management open failed for ${CONTRIBUTION_ID}`
    )
  }
}

async function assertVideoEditorHiddenFromRightRail(workbench, workspaceRoot, timeoutMs) {
  const discovery = await pollUntil(async () => workbench.evaluate(
    async ({ extensionId, workspaceRoot: currentWorkspaceRoot }) => {
      const result = await globalThis.kunGui.extensionGetWorkbench({
        workspaceRoot: currentWorkspaceRoot,
        locale: 'zh-CN'
      })
      if (!result.ok) throw new Error(`Workbench contribution query failed: ${result.status}`)
      const snapshot = JSON.parse(result.body)
      const extension = snapshot.extensions?.find((entry) => entry?.id === extensionId)
      if (!extension) return undefined
      const view = extension.workspaceTrusted
        ? extension.contributes?.['views.rightSidebar']?.find((entry) => entry?.id === 'editor')
        : extension.rightRailDiscovery?.views?.find((entry) => entry?.id === 'editor')
      return view?.showInRightRail === false ? view : undefined
    }, { extensionId: EXTENSION_ID, workspaceRoot }), {
    timeoutMs,
    description: `default-hidden video editor contribution ${CONTRIBUTION_ID}`
  })
  if (!discovery || await workbench.locator(`button[data-contribution-id="${CONTRIBUTION_ID}"]`).count() !== 0) {
    throw new Error('Kun Video Editor must not be displayed in the Code right rail by default')
  }
}

async function openVideoEditorManagementCard(workbench, timeoutMs) {
  const extensions = workbench.getByRole('button', { name: /^(?:扩展|Extensions)$/ })
  await extensions.waitFor({ state: 'visible', timeout: timeoutMs })
  await extensions.click()
  const card = workbench.locator(`[data-extension-id="${EXTENSION_ID}"]`)
  await card.waitFor({ state: 'visible', timeout: timeoutMs })
  return card
}

async function waitForVideoEditorGuest(
  workbench,
  electronApplication,
  timeoutMs,
  description
) {
  try {
    await pollUntil(() => hasVideoEditorGuest(electronApplication), {
      timeoutMs,
      description
    })
  } catch (error) {
    const diagnostic = await readVideoEditorOpenDiagnostic(workbench, electronApplication)
      .catch((diagnosticError) => ({
        diagnosticError: diagnosticError instanceof Error
          ? diagnosticError.message
          : String(diagnosticError)
      }))
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}\nVideo editor open diagnostic: ${JSON.stringify(diagnostic)}`)
  }
}

async function readVideoEditorOpenDiagnostic(workbench, electronApplication) {
  const [renderer, contents] = await Promise.all([
    workbench.evaluate((contributionId) => {
      const button = document.querySelector(`button[data-contribution-id="${contributionId}"]`)
      return {
        button: button ? {
          trusted: button.getAttribute('data-extension-trusted'),
          label: button.getAttribute('aria-label'),
          pressed: button.getAttribute('aria-pressed')
        } : null,
        views: [...document.querySelectorAll('.ds-extension-view')].slice(0, 8).map((view) => ({
          contributionId: view.getAttribute('data-contribution-id'),
          text: (view.textContent ?? '').trim().slice(0, 2_000)
        })),
        statuses: [...document.querySelectorAll('[role="status"], [role="alert"]')]
          .slice(0, 16)
          .map((node) => (node.textContent ?? '').trim().slice(0, 2_000))
      }
    }, CONTRIBUTION_ID),
    electronApplication.evaluate(({ webContents }) =>
      webContents.getAllWebContents().slice(0, 32).map((contents) => ({
        id: contents.id,
        type: contents.getType(),
        url: contents.getURL().slice(0, 4_096),
        destroyed: contents.isDestroyed()
      })))
  ])
  return { renderer, contents }
}

function assertLocalizedFirstLaunchPermissionPrompt(prompt, { workspaceRoot }) {
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
    throw new Error(`Expected one localized protected ${EXTENSION_ID} permission prompt`)
  }
  const expectedFields = {
    title: '更改扩展权限',
    heading: '更改扩展权限',
    approveLabel: '同意更改',
    cancelLabel: '取消',
    approveVisible: true,
    cancelVisible: true,
    scrollOverflowY: 'auto'
  }
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (JSON.stringify(prompt[field]) !== JSON.stringify(expected)) {
      throw new Error(
        `Localized permission prompt ${field} mismatch: expected ${JSON.stringify(expected)}, ` +
        `got ${JSON.stringify(prompt[field])}`
      )
    }
  }
  if (!prompt.message.includes(`${EXTENSION_ID} ${EXTENSION_VERSION}`)) {
    throw new Error(`Localized permission prompt omitted extension identity: ${prompt.message}`)
  }

  const expectedMeta = {
    扩展: `${EXTENSION_ID} ${EXTENSION_VERSION}`,
    操作: 'extension.permissions',
    工作区: workspaceRoot
  }
  if (JSON.stringify(prompt.meta) !== JSON.stringify(expectedMeta)) {
    throw new Error(
      `Localized permission prompt metadata mismatch: expected ${JSON.stringify(expectedMeta)}, ` +
      `got ${JSON.stringify(prompt.meta)}`
    )
  }

  const detailEvidence = [
    '此次权限变更仅适用于所选工作区。',
    '变更后的 Broker 权限：',
    'Kun 生成的风险摘要：',
    'Node 代码使用当前操作系统用户的权限运行。',
    '工作区读取权限可访问已批准工作区中的文件和扩展状态。',
    '工作区写入权限可在已批准的工作区中创建或修改文件。',
    '媒体读取权限可通过不透明授权检查用户选择的本地媒体。',
    '媒体处理和任务权限可运行并管理持久化的本地任务。',
    '媒体导出权限可写入用户批准的输出位置。',
    'Agent 和工具权限可启动私有 Agent 运行，并向 Kun 提供声明的工具。',
    '扩展 Node Host 本身并不是操作系统沙箱。',
    ...VIDEO_EDITOR_PERMISSIONS.map((permission) => `• ${permission}`)
  ]
  for (const evidence of detailEvidence) {
    if (!prompt.detail.includes(evidence)) {
      throw new Error(
        `Localized permission prompt omitted ${JSON.stringify(evidence)}: ${prompt.detail}`
      )
    }
  }
  if (
    !Number.isFinite(prompt.scrollClientHeight) || prompt.scrollClientHeight <= 0 ||
    !Number.isFinite(prompt.scrollHeight) || prompt.scrollHeight < prompt.scrollClientHeight
  ) {
    throw new Error(
      `Localized permission prompt review region cannot scroll safely: ${JSON.stringify(prompt)}`
    )
  }
  if (
    !Number.isFinite(prompt.viewportHeight) || prompt.viewportHeight <= 0 ||
    !Number.isFinite(prompt.scrollTop) || prompt.scrollTop < -1 ||
    !Number.isFinite(prompt.scrollBottom) ||
    !Number.isFinite(prompt.footerTop) || prompt.scrollBottom > prompt.footerTop + 1 ||
    !Number.isFinite(prompt.footerBottom) || prompt.footerBottom > prompt.viewportHeight + 1
  ) {
    throw new Error(
      `Localized permission prompt footer is outside the visible protected window: ${JSON.stringify(prompt)}`
    )
  }
  return prompt
}

async function hasVideoEditorGuest(electronApplication) {
  return electronApplication.evaluate(({ webContents }, extensionId) =>
    webContents.getAllWebContents().some((contents) =>
      contents.getType() === 'webview' &&
      contents.getURL().startsWith(`kun-extension://${extensionId}/`)
    ), EXTENSION_ID)
}

async function evaluateVideoEditorGuest(electronApplication, expression) {
  return electronApplication.evaluate(async ({ webContents }, input) => {
    const guest = webContents.getAllWebContents().find((contents) =>
      contents.getType() === 'webview' &&
      contents.getURL().startsWith(`kun-extension://${input.extensionId}/`)
    )
    if (!guest || guest.isDestroyed()) throw new Error('Kun Video Editor guest WebContents is unavailable')
    return guest.executeJavaScript(input.expression, true)
  }, { extensionId: EXTENSION_ID, expression })
}

async function readGuestSnapshot(electronApplication) {
  return evaluateVideoEditorGuest(electronApplication, `(() => {
    const text = document.body?.innerText ?? ''
    const projectSelect = document.querySelector('.project-controls select')
    const projectName = projectSelect?.selectedOptions?.[0]?.textContent?.split(' · r')[0]?.trim() ?? ''
    const revisionText = document.querySelector('.project-actions .revision-badge')?.textContent ?? ''
    return {
      ready: document.readyState === 'complete' && typeof globalThis.kunExtension?.request === 'function',
      busy: document.querySelector('#video-editor-main')?.getAttribute('aria-busy') === 'true',
      lang: document.documentElement.lang || '',
      theme: document.documentElement.dataset.theme || document.querySelector('.editor-app')?.dataset.theme || '',
      text: text.slice(0, 32_000),
      projectId: projectSelect?.value ?? '',
      projectName,
      revision: Number((revisionText.match(/r(\\d+)/) ?? [])[1] ?? -1),
      assets: [...document.querySelectorAll('.media-card strong')].map((node) => node.textContent?.trim() ?? ''),
      selectedAssetName: document.querySelector('.media-card[aria-pressed="true"] strong')?.textContent?.trim() ?? '',
      mediaSources: [...document.querySelectorAll('video[src], audio[src], img[src]')]
        .map((node) => ({ tag: node.tagName.toLowerCase(), src: node.getAttribute('src') ?? '' }))
        .slice(0, 8),
      transcriptCount: document.querySelectorAll('.transcript-row').length,
      captionCount: document.querySelectorAll('.caption-list li').length,
      jobStates: [...document.querySelectorAll('.job')].map((node) =>
        [...node.classList].find((name) => name.startsWith('job-') && name !== 'job')?.slice(4) ?? ''
      ).filter(Boolean),
      syncText: document.querySelector('.agent-sync-status')?.textContent?.trim() ?? '',
      capabilityTitle: document.querySelector('.connection[title]')?.getAttribute('title') ?? '',
      notices: [...document.querySelectorAll('.notice')].map((node) => ({
        className: node.className,
        text: node.textContent?.trim() ?? ''
      })).slice(0, 16),
      boundaryNotes: [...document.querySelectorAll('.boundary-note')]
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 12)
    }
  })()`)
}

async function waitForGuestSnapshot(electronApplication, predicate, description, timeoutMs) {
  let last
  try {
    return await pollUntil(async () => {
      last = await readGuestSnapshot(electronApplication)
      return predicate(last) ? last : undefined
    }, { timeoutMs, description })
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; ` +
      `last guest state: ${guestDiagnostic(last)}`
    )
  }
}

async function setGuestFormValue(electronApplication, selector, value) {
  const updated = await evaluateVideoEditorGuest(electronApplication, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  if (!updated) throw new Error(`Cannot set Kun Video Editor form control: ${selector}`)
}

async function submitGuestForm(electronApplication, selector) {
  const submitted = await evaluateVideoEditorGuest(electronApplication, `(() => {
    const form = document.querySelector(${JSON.stringify(selector)})
    if (!(form instanceof HTMLFormElement)) return false
    form.requestSubmit()
    return true
  })()`)
  if (!submitted) throw new Error(`Cannot submit Kun Video Editor form: ${selector}`)
}

async function clickGuestButton(electronApplication, text, withinSelector, timeoutMs = 15_000) {
  try {
    await pollUntil(() => evaluateVideoEditorGuest(electronApplication, `(() => {
      const root = ${withinSelector ? `document.querySelector(${JSON.stringify(withinSelector)})` : 'document'}
      if (!root) return false
      const button = [...root.querySelectorAll('button')].find((candidate) =>
        (
          candidate.textContent?.trim() === ${JSON.stringify(text)} ||
          candidate.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(text)} ||
          candidate.childNodes[0]?.textContent?.trim() === ${JSON.stringify(text)}
        ) && !candidate.disabled
      )
      if (!button) return false
      button.click()
      return true
    })()`), {
      timeoutMs,
      description: `enabled video editor button ${JSON.stringify(text)}`
    })
  } catch (error) {
    const snapshot = await readGuestSnapshot(electronApplication).catch(() => undefined)
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}: ${guestDiagnostic(snapshot)}`
    )
  }
}

async function clickGuestSelector(electronApplication, selector, index = 0) {
  const clicked = await evaluateVideoEditorGuest(electronApplication, `(() => {
    const candidate = document.querySelectorAll(${JSON.stringify(selector)})[${Number(index)}]
    if (!(candidate instanceof HTMLElement) || candidate.matches(':disabled')) return false
    candidate.click()
    return true
  })()`)
  if (!clicked) throw new Error(`Cannot click video editor selector ${selector} at index ${index}`)
}

async function applyWorkbenchSettings(workbench, patch) {
  const result = await workbench.evaluate(async (settingsPatch) => {
    const saved = await globalThis.kunGui.setSettings(settingsPatch)
    globalThis.dispatchEvent(new CustomEvent('kun:settings-changed', { detail: saved }))
    return { locale: saved.locale, theme: saved.theme }
  }, patch)
  if (result.locale !== patch.locale || result.theme !== patch.theme) {
    throw new Error(`Kun did not persist locale/theme E2E patch: ${JSON.stringify(result)}`)
  }
}

async function startAgentToolTurn(workbench, workspaceRoot) {
  return workbench.evaluate(async ({ workspace, model }) => {
    const request = async (path, method, body) => {
      const response = await globalThis.kunGui.runtimeRequest(
        path,
        method,
        body === undefined ? undefined : JSON.stringify(body)
      )
      if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${response.body}`)
      return response.body ? JSON.parse(response.body) : undefined
    }
    const thread = await request('/v1/threads', 'POST', {
      title: 'Kun Video Editor desktop E2E Agent sync',
      workspace,
      model,
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access'
    })
    const turn = await request(`/v1/threads/${encodeURIComponent(thread.id)}/turns`, 'POST', {
      prompt: 'Select the requested video project using the registered video-project extension tool.',
      model,
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      disableUserInput: true
    })
    return { threadId: thread.id, turnId: turn.turnId }
  }, { workspace: workspaceRoot, model: MODEL_NAME })
}

async function waitForAgentTurn(workbench, turn, timeoutMs) {
  return pollUntil(async () => {
    const response = await workbench.evaluate(async ({ threadId, turnId }) => {
      return globalThis.kunGui.runtimeRequest(
        `/v1/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}`,
        'GET'
      )
    }, turn)
    if (!response.ok) throw new Error(`Cannot read Agent E2E turn (${response.status}): ${response.body}`)
    const body = JSON.parse(response.body)
    return ['completed', 'failed', 'aborted'].includes(body.status) ? body : undefined
  }, { timeoutMs, description: 'Main Agent extension-tool turn completion' })
}

async function startOfflineModelFixture() {
  const state = {
    targetProjectId: '',
    requests: 0,
    toolCallIssued: false,
    toolResultObserved: false,
    lastToolNames: [],
    lastPath: ''
  }
  const server = createHttpServer(async (request, response) => {
    state.lastPath = request.url ?? ''
    if (request.method === 'GET' && /\/models(?:\?|$)/u.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: MODEL_NAME, object: 'model' }] }))
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'offline model fixture only supports POST chat completions' } }))
      return
    }
    let body = ''
    for await (const chunk of request) body = `${body}${String(chunk)}`.slice(-4 * 1024 * 1024)
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid JSON' } }))
      return
    }
    state.requests += 1
    const toolNames = Array.isArray(parsed.tools)
      ? parsed.tools.map((tool) => tool?.function?.name).filter((name) => typeof name === 'string')
      : []
    state.lastToolNames = toolNames
    const projectTool = toolNames.find((name) => name.endsWith('_video-project'))
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const sawToolResult = messages.some((message) => message?.role === 'tool')
    if (sawToolResult) state.toolResultObserved = true

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    })
    if (!state.toolCallIssued && state.targetProjectId && projectTool) {
      state.toolCallIssued = true
      for (const frame of openAiToolCallFrames({
        toolName: projectTool,
        argumentsJson: JSON.stringify({ action: 'select', projectId: state.targetProjectId })
      })) response.write(frame)
    } else {
      for (const frame of openAiTextFrames(
        sawToolResult
          ? 'Kun Video Editor desktop E2E selected the project through the extension tool.'
          : 'Kun Video Editor desktop E2E model fixture is ready.'
      )) response.write(frame)
    }
    response.end()
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  if (!port) throw new Error('Could not start the offline desktop E2E model fixture')
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    setTargetProjectId(projectId) {
      state.targetProjectId = projectId
      state.toolCallIssued = false
      state.toolResultObserved = false
    },
    snapshot() {
      return structuredClone(state)
    },
    close() {
      return new Promise((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise())
        server.closeAllConnections?.()
      })
    }
  }
}

function openAiToolCallFrames({ toolName, argumentsJson }) {
  const id = 'chatcmpl-kun-video-editor-desktop-e2e'
  return [
    sseFrame({
      id,
      object: 'chat.completion.chunk',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: 'call_video_project_desktop_e2e',
            type: 'function',
            function: { name: toolName, arguments: argumentsJson }
          }]
        },
        finish_reason: null
      }]
    }),
    sseFrame({
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
    }),
    'data: [DONE]\n\n'
  ]
}

function openAiTextFrames(text) {
  const id = 'chatcmpl-kun-video-editor-desktop-e2e-text'
  return [
    sseFrame({
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    }),
    sseFrame({
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    }),
    'data: [DONE]\n\n'
  ]
}

function sseFrame(value) {
  return `data: ${JSON.stringify(value)}\n\n`
}

function assertNoGuestErrors(snapshot, operation) {
  const errors = snapshot.notices.filter(({ className }) => /notice-error/u.test(className))
  if (errors.length > 0) {
    throw new Error(
      `Kun Video Editor reported an error while ${operation}: ${JSON.stringify(errors)}. ` +
      `Capability guidance: ${snapshot.capabilityTitle || snapshot.boundaryNotes.join(' | ') || 'none'}. ` +
      'For media failures: Install FFmpeg with libx264 and AAC plus ffprobe, or set absolute ' +
      `KUN_FFMPEG_PATH/KUN_FFPROBE_PATH values. Guest state: ${guestDiagnostic(snapshot)}`
    )
  }
}

function guestDiagnostic(snapshot) {
  if (!snapshot) return 'unavailable'
  return JSON.stringify({
    ready: snapshot.ready,
    busy: snapshot.busy,
    lang: snapshot.lang,
    theme: snapshot.theme,
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    revision: snapshot.revision,
    assets: snapshot.assets,
    selectedAssetName: snapshot.selectedAssetName,
    mediaSources: snapshot.mediaSources,
    transcriptCount: snapshot.transcriptCount,
    captionCount: snapshot.captionCount,
    jobStates: snapshot.jobStates,
    syncText: snapshot.syncText,
    capabilityTitle: snapshot.capabilityTitle,
    notices: snapshot.notices,
    text: snapshot.text?.slice(0, 2_000)
  })
}

async function pollUntil(operation, { timeoutMs, description, intervalMs = 100 }) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await operation()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await delay(intervalMs)
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${description}` +
    `${lastError ? `; last error: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ''}`
  )
}

async function availablePort() {
  const server = createNetServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise())
  })
  if (!port) throw new Error('Could not allocate a desktop E2E runtime port')
  return port
}

function sha256FileBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertRegularFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing ${label}: ${path}`)
}

async function assertNonEmptyFile(path, label) {
  const details = await stat(path)
  if (!details.isFile() || details.size <= 0) throw new Error(`${label} is missing or empty: ${path}`)
  return { bytes: details.size, sha256: sha256FileBytes(await readFile(path)) }
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

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

module.exports = {
  CONTRIBUTION_ID,
  EXTENSION_ID,
  EXTENSION_VERSION,
  MODEL_NAME,
  SUCCESS_MARKER,
  VIDEO_EDITOR_PERMISSIONS,
  assertLocalizedFirstLaunchPermissionPrompt,
  desktopVideoEditorSettings,
  evaluateVideoEditorGuest,
  findWorkbenchWindow,
  guestDiagnostic,
  launchPackagedDesktop,
  openVideoEditor,
  openAiTextFrames,
  openAiToolCallFrames,
  readGuestSnapshot,
  resolveVideoEditorArchive,
  sseFrame,
  waitForGuestSnapshot
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
