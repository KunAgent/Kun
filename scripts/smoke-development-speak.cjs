#!/usr/bin/env node

'use strict'

/**
 * Drives the Speak action and the Speak settings section in the real
 * application shell.
 *
 * Pass --assets <dir> (or set KUN_KOKORO_TEST_ASSETS) with a directory holding
 * `model_quantized.onnx` and `af_heart.bin` to exercise real synthesis; the
 * files are linked into the isolated user-data directory so the download path
 * is skipped. Without them the run still covers the settings surface and the
 * download toast that appears on the first Speak.
 */

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, symlink, writeFile } = require('node:fs/promises')
const { createConnection, createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
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

const DEFAULT_TIMEOUT_MS = 180_000
const VIEWPORT = { width: 1_280, height: 900 }
const MODEL_ID = 'kokoro-82m-int8'
const MODEL_FILE = 'model_quantized.onnx'
const VOICE_ID = 'af_heart'

async function main() {
  const repositoryRoot = resolve(join(__dirname, '..'))
  const timeoutMs = positiveIntegerArgument('--timeout-ms', DEFAULT_TIMEOUT_MS)
  const evidenceRoot = resolve(
    argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'speak-smoke')
  )
  const assetDir = argumentValue('--assets') ?? process.env.KUN_KOKORO_TEST_ASSETS ?? ''
  const seedAssets = Boolean(
    assetDir
    && existsSync(join(resolve(assetDir), MODEL_FILE))
    && existsSync(join(resolve(assetDir), `${VOICE_ID}.bin`))
  )
  const electronExecutable = require('electron')
  const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const rendererConfig = join(repositoryRoot, 'scripts', 'vite-development-renderer.config.mjs')
  const mainEntry = join(repositoryRoot, 'out', 'main', 'index.js')
  for (const [label, path] of [
    ['Electron executable', electronExecutable], ['Vite CLI', viteCli],
    ['renderer config', rendererConfig], ['built Main entry', mainEntry]
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}. Run npm run build first.`)
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-speak-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await mkdtemp(join(workspaceParent, 'speak-'))
  const runtimePort = await availablePort()
  let rendererPort = await availablePort()
  while (rendererPort === runtimePort) rendererPort = await availablePort()

  let rendererProcess
  let electronApplication
  let workbenchPage
  let primaryError
  const result = { seededAssets: seedAssets, steps: [] }
  try {
    await Promise.all([
      mkdir(profile, { recursive: true }), mkdir(userData, { recursive: true }),
      mkdir(appData, { recursive: true }), mkdir(localAppData, { recursive: true }),
      mkdir(temporaryDirectory, { recursive: true }), mkdir(evidenceRoot, { recursive: true })
    ])
    if (seedAssets) await linkKokoroAssets(resolve(assetDir), userData)

    const settings = {
      ...desktopSmokeSettings(runtimePort, workspaceRoot, profile),
      locale: 'en', theme: 'light', uiFontScale: 1
    }
    const serialized = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({
      platform: process.platform, home, appData, explicitUserData: userData
    }).map(async (directory) => {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'kun-settings.json'), serialized)
    }))

    const environment = developmentRendererEnvironment(
      createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory }),
      { rendererPort, temporaryRoot }
    )
    environment.NODE_ENV = 'development'
    rendererProcess = spawn(
      process.execPath,
      [viteCli, '--config', rendererConfig, '--logLevel', 'warn'],
      {
        cwd: repositoryRoot, env: environment,
        detached: process.platform !== 'win32', windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    await waitForPortOpen(rendererPort, timeoutMs, rendererProcess)

    electronApplication = await _electron.launch({
      executablePath: electronExecutable,
      args: [
        `--user-data-dir=${userData}`, '--no-first-run', '--disable-background-networking',
        '--disable-component-update', '--disable-default-apps',
        ...platformDesktopArguments(process.platform), repositoryRoot
      ],
      cwd: repositoryRoot, env: environment, chromiumSandbox: true, timeout: timeoutMs
    })
    const page = await findWorkbenchWindow(electronApplication, timeoutMs)
    workbenchPage = page
    page.setDefaultTimeout(30_000)
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize(VIEWPORT)

    result.steps.push(await verifySettingsSection(page, evidenceRoot))
  result.steps.push(await verifyRecommendedModelTier(page, evidenceRoot))
    result.steps.push(await verifySpeakAction(page, evidenceRoot, seedAssets))
    await writeFile(
      join(evidenceRoot, 'result.json'),
      `${JSON.stringify(result, null, 2)}\n`
    )
    console.log(`[speak-smoke] PASS (assets seeded: ${seedAssets})`)
    console.log(`[speak-smoke] evidence: ${evidenceRoot}`)
  } catch (error) {
    primaryError = error
    await captureFailure(evidenceRoot, error, workbenchPage).catch(() => undefined)
  } finally {
    await electronApplication?.close().catch(() => undefined)
    if (rendererProcess) await terminateProcessTree(rendererProcess).catch(() => undefined)
  }
  if (primaryError) throw primaryError
}

/** Link pre-downloaded weights into the layout the download service publishes. */
async function linkKokoroAssets(assetDir, userData) {
  const base = join(userData, 'models', 'speech', 'kokoro')
  await mkdir(join(base, MODEL_ID), { recursive: true })
  await mkdir(join(base, 'voices'), { recursive: true })
  await symlink(join(assetDir, MODEL_FILE), join(base, MODEL_ID, MODEL_FILE))
  await symlink(join(assetDir, `${VOICE_ID}.bin`), join(base, 'voices', `${VOICE_ID}.bin`))
}

async function verifySettingsSection(page, evidenceRoot) {
  // The local speech provider lives under Media -> Speech generation, so the
  // smoke navigates the way a user does rather than to a route of its own.
  await page.evaluate(async () => {
    const store = await import('/src/store/chat-store.ts')
    store.useChatStore.getState().openSettings('mediaGeneration')
  })
  await page.locator('#media-generation-settings-tab-speech').click()
  await page.locator('#media-generation-settings-panel-speech').waitFor()
  const voiceSelect = page.getByLabel('Voice', { exact: true })
  await voiceSelect.waitFor()
  const options = await voiceSelect.locator('option').count()
  if (options < 20) throw new Error(`Speak settings listed only ${options} voices`)
  const groups = await voiceSelect.locator('optgroup').allTextContents()
  if (groups.length !== 2) throw new Error(`Expected American and British groups, got ${groups.length}`)
  await page.getByRole('button', { name: 'Play' }).waitFor()
  await page.getByLabel('Speed').waitFor()
  for (const label of ['Kokoro 82M (int8)', 'Kokoro 82M (fp16)', 'Kokoro 82M (fp32)']) {
    await page.getByRole('button', { name: label }).waitFor()
  }
  // Keep generated tracks, so the Speak step exercises storing, replaying and
  // offering the recording for download.
  const keepTracks = page.getByLabel('Keep generated tracks')
  await keepTracks.waitFor()
  if ((await keepTracks.getAttribute('aria-checked')) !== 'true') await keepTracks.click()
  await page.getByRole('button', { name: 'Clear' }).waitFor()
  await page.screenshot({ path: join(evidenceRoot, 'settings-speak.png'), fullPage: false })
  return { step: 'settings', voices: options, accentGroups: groups.length, keepTracks: true }
}

/**
 * The recommended tier depends on the host: the quantized graph is the slower
 * one on arm64, so the badge has to follow the architecture rather than a fixed
 * flag in the catalog.
 */
async function verifyRecommendedModelTier(page, evidenceRoot) {
  const expected = process.arch === 'arm64' ? 'kokoro-82m-fp16' : 'kokoro-82m-int8'
  const card = page.locator(`#media-generation-settings-panel-speech [data-speak-model="${expected}"]`)
  await card.waitFor()
  await card.scrollIntoViewIfNeeded()
  const recommended = await page
    .locator('#media-generation-settings-panel-speech [data-speak-model-recommended="true"]')
    .all()
  const ids = await Promise.all(recommended.map((node) => node.getAttribute('data-speak-model')))
  if (ids.length !== 1 || ids[0] !== expected) {
    throw new Error(
      `Expected only ${expected} to be recommended on ${process.arch}, got: ${ids.join(', ') || 'none'}`
    )
  }
  await page.screenshot({ path: join(evidenceRoot, 'settings-speak-models.png') })
  return { step: 'models', arch: process.arch, recommended: expected }
}

/**
 * Watch how responsive the application stays over a window.
 *
 * `pingLocalKokoroMain` does no I/O, so a slow reply means the Main event loop
 * itself is blocked. Synthesis used to block it for the whole length of every
 * chunk, which is what put the spinning cursor on screen, so this is measured
 * while an answer is actually being spoken.
 */
async function observeResponsiveness(page, label, durationMs, untilIdle = false) {
  const result = await page.evaluate(async ({ ms, untilIdle }) => {
    const bridge = window.kunGui
    const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
    const t0 = performance.now()
    const deadline = Date.now() + ms
    const drift = { max: 0, last: performance.now() }
    const timer = window.setInterval(() => {
      const now = performance.now()
      drift.max = Math.max(drift.max, now - drift.last - 16)
      drift.last = now
    }, 16)
    const done = () => Date.now() >= deadline
      || (untilIdle && fixture.readAssistantSpeakSmokeState().phase === 'idle')

    const pings = []
    const pinger = (async () => {
      while (!done()) {
        const t = performance.now()
        await bridge.pingLocalKokoroMain()
        pings.push(Math.round(performance.now() - t))
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }
    })()
    const chunkMarks = []
    const chunkWatch = (async () => {
      let seen = 0
      while (!done()) {
        const state = fixture.readAssistantSpeakSmokeState()
        if (state.spokenChunks > seen) {
          seen = state.spokenChunks
          chunkMarks.push(Math.round(performance.now() - t0))
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50))
      }
    })()

    await Promise.all([pinger, chunkWatch])
    window.clearInterval(timer)
    return {
      windowMs: Math.round(performance.now() - t0),
      rendererDriftMax: Math.round(drift.max),
      mainBlockMaxMs: pings.length === 0 ? -1 : Math.max(...pings),
      pingSamples: pings.length,
      chunkMarks
    }
  }, { ms: durationMs, untilIdle })
  console.log(`[speak-smoke] ${label}:`, JSON.stringify(result))
  return result
}

