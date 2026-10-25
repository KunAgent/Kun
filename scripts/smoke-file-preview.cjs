#!/usr/bin/env node
'use strict'

// File tree + file preview smoke on an isolated profile: real Electron and Kun
// runtime, a seeded git workspace with files the old extension whitelist could
// not open (dotfiles, LICENSE, GBK and BOM-less UTF-16 text, binaries, CSV,
// a large log, HEIC and video when the host can make them). Opens the Files
// rail, searches, filters changed files and screenshots every preview state.
//   npm run build && node scripts/smoke-file-preview.cjs [--locale zh] [--theme dark] [--keep-dirs]
// Screenshots and report.json land under dist/file-preview-smoke (or --evidence <dir>).

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { _electron } = require('playwright-core')
const {
  createIsolatedEnvironment, desktopSmokeSettings, desktopSmokeWorkspaceParent, desktopUserDataCandidates,
  platformDesktopArguments, stopIsolatedServiceManager, stopIsolatedSharedRuntime, releaseChildProcessHandles, withTimeout
} = require('./smoke-packaged-extension-desktop-runtime.cjs')
const { availablePort, argumentValue, positiveIntegerArgument, terminateProcessTree } = require('./smoke-packaged-extension-desktop-process.cjs')
const { findWorkbenchWindow } = require('./smoke-packaged-video-editor-desktop.cjs')

const diagnostics = { optional: {} }
const PNG_RED_DOT = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAIElEQVR42mP8z8Dwn4GBgYGJAQoYGRj+MzAwMIIYDAwAWdwEARrlj2oAAAAASUVORK5CYII='

function tool(command, args, cwd) {
  try {
    execFileSync(command, args, { cwd, stdio: 'ignore', timeout: 30_000 })
    return true
  } catch {
    return false
  }
}

async function seedWorkspace(root) {
  const write = async (path, content) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await write('README.md', '# Kun\n\nLocal-first AI coding workbench.\n\n| Type | Viewer |\n| --- | --- |\n| Text | Highlighted |\n')
  await write('LICENSE', 'MIT License\n\nCopyright (c) 2026 Kun contributors\n')
  await write('.env.local', '# local only\nKUN_RUNTIME_PORT=18899\nKUN_LOG_LEVEL=debug\n')
  await write('src/renderer/lib/workspace-text-preview.ts', "export function kind(path: string): string {\n  return path.endsWith('.md') ? 'markdown' : 'text'\n}\n")
  await write('src/renderer/lib/old-helpers.ts', 'export const legacy = true\n')
  await write('src/main/core.ts', 'export const core = 1\n')
  await write('.gitignore', 'dist/\n')
  await write('dist/bundle.js', '// generated\n')
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=smoke@kun.local', '-c', 'user.name=Kun', 'add', '.'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=smoke@kun.local', '-c', 'user.name=Kun', 'commit', '-q', '-m', 'init'], { cwd: root })
  await write('src/renderer/lib/workspace-text-preview.ts', "export function kind(path: string): string {\n  return 'text'\n}\n")
  await rm(join(root, 'src/renderer/lib/old-helpers.ts'))
  await write('notes/requirements-gbk.txt', Buffer.from('bfcdbba7d0e8c7f30a312e20cec4bcfec4bfc2bc0a', 'hex'))
  await write('notes/utf16-nobom.txt', Buffer.from('hello utf16 without a BOM\n', 'utf16le'))
  await write('reports/usage.csv', 'date,agent,input_tokens,cost\n2026-10-19,Kun,1824331,6.42\n2026-10-20,"Kun, Inc",2210980,7.81\n')
  await write('logs/agent-run.log', Array.from({ length: 70_000 }, (_, index) => `2026-10-20 14:02:${String(index % 60).padStart(2, '0')} INFO runtime line ${index}`).join('\n'))
  await write('vendor/kun-remote-0.2.1.tgz', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0xec, 0x5d, 0x7b, 0x73]))
  await write('empty.txt', '')
  await write('site/index.html', '<!doctype html><html><body><h1>Hello from the HTML preview</h1></body></html>')
  await write('assets/dot.png', Buffer.from(PNG_RED_DOT, 'base64'))
  diagnostics.optional.heic = process.platform === 'darwin' &&
    tool('/usr/bin/sips', ['-s', 'format', 'heic', join(root, 'assets/dot.png'), '--out', join(root, 'assets/photo.heic')])
  diagnostics.optional.video = tool('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x4f6bed:s=320x180:d=1',
    '-c:v', 'libvpx-vp9', '-y', join(root, 'assets/clip.webm')])
  diagnostics.optional.mp4 = tool('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x4f6bed:s=320x180:d=1',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-y', join(root, 'assets/clip.mp4')])
}

