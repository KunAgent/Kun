import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('native smoke exercises production startup/components and labels the offline boundary', async () => {
  const fixture = await read('scripts/fixtures/paper-workspace-ui.tsx')
  const research = await read('scripts/fixtures/paper-workspace-assistant.tsx')
  const smoke = await read('scripts/smoke-paper-workspace.mjs')
  for (const production of ['PaperLibraryView', 'PaperLibraryOnboarding', 'PaperWorkspacesSection', 'PaperModeToggle', 'loadWriteSettings', 'paper-mode-actions']) {
    assert.ok(fixture.includes(production), production)
  }
  assert.ok(research.includes('PaperResearchView'))
  assert.ok(research.includes('WriteAssistantStageContext.Provider'))
  assert.ok(smoke.includes('_electron as electron'))
  assert.ok(smoke.includes('await application.close()'))
  assert.ok(smoke.includes('await page.reload()'))
  assert.ok(smoke.includes("['missing-root', 'permission-denied']"))
  assert.ok(smoke.includes("for (const theme of ['light', 'dark'])"))
  assert.ok(smoke.includes('await resize(520, 820)'))
  assert.ok(smoke.includes('OFFLINE fixture preload/settings/filesystem'))
  assert.ok(smoke.includes('Full desktop app/preload ownership stack'))
  assert.ok(smoke.includes("route.abort('blockedbyclient')"))
  assert.ok(smoke.includes('await closeNarrowResearchRail()'))
  assert.ok(smoke.includes("await overlay.waitFor({ state: 'visible' })"))
  assert.ok(smoke.includes("await overlay.waitFor({ state: 'detached' })"))
})

test('CI requires both macOS and Windows native evidence and separate real disk tests', async () => {
  const workflow = await read('.github/workflows/paper-workspace-smoke.yml')
  assert.ok(workflow.includes('os: [macos-latest, windows-latest]'))
  assert.ok(workflow.includes('paper-workspace-service.test.ts'))
  assert.ok(workflow.includes('register-app-paper-workspace-ipc-handlers.test.ts'))
  assert.ok(workflow.includes('paper-workspace-bootstrap.test.ts'))
  assert.ok(workflow.includes('run: node scripts/smoke-paper-workspace.mjs'))
  assert.ok(workflow.includes('if: always()'))
  assert.ok(workflow.includes('uses: actions/upload-artifact@v4'))
  assert.ok(!workflow.includes('--compile-only'))
})