/**
 * Longest Main-process stall tolerated while an answer is spoken. Measured
 * 2,467-3,393 ms when synthesis ran on the Main thread and 6 ms once it moved
 * to a worker, so anything in between means it moved back.
 */
const MAX_MAIN_BLOCK_MS = 400

async function verifySpeakAction(page, evidenceRoot, seedAssets) {
  await page.evaluate(async () => {
    const store = await import('/src/store/chat-store.ts')
    store.useChatStore.getState().closeSettings()
    const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
    fixture.mountAssistantSpeakSmokeFixture()
  })
  const stage = page.locator('[data-testid="assistant-speak-smoke-stage"]')
  await stage.waitFor()
  // Markdown rendering is async; wait for the heading and code block to land
  // so the evidence shows the answer as a reader sees it.
  await stage.locator('h2').waitFor()
  await stage.locator('pre').waitFor()
  const speak = page.locator('button[data-speak-state]')
  await speak.waitFor()
  if ((await speak.getAttribute('data-speak-state')) !== 'idle') {
    throw new Error('Speak action did not start in the idle state')
  }
  // The action row is hover-only until an answer is speaking.
  await stage.hover()
  await speak.getByText('Speak').waitFor()
  await page.screenshot({ path: join(evidenceRoot, 'answer-actions-idle.png') })

  // Record renderer event-loop drift across the whole Speak run: a spinner the
  // user waits on is one complaint, a frozen window is a different one, and the
  // numbers below are what tell them apart.
  // Timed inside the page so Playwright round trips and screenshots stay out of
  // the number: `firstAudioMs` is click to the first scheduled audio.
  await page.evaluate(() => {
    const probe = { max: 0, last: performance.now(), timer: 0, start: performance.now(), firstAudioMs: -1 }
    probe.timer = window.setInterval(() => {
      const now = performance.now()
      probe.max = Math.max(probe.max, now - probe.last - 16)
      probe.last = now
    }, 16)
    const observer = new MutationObserver(() => {
      const state = document.querySelector('button[data-speak-state]')?.getAttribute('data-speak-state')
      if (state === 'speaking' && probe.firstAudioMs < 0) {
        probe.firstAudioMs = performance.now() - probe.start
      }
    })
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-speak-state'] })
    Object.assign(window, { __speakLag: probe })
  })

  await page.evaluate(() => {
    const probe = window.__speakLag
    if (probe) {
      probe.start = performance.now()
      probe.firstAudioMs = -1
      probe.max = 0
      probe.last = performance.now()
    }
  })

  await speak.click()
  // The icon slot must become a spinner while the first chunk is produced.
  await page.waitForFunction(() => {
    const button = document.querySelector('button[data-speak-state]')
    const state = button?.getAttribute('data-speak-state') ?? 'idle'
    return ['preparing', 'downloading', 'synthesizing'].includes(state)
      && Boolean(button?.querySelector('svg.animate-spin'))
  }, undefined, { timeout: 30_000 })
  const busyState = await speak.getAttribute('data-speak-state')
  await page.screenshot({ path: join(evidenceRoot, 'answer-actions-loading.png') })
  // A CDP screenshot stalls the renderer for a few hundred milliseconds, which
  // would otherwise be reported as Speak-caused jank.
  await page.evaluate(() => {
    const probe = window.__speakLag
    if (probe) {
      probe.max = 0
      probe.last = performance.now()
    }
  })

  if (!seedAssets) {
    await page.locator('[data-testid="speak-download-toast"]').waitFor({ timeout: 30_000 })
    await page.screenshot({ path: join(evidenceRoot, 'download-toast.png') })
    const idleLag = (await readSpeakLag(page)).driftMs
    await page.evaluate(async () => {
      const controller = await import('/src/components/chat/speak-controller.ts')
      controller.stopSpeaking()
    })
    return { step: 'speak', busyState, observed: 'download-toast', maxRendererDriftMs: idleLag }
  }

  await page.waitForFunction(() => {
    const button = document.querySelector('button[data-speak-state]')
    return button?.getAttribute('data-speak-state') === 'speaking'
  }, undefined, { timeout: 60_000 })
  const { firstAudioMs, driftMs } = await readSpeakLag(page)
  await page.screenshot({ path: join(evidenceRoot, 'answer-actions-speaking.png') })
  const speaking = await page.evaluate(async () => {
    const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
    return fixture.readAssistantSpeakSmokeState()
  })
  if (speaking.activeBlockId !== 'speak-smoke-answer') {
    throw new Error(`Unexpected speaking block: ${speaking.activeBlockId}`)
  }
  // Wait for a second chunk so pacing is exercised: the gap is only observable
  // once a chunk has to be produced inside the previous chunk's audio.
  const paced = await page.evaluate(async () => {
    const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const state = fixture.readAssistantSpeakSmokeState()
      if (state.spokenChunks >= 2 || state.phase === 'idle') return state
      await new Promise((resolve) => window.setTimeout(resolve, 200))
    }
    return fixture.readAssistantSpeakSmokeState()
  })
  const during = await observeResponsiveness(page, 'during playback', 90_000, true)
  if (during.mainBlockMaxMs > MAX_MAIN_BLOCK_MS) {
    throw new Error(
      `Main process blocked for ${during.mainBlockMaxMs} ms while speaking `
      + `(limit ${MAX_MAIN_BLOCK_MS} ms) - synthesis is running on the Main thread`
    )
  }
  if (paced.droppedSeconds > MAX_PLAYBACK_GAP_SECONDS) {
    throw new Error(
      `Playback gapped for ${paced.droppedSeconds.toFixed(2)} s `
      + `(limit ${MAX_PLAYBACK_GAP_SECONDS} s) after ${paced.spokenChunks} chunks`
    )
  }
  // Clicking the same action again stops playback.
  await speak.click()
  await page.waitForFunction(() => (
    document.querySelector('button[data-speak-state]')?.getAttribute('data-speak-state') === 'idle'
  ), undefined, { timeout: 20_000 })
  // The recording is written once the audio exists, and the download action
  // appears beside Speak. A second Speak must replay it without synthesizing.
  const download = page.locator('button[data-speak-track-state]')
  await download.waitFor({ timeout: 60_000 })
  await stage.hover()
  await page.screenshot({ path: join(evidenceRoot, 'answer-actions-track.png') })
  const replay = await measureCachedReplay(page, speak)

  if (driftMs > MAX_RENDERER_DRIFT_MS) {
    throw new Error(`Renderer blocked for ${driftMs} ms during Speak (limit ${MAX_RENDERER_DRIFT_MS} ms)`)
  }
  if (firstAudioMs > MAX_FIRST_AUDIO_MS) {
    throw new Error(`Speak took ${firstAudioMs} ms to start (limit ${MAX_FIRST_AUDIO_MS} ms)`)
  }
  return {
    step: 'speak',
    busyState,
    observed: 'synthesized-and-stopped',
    clickToFirstAudioMs: firstAudioMs,
    maxRendererDriftMs: driftMs,
    spokenChunks: paced.spokenChunks,
    playbackGapSeconds: Number(paced.droppedSeconds.toFixed(3)),
    playbackMainBlockMs: during.mainBlockMaxMs,
    playbackRendererDriftMs: during.rendererDriftMax,
    cachedReplayMs: replay.elapsedMs
  }
}

