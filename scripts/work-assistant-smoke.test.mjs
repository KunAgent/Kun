import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
test('native Work fixture imports every production stylesheet in production order', async () => {
  const main = await read('src/renderer/src/main.tsx')
  const fixture = await read('scripts/fixtures/work-assistant-styles.ts')
  const imports = source => [...source.matchAll(/import ['"]([^'"]+\.css)['"]/g)].map(match => match[1].replace(/^\.\.\/\.\.\/src\/renderer\/src\//, './'))
  assert.deepEqual(imports(fixture), imports(main))
})
test('native Work smoke asserts actual layout and lower batch controls', async () => {
  const runner = await read('scripts/smoke-work-assistant-workspace.mjs')
  for (const contract of ['getComputedStyle(actions).display', 'full-page composer must be centered', 'visible composer shell must retain useful width', 'home actions must fit above the composer at desktop height', 'assistant-batch-controls-', 'getByRole(\'checkbox\').check()', 'contextIsolation:true,nodeIntegration:false,sandbox:true']) assert.ok(runner.includes(contract), contract)
  assert.ok(!runner.includes('--no-sandbox'))
})

test('Work palette stays locally scoped and tests real surface/contrast relationships', async () => {
  const css = await read('src/renderer/src/styles/write-editor/work-assistant-page.css')
  const palette = await read('scripts/work-assistant-palette.mjs')
  const batch = await read('src/renderer/src/components/paper/batch/PaperBatchAssistantPanel.tsx')
  assert.ok(css.includes('--work-assistant-canvas: var(--ds-bg-main)'))
  assert.ok(!css.includes(':root'))
  assert.ok(!css.includes('--ds-bg-main:'))
  assert.ok(!/\b(?:bg|border)-accent\//.test(batch))
  assert.ok(palette.includes('must share the Code canvas'))
  assert.ok(palette.includes('fieldContrast >= 4.5'))
  assert.ok(palette.includes('bright currentColor border'))
})