async function poll(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { if (await check()) return } catch (error) { last = error }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250))
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`)
}

const tree = '[role="tree"]:visible'
const row = (name) => `${tree} [data-tree-row$="/${name}"]`
const preview = '.ds-code-sidebar'

// Opening a file swaps the Files panel for the preview; its tree toggle brings the explorer back beside it.
async function clickRow(page, name, timeoutMs) {
  if ((await page.locator(tree).count()) === 0) {
    await page.locator(`${preview} button:has(svg.lucide-folder-tree)`).first().click()
    await page.locator(tree).first().waitFor({ timeout: timeoutMs })
  }
  await page.locator(row(name)).first().click()
}

async function openFile(page, name, ready, timeoutMs) {
  await clickRow(page, name, timeoutMs)
  // A narrow panel shows the explorer as an overlay; close it so the preview is unobstructed.
  const backdrop = page.locator('.ds-file-preview-explorer-backdrop:visible')
  if (await backdrop.count()) {
    const box = await backdrop.first().boundingBox()
    if (box) await page.mouse.click(box.x + box.width - 24, box.y + box.height / 2)
  }
  await page.locator(`${preview} ${ready}`).first().waitFor({ timeout: timeoutMs })
}

async function runFlow({ application, page, capture, timeoutMs, cspErrors, workspaceRoot: workspaceRootForProbe }) {
  const checks = []
  await page.locator('button:has(svg.lucide-folders)').first().click()
  await page.locator(tree).first().waitFor({ timeout: timeoutMs })
  await page.locator(row('README.md')).waitFor({ timeout: timeoutMs })
  await poll(async () => (await page.locator(`${tree} [data-git="untracked"]`).count()) > 0 &&
    (await page.locator(`${row('src')} .ds-file-tree-dot`).count()) === 1, timeoutMs, 'git markers')
  await capture('preview-01-tree')
  checks.push('The Files rail opens the tree with type icons, git markers and dimmed ignored folders')

  await openFile(page, '.env.local', '.ds-file-preview-code-html', timeoutMs)
  assert.match(await page.locator(`${preview} .ds-file-preview-code-html`).innerText(), /KUN_RUNTIME_PORT/)
  await openFile(page, 'LICENSE', '.ds-file-preview-code-html', timeoutMs)
  assert.match(await page.locator(`${preview} .ds-file-preview-code-html`).innerText(), /MIT License/)
  await capture('preview-02-license')
  checks.push('Dotfiles and extensionless files open as text instead of "not supported"')

  await clickRow(page, 'notes', timeoutMs)
  await openFile(page, 'requirements-gbk.txt', '.ds-file-preview-banner.is-info', timeoutMs)
  diagnostics.gbkText = await page.locator(`${preview} .ds-file-preview-code-html`).innerText()
  assert.match(diagnostics.gbkText, /客户需求/)
  await page.locator(`${preview} .ds-file-preview-statusbar [aria-haspopup="menu"]`).click()
  await capture('preview-03-gbk-encoding-menu')
  await page.keyboard.press('Escape')
  await openFile(page, 'utf16-nobom.txt', '.ds-file-preview-code-html', timeoutMs)
  assert.match(await page.locator(`${preview} .ds-file-preview-code-html`).innerText(), /hello utf16/)
  checks.push('GBK text decodes as GB18030 (read-only, encoding menu in the status bar); BOM-less UTF-16 opens as text')

  await clickRow(page, 'vendor', timeoutMs)
  await openFile(page, 'kun-remote-0.2.1.tgz', '.ds-file-preview-state', timeoutMs)
  await capture('preview-04-binary-card')
  await page.locator(`${preview} .ds-file-preview-link`).click()
  await page.locator(`${preview} .ds-file-preview-hex`).waitFor({ timeout: timeoutMs })
  assert.match(await page.locator(`${preview} .ds-file-preview-hex`).innerText(), /1f 8b 08 00/)
  await capture('preview-05-hex')
  checks.push('Binary files get a card with system-app and Finder actions plus a read-only hex view')

  await clickRow(page, 'logs', timeoutMs)
  await openFile(page, 'agent-run.log', '.ds-file-preview-banner.is-warning', timeoutMs)
  await capture('preview-06-large-log')
  await page.locator(`${preview} .ds-file-preview-banner.is-warning button`).click()
  await poll(async () => (await page.locator(`${preview} .ds-file-preview-banner.is-warning`).count()) === 0, timeoutMs, 'full log after load more')
  checks.push('A large log shows the head with a banner, and "Load more" reads the rest')

  await clickRow(page, 'reports', timeoutMs)
  await openFile(page, 'usage.csv', '.ds-file-preview-table', timeoutMs)
  assert.equal(await page.locator(`${preview} .ds-file-preview-table tbody tr`).count(), 2)
  await capture('preview-07-csv-table')
  checks.push('CSV opens as a table with quoted fields kept intact')

  await clickRow(page, 'assets', timeoutMs)
  await openFile(page, 'dot.png', '.ds-file-preview-image-stage img', timeoutMs)
  await poll(async () => (await page.locator(`${preview} .ds-file-preview-statusbar`).innerText()).includes('4 × 4'), timeoutMs, 'image size in the status bar')
  await page.locator(`${preview} .ds-file-preview-floating button[aria-label]`).nth(1).click()
  await page.locator(`${preview} .ds-file-preview-floating button[aria-label]`).nth(1).click()
  await page.locator(`${preview} img.is-pixelated`).waitFor({ timeout: timeoutMs })
  await capture('preview-08-image-zoom')
  if (diagnostics.optional.heic) {
    await openFile(page, 'photo.heic', '.ds-file-preview-image-stage img', timeoutMs)
    await capture('preview-09-heic')
    checks.push('HEIC converts to a PNG preview')
  }
  if (diagnostics.optional.video) {
    await application.evaluate(({ session }) => {
      globalThis.__previewNet = []
      const filter = { urls: ['kun-workspace-preview://*/*'] }
      session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
        globalThis.__previewNet.push({ event: 'before', type: details.resourceType, url: details.url.slice(-30) })
        callback({})
      })
      session.defaultSession.webRequest.onErrorOccurred(filter, (details) => {
        globalThis.__previewNet.push({ event: 'error', type: details.resourceType, error: details.error })
      })
      session.defaultSession.webRequest.onCompleted(filter, (details) => {
        globalThis.__previewNet.push({ event: 'done', type: details.resourceType, status: details.statusCode })
      })
    })
    // Plays each clip through a fresh lease; ERR_UNKNOWN_URL_SCHEME here means the protocol
    // handler was installed after the window was created.
    diagnostics.mediaProbe = await page.evaluate(async (workspace) => {
      const probe = async (path) => {
        const lease = await window.kunGui.openWorkspacePreviewResource({ path, workspaceRoot: workspace })
        if (!lease.ok) return { path, ok: false, message: lease.message }
        const video = document.createElement('video')
        video.preload = 'metadata'
        return new Promise((resolveProbe) => {
          video.onloadedmetadata = () => resolveProbe({ path, ok: true, width: video.videoWidth })
          video.onerror = () => resolveProbe({ path, ok: false, code: video.error?.code, message: video.error?.message })
          video.src = lease.url
        })
      }
      return [await probe(`${workspace}/assets/clip.webm`), await probe(`${workspace}/assets/clip.mp4`)]
    }, workspaceRootForProbe)
    diagnostics.previewNet = await application.evaluate(() => globalThis.__previewNet)
    assert.ok(diagnostics.mediaProbe[0].ok, `WebM failed to load: ${JSON.stringify(diagnostics.previewNet)}`)
    if (diagnostics.optional.mp4) assert.ok(diagnostics.mediaProbe[1].ok, 'MP4 (H.264) failed to load')
    await openFile(page, 'clip.webm', 'video', timeoutMs)
    await poll(async () => page.locator(`${preview} video`).evaluate((video) => video.readyState >= 1), timeoutMs, 'video metadata')
    await capture('preview-10-video')
    checks.push('Video plays from the workspace preview protocol (it used to be blocked by CSP and late protocol registration)')
  }

  await clickRow(page, 'site', timeoutMs)
  await openFile(page, 'index.html', '.ds-file-preview-code-html', timeoutMs)
  await page.locator(`${preview} [aria-pressed="false"]:has(svg.lucide-eye)`).click()
  await page.locator(`${preview} iframe`).waitFor({ timeout: timeoutMs })
  await poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().startsWith('kun-workspace-preview:'))
    return Boolean(frame && (await frame.locator('h1').count()) > 0)
  }, timeoutMs, 'rendered HTML inside the iframe')
  await capture('preview-11-html')
  checks.push('HTML renders in the sandboxed iframe')

  await openFile(page, 'empty.txt', '.ds-file-preview-state', timeoutMs)
  await openFile(page, 'README.md', '.ds-markdown h1', timeoutMs)
  await capture('preview-12-markdown')

  if ((await page.locator(tree).count()) === 0) await page.locator(`${preview} button:has(svg.lucide-folder-tree)`).first().click()
  const search = page.locator(tree).first().locator('xpath=..').locator('input')
  await search.fill('preview')
  await poll(async () => (await page.locator(`${tree} .ds-file-tree-hit`).count()) > 0, timeoutMs, 'search hits')
  await capture('preview-13-search')
  await search.fill('')
  checks.push('Search covers the whole workspace and highlights the match')

  await page.locator(tree).first().locator('xpath=..').locator('button[aria-pressed]:has(span.rounded-full)').first().click()
  await page.locator(row('old-helpers.ts')).waitFor({ timeout: timeoutMs })
  assert.equal(await page.locator(`${row('old-helpers.ts')}[data-git="deleted"]`).count(), 1)
  await capture('preview-14-changed-only')
  await openFile(page, 'old-helpers.ts', '.ds-file-preview-state-badge.is-danger', timeoutMs)
  await capture('preview-15-missing')
  checks.push('"Changed" shows the git changes as a tree; a deleted file opens the missing-file card')

  diagnostics.cspErrors = [...cspErrors]
  assert.deepEqual(cspErrors, [], 'Content Security Policy blocked a preview resource')
  return checks
}

async function main() {
  const repositoryRoot = resolve(__dirname, '..')
  const timeoutMs = positiveIntegerArgument('--timeout-ms', 90_000)
  const keepDirs = process.argv.includes('--keep-dirs')
  const locale = argumentValue('--locale') ?? 'zh'
  const theme = argumentValue('--theme') ?? 'light'
  const evidenceRoot = resolve(argumentValue('--evidence') ?? join(repositoryRoot, 'dist', 'file-preview-smoke'))
  for (const entry of ['out/main/index.js', 'out/renderer/index.html', 'kun/dist/cli/serve-entry.js']) {
    assert(existsSync(join(repositoryRoot, entry)), `Missing ${entry}; run npm run build first`)
  }
  const electronPackage = join(repositoryRoot, 'node_modules', 'electron')
  const electronExecutable = join(electronPackage, 'dist', (await readFile(join(electronPackage, 'path.txt'), 'utf8')).trim())
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'kun-file-preview-smoke-'))
  const home = join(temporaryRoot, 'home')
  const profile = join(home, '.kun', 'data')
  const userData = join(temporaryRoot, 'electron-user-data')
  const appData = join(temporaryRoot, 'app-data')
  const localAppData = join(temporaryRoot, 'local-app-data')
  const temporaryDirectory = join(temporaryRoot, 'tmp')
  const workspaceParent = desktopSmokeWorkspaceParent(repositoryRoot)
  await mkdir(workspaceParent, { recursive: true })
  const workspaceRoot = await realpath(await mkdtemp(join(workspaceParent, 'file-preview-')))
  await seedWorkspace(workspaceRoot)
  const screenshots = []
  const pageErrors = []
  const cspErrors = []
  let application, electronProcess, page, result, primaryError, realProfile = profile, electronOutput = ''
  const capture = async (name) => {
    const path = join(evidenceRoot, `${name}.png`)
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
    const png = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.isVisible())
      return window ? (await window.capturePage()).toPNG().toString('base64') : null
    }).catch(() => null)
    if (png) await writeFile(path, Buffer.from(png, 'base64'))
    else await page.screenshot({ path, animations: 'disabled' })
    screenshots.push(path)
  }
  try {
    await Promise.all([home, profile, userData, appData, localAppData, temporaryDirectory, evidenceRoot]
      .map((directory) => mkdir(directory, { recursive: true })))
    realProfile = await realpath(profile)
    const runtimePort = await availablePort()
    const environment = createIsolatedEnvironment(process.env, { home, appData, localAppData, temporaryDirectory })
    delete environment.ELECTRON_RENDERER_URL
    environment.NODE_ENV = 'development'
    const settings = { ...desktopSmokeSettings(runtimePort, workspaceRoot, realProfile), locale, theme, initialSetupCompleted: true }
    settings.schedule = { internal: { port: await availablePort() } }
    const serialized = `${JSON.stringify(settings, null, 2)}\n`
    await Promise.all(desktopUserDataCandidates({ platform: process.platform, home, appData, explicitUserData: userData })
      .map(async (directory) => {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'kun-settings.json'), serialized)
      }))
    application = await _electron.launch({
      executablePath: electronExecutable,
      args: [`--user-data-dir=${userData}`, '--no-first-run', '--disable-background-networking',
        '--disable-component-update', ...platformDesktopArguments(process.platform), repositoryRoot],
      cwd: repositoryRoot, env: environment, chromiumSandbox: true, timeout: timeoutMs
    })
    electronProcess = application.process()
    for (const stream of [electronProcess.stdout, electronProcess.stderr]) {
      stream?.on('data', (chunk) => { electronOutput = `${electronOutput}${chunk}`.slice(-64 * 1024) })
    }
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())?.setBounds({ x: 20, y: 20, width: 1440, height: 920 })
    })
    page = await findWorkbenchWindow(application, timeoutMs)
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) cspErrors.push(message.text())
    })
    await page.waitForLoadState('domcontentloaded', { timeout: 120_000 })
    await page.locator('.ds-composer-textarea').waitFor({ timeout: timeoutMs })
    const assertions = await runFlow({ application, page, capture, timeoutMs, cspErrors, workspaceRoot })
    assert.deepEqual(pageErrors, [], 'Renderer emitted an uncaught exception')
    result = { ok: true, status: 'passed', completedAt: new Date().toISOString(), screenshots, assertions, diagnostics,
      ...(keepDirs ? { temporaryRoot, workspaceRoot } : {}) }
  } catch (error) {
    if (page) {
      await capture('failure').catch(() => undefined)
      await writeFile(join(evidenceRoot, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')).catch(() => undefined)
    }
    primaryError = new Error(`${error.stack ?? error}\nElectron:\n${electronOutput}`)
    result = { ok: false, status: 'failed', failure: primaryError.message, screenshots, pageErrors, cspErrors, diagnostics }
  } finally {
    if (application) await withTimeout(application.close(), 3_000, 'closing Electron').catch(() => undefined)
    if (electronProcess) await terminateProcessTree(electronProcess, process.platform,
      { timeoutMs: 15_000, detached: process.platform !== 'win32' }).catch(() => undefined)
    await withTimeout(stopIsolatedSharedRuntime(repositoryRoot, realProfile), 20_000, 'runtime').catch(() => undefined)
    await withTimeout(stopIsolatedServiceManager(home, realProfile), 20_000, 'manager').catch(() => undefined)
    releaseChildProcessHandles(electronProcess)
    if (!keepDirs) {
      await Promise.all([temporaryRoot, workspaceRoot].map((path) =>
        rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => undefined)))
    }
  }
  await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`)
  if (primaryError) throw primaryError
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