/**
 * Silence tolerated between chunks. Synthesis has to finish inside the audio
 * the previous chunk bought; anything above this is an audible stutter.
 */
const MAX_PLAYBACK_GAP_SECONDS = 0.15

/**
 * Speaking an answer whose recording is stored must not synthesize again.
 *
 * The first run needs seconds per chunk; replaying a file is bounded by reading
 * it, so the limit sits far below any synthesis.
 */
const MAX_CACHED_REPLAY_MS = 2_500

async function measureCachedReplay(page, speak) {
  const readState = async () => page.evaluate(async () => {
    const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
    return fixture.readAssistantSpeakSmokeState()
  })
  const before = (await readState()).storedPlaybacks
  const startedAt = Date.now()
  await speak.click()
  // The counter is the signal, not the visible phase: replaying a file can
  // finish before the next repaint, so the phase may never be observed.
  try {
    await page.waitForFunction(async (baseline) => {
      const fixture = await import('/src/components/chat/AssistantSpeakSmokeFixture.tsx')
      return fixture.readAssistantSpeakSmokeState().storedPlaybacks > baseline
    }, before, { timeout: 30_000 })
  } catch {
    throw new Error(`Stored recording was not replayed: ${JSON.stringify(await readState())}`)
  }
  const elapsedMs = Date.now() - startedAt
  if (elapsedMs > MAX_CACHED_REPLAY_MS) {
    throw new Error(
      `Stored recording took ${elapsedMs} ms to start (limit ${MAX_CACHED_REPLAY_MS} ms) `
      + '- it was probably synthesized again'
    )
  }
  await page.evaluate(async () => {
    const controller = await import('/src/components/chat/speak-controller.ts')
    controller.stopSpeaking()
  })
  await page.waitForFunction(() => (
    document.querySelector('button[data-speak-state]')?.getAttribute('data-speak-state') === 'idle'
  ), undefined, { timeout: 20_000 })
  return { elapsedMs }
}


