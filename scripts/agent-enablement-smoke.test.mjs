import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { test } from 'node:test'

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
  assert.match(smoke, /await window\.agentEnablementFixture\.language\(language\)/)
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
  assert.match(smoke, /\['profile', '\[data-agent-profile-mode\]'\], \['enable', '\[data-agent-enable\]'\]/)
  assert.match(smoke, /const control = await measureControl\(panel\(\)\.locator\(selector\)\)/)
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
