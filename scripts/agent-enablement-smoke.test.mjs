import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createContext, runInContext } from 'node:vm'
import { setSmokeAppearance } from './agent-enablement-smoke-operation.mjs'

const root = new URL('../', import.meta.url)
const source = path => readFileSync(new URL(path, root), 'utf8')
const workflow = source('.github/workflows/agent-enablement-smoke.yml')
const smoke = source('scripts/smoke-agent-enablement.mjs')

test('native evidence uses both target platforms and the exact published head', () => {
  assert.match(workflow, /os: \[macos-latest, windows-latest\]/)
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/)
  assert.match(workflow, /KUN_ENABLEMENT_EXPECTED_SHA:/)
  for (const dependency of ['SettingsView.tsx', 'SettingsUiSmokeHost.ts', 'use-settings-persistence.ts']) {
    assert.ok(workflow.includes(dependency), dependency)
  }
  assert.match(smoke, /assert.equal\(report.sourceRevision, process.env.KUN_ENABLEMENT_EXPECTED_SHA/)
  assert.match(smoke, /assert.equal\(report.sourceDiff, ''/)
  assert.match(workflow, /if-no-files-found: error/)
})

test('native smoke exercises production components under the Chromium sandbox', () => {
  assert.match(smoke, /AgentEnablementSmokeFixture\.tsx/)
  const fixture = source('src/renderer/src/components/ade/AgentEnablementSmokeFixture.tsx')
  assert.match(fixture, /<SettingsView key=/)
  assert.doesNotMatch(fixture, /<AgentCenter/)
  assert.match(fixture, /host\.harnessRuntime/)
  assert.match(smoke, /Production SettingsView persists/)
  assert.match(smoke, /Runtime restart retains consent/)
  assert.match(smoke, /setNavigationBusy\(true\)/)
  assert.match(smoke, /chromiumSandbox: true/)
  assert.match(smoke, /contextIsolation: true, sandbox: true, nodeIntegration: false/)
  assert.doesNotMatch(smoke, /--no-sandbox|chromiumSandbox: false|setBypassCSP/)
  assert.match(smoke, /setPermissionRequestHandler/)
  assert.match(smoke, /setPermissionCheckHandler/)
  assert.match(smoke, /page.route\('\*\*\/\*'/)
  assert.match(smoke, /assert.deepEqual\(report.blockedRequests, \[\]/)
})

test('native regression checks cover interrupted flows and real zoom geometry', () => {
  for (const evidence of ['Repeated clicks', 'cancel rejects', 'Editing the model', 'Switching credential mode',
    'Closing settings', 'Switching agents', 'remote authentication and quota']) assert.ok(smoke.includes(evidence), evidence)
  assert.match(smoke, /webContents.setZoomFactor\(zoom\)/)
  assert.match(smoke, /\[1, 1\.5, 2\]/)
  assert.match(smoke, /\['en', 'zh'\]/)
  assert.match(smoke, /\['light', 'dark'\]/)
  assert.match(smoke, /measured.width >= 24 && measured.height >= 24/)
  assert.match(smoke, /assert.deepEqual\(report.pageErrors, \[\]/)
})

test('theme evidence verifies persisted state and actual production backgrounds', () => {
  const fixture = source('src/renderer/src/components/ade/AgentEnablementSmokeFixture.tsx')
  const host = source('src/renderer/src/components/SettingsUiSmokeHost.ts')
  assert.match(fixture, /host\.setSettings\(\{ \.\.\.host\.settings, theme \}\)/)
  assert.doesNotMatch(fixture, /classList\.toggle\('dark'/)
  assert.match(host, /emitRendererSettingsChanged\(clone\(settings\)\)/)
  assert.match(smoke, /await setSmokeAppearance\(page, language, theme, report.appearanceOperations\)/)
  assert.match(smoke, /await assertTheme\(theme\)/)
  assert.match(smoke, /assert\.equal\(appearance\.savedTheme, theme/)
  assert.match(smoke, /assert\.equal\(appearance\.renderedTheme, theme/)
  assert.match(smoke, /getComputedStyle\(document\.querySelector\(selector\)\)\.backgroundColor/)
  assert.match(smoke, /Math\.max\(\.\.\.rgb\) < 128 : Math\.min\(\.\.\.rgb\) > 192/)
})

test('high-zoom captures show fully reachable controls and report actual clamped dimensions', () => {
  assert.match(smoke, /content: window\.getContentBounds\(\)/)
  assert.match(smoke, /width: innerWidth, height: innerHeight/)
  assert.match(smoke, /requestedContent: \{ width, height: 1000 \}, native, viewport, zoom, appearance/)
  assert.match(smoke, /viewport\$\{viewport\.width\}x\$\{viewport\.height\}/)
  assert.match(smoke, /\['profile', '\[data-agent-profile-mode-option\]'\], \['enable', '\[data-agent-enable\]'\]/)
  assert.match(smoke, /const control = await measureControl\(panel\(\)\.locator\(selector\)\.first\(\)\)/)
  assert.doesNotMatch(smoke, /await panel\(\)\.scrollIntoViewIfNeeded\(\)/)
  assert.match(smoke, /measured\.top >= -1 && measured\.bottom <= measured\.viewport\.height \+ 1 && measured\.hit/)
  assert.match(smoke, /points\.every/)
  assert.match(smoke, /report\.screenshotDetails\.push/)
})

test('native screenshots retain the full content pixels at every Electron zoom', () => {
  assert.match(smoke, /await window\.webContents\.capturePage\(\)/)
  assert.match(smoke, /nativeImage\.toPNG\(\)\.toString\('base64'\)/)
  assert.doesNotMatch(smoke, /page\.screenshot\(|nativeImage\.resize\(|nativeImage\.crop\(/)
  assert.match(smoke, /Buffer\.from\(capture\.png, 'base64'\)/)
  assert.match(smoke, /bytes\.readUInt32BE\(16\)/)
  assert.match(smoke, /bytes\.readUInt32BE\(20\)/)
  assert.match(smoke, /Math\.round\(capture\.contentBounds\.width \* capture\.displayScale\)/)
  assert.match(smoke, /Math\.round\(capture\.contentBounds\.height \* capture\.displayScale\)/)
  assert.match(smoke, /await writeFile\(join\(evidence, file\), bytes\)/)
  assert.match(smoke, /report\.nativeCaptures\.push\(\{ file, \.\.\.pixels \}\)/)
  assert.match(smoke, /Math\.abs\(pixelSize\.height - expectedPixelSize\.height\) <= 1/)
  assert.match(smoke, /control\.bottom \* scale <= pixelSize\.height \+ 1/)
})

test('both native platforms exercise the final process and pooled-session gate', () => {
  for (const file of ['owned-process.admission.test.ts', 'harness-pool.admission.test.ts',
    'session-turn-runtime.admission.test.ts', 'acp-runtime.admission.test.ts', 'owned-sdk-process.test.ts',
    'cursor-sdk-runtime.admission.test.ts', 'cursor-sdk-installation.test.ts',
    'cursor-sdk-readiness.test.ts', 'harness-readiness-admission.test.ts']) {
    assert.ok(workflow.includes(file), file)
  }
  assert.match(workflow, /--maxWorkers=1/)
})

test('settings baseline copies the complete offline fixture without replacing production helpers', () => {
  const baseline = source('.github/workflows/settings-ui-smoke.yml')
  assert.ok(baseline.includes('ade/agent-enablement-smoke-runtime.ts'))
  const host = source('src/renderer/src/components/ade/agent-enablement-smoke-runtime.ts')
  assert.doesNotMatch(host, /from ['"]@shared\/harness-enablement['"]/)
  assert.ok(baseline.includes('github.event.pull_request.base.sha'))
})

test('native harnesses finish dependency optimization before serving or navigating', () => {
  for (const file of ['scripts/smoke-agent-enablement.mjs', 'scripts/smoke-paper-evidence.mjs']) {
    const harness = source(file)
    const optimize = harness.indexOf('const optimized = await optimizeDeps(server.config, true, true)')
    assert.ok(optimize > harness.indexOf('server = await createServer('), file)
    assert.ok(optimize < harness.indexOf('await server.listen()'), file)
    assert.ok(harness.indexOf('await server.listen()') < harness.indexOf('await page.goto('), file)
    for (const dependency of ['react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime']) {
      assert.ok(harness.includes(`'${dependency}'`), `${file}: ${dependency}`)
    }
    assert.match(harness, /Object.keys\(optimized.optimized\)/)
    assert.match(harness, /page.on\('framenavigated'/)
    assert.match(harness, /frame === page.mainFrame\(\)/)
    assert.match(harness, /page.on\('console'/)
    assert.match(harness, /message.text\(\).includes\('\[vite\]'\)/)
    assert.doesNotMatch(harness, /waitForTimeout\(\d{4,}|noDiscovery: true/)
  }
})

test('paper evidence optimizer scans the same real fixture that the browser loads', () => {
  const paper = source('scripts/smoke-paper-evidence.mjs')
  assert.match(paper, /mkdtemp\(join\(repository, 'out', '\.paper-evidence-smoke-'\)\)/)
  assert.match(paper, /fixtureId = normalizePath\(join\(fixtureDirectory, 'fixture.tsx'\)\)/)
  assert.ok(paper.indexOf('await writeFile(fixtureId, paperEvidenceFixture())') < paper.indexOf('server = await createServer('))
  assert.match(paper, /entries: \[fixtureId\]/)
  assert.match(paper, /id === fixtureUrl \|\| id === fixtureId\) return fixtureId/)
  assert.doesNotMatch(paper, /load\(id\)/)
  assert.match(paper, /await rm\(fixtureDirectory, \{ recursive: true, force: true \}\)/)
  assert.match(paper, /await page.reload\(\)/)
  assert.match(paper, /assert.deepEqual\(errors, \[\]/)
})

function deferredAppearancePage() {
  const calls = []
  let resolveLanguage, rejectLanguage, resumePoll, startedPoll
  const language = new Promise((resolve, reject) => { resolveLanguage = resolve; rejectLanguage = reject })
  const pollStarted = new Promise(resolve => { startedPoll = resolve })
  const pollGate = new Promise(resolve => { resumePoll = resolve })
  const context = createContext({ document: {}, window: { agentEnablementFixture: {
    language: value => { calls.push(['language', value]); return language },
    theme: value => { calls.push(['theme', value]) }
  } } })
  const evaluate = async (fn, arg) => runInContext(`(${fn.toString()})`, context)(arg)
  const page = { evaluate, async waitForFunction(fn, arg) {
    const pending = await evaluate(fn, arg)
    assert.equal(pending, false, 'Must observe the unfinished operation, not declare early success')
    startedPoll()
    await pollGate
    assert.equal(await evaluate(fn, arg), true)
  } }
  return { page, context, calls, pollStarted, resolveLanguage, rejectLanguage, resumePoll }
}

test('appearance retains its deferred operation and applies language/theme exactly once', async () => {
  const fixture = deferredAppearancePage()
  const diagnostics = []
  const result = setSmokeAppearance(fixture.page, 'zh', 'dark', diagnostics)
  await fixture.pollStarted
  assert.deepEqual(fixture.calls, [['language', 'zh']])
  const operation = fixture.context.window.agentEnablementAppearanceOperation
  assert.equal(operation.document, fixture.context.document)
  assert.equal(typeof operation.promise.then, 'function')
  fixture.resolveLanguage()
  await operation.promise
  fixture.resumePoll()
  await result
  assert.deepEqual(fixture.calls, [['language', 'zh'], ['theme', 'dark']])
  assert.equal(fixture.context.window.agentEnablementAppearanceOperation, undefined)
  assert.equal(diagnostics[0].status, 'fulfilled')
})

test('appearance propagates deferred rejection without applying theme or retrying', async () => {
  const fixture = deferredAppearancePage()
  const diagnostics = []
  const result = setSmokeAppearance(fixture.page, 'zh', 'dark', diagnostics)
  const rejected = assert.rejects(result, /locale import failed/)
  await fixture.pollStarted
  fixture.rejectLanguage(new Error('locale import failed'))
  await fixture.context.window.agentEnablementAppearanceOperation.promise
  fixture.resumePoll()
  await rejected
  assert.equal(diagnostics[0].status, 'rejected')
  assert.match(diagnostics[0].error, /locale import failed/)
  assert.deepEqual(fixture.calls, [['language', 'zh']])
})

test('appearance fails if the document is replaced instead of replaying the operation', async () => {
  const fixture = deferredAppearancePage()
  const diagnostics = []
  const result = setSmokeAppearance(fixture.page, 'zh', 'dark', diagnostics)
  const rejected = assert.rejects(result, /document was replaced/)
  await fixture.pollStarted
  fixture.resolveLanguage()
  await fixture.context.window.agentEnablementAppearanceOperation.promise
  fixture.context.document = {}
  fixture.resumePoll()
  await rejected
  assert.equal(diagnostics[0].status, 'boundary-failed')
  assert.match(diagnostics[0].error, /document was replaced/)
  assert.deepEqual(fixture.calls, [['language', 'zh'], ['theme', 'dark']])
})

test('appearance does not apply theme when document replacement interrupts locale loading', async () => {
  const fixture = deferredAppearancePage()
  const result = setSmokeAppearance(fixture.page, 'zh', 'dark')
  const rejected = assert.rejects(result, /document was replaced/)
  await fixture.pollStarted
  const operation = fixture.context.window.agentEnablementAppearanceOperation
  fixture.context.document = {}
  fixture.resolveLanguage()
  await operation.promise
  fixture.resumePoll()
  await rejected
  assert.equal(operation.status, 'rejected')
  assert.deepEqual(fixture.calls, [['language', 'zh']])
})
