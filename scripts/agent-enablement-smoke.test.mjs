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