/**
 * Longest wait tolerated between clicking Speak and the first scheduled audio.
 *
 * Measured 3.3-5.0 s on an M-series machine with the int8 tier, against 14.7 s
 * before the opening chunks were kept short. The limit sits above the observed
 * spread so a loaded machine does not fail, and well below the regression it
 * exists to catch.
 */
const MAX_FIRST_AUDIO_MS = 9_000

/** Largest renderer event-loop stall tolerated while Speak runs. */
const MAX_RENDERER_DRIFT_MS = 1_000

async function readSpeakLag(page) {
  return page.evaluate(() => {
    const probe = window.__speakLag
    if (!probe) return { firstAudioMs: -1, driftMs: -1 }
    window.clearInterval(probe.timer)
    return { firstAudioMs: Math.round(probe.firstAudioMs), driftMs: Math.round(probe.max) }
  })
}

/** Persist the failure text so a headless run leaves something to read. */
async function captureFailure(evidenceRoot, error, page) {
  await writeFile(join(evidenceRoot, 'failure.txt'), `${error?.stack ?? error}\n`)
  await page?.screenshot({ path: join(evidenceRoot, 'failure.png') }).catch(() => undefined)
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function positiveIntegerArgument(flag, fallback) {
  const raw = argumentValue(flag)
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} must be a positive integer`)
  return value
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForPortOpen(port, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Renderer exited early with code ${child.exitCode}`)
    }
    const open = await new Promise((resolveOpen) => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolveOpen(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolveOpen(false)
      })
    })
    if (open) return
    await new Promise((wait) => setTimeout(wait, 250))
  }
  throw new Error(`Renderer port ${port} never opened`)
}

main().catch((error) => {
  console.error(`[speak-smoke] FAIL: ${error?.stack ?? error}`)
  process.exitCode = 1
})
