'use strict'
const assert = require('node:assert/strict')
const { chmod, mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const models = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']

async function writeCodexModelStub(root) {
  const path = join(root, 'codex-model-fixture')
  await mkdir(root, { recursive: true })
  await writeFile(path, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('codex-cli 0.159.2'); process.exit(0) }
const models = ${JSON.stringify(models)}
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line) } catch { return }
  if (msg.id === undefined) return
  let result
  if (msg.method === 'initialize') result = { userAgent: 'fixture', codexHome: '/fixture', platformFamily: 'unix', platformOs: 'linux' }
  if (msg.method === 'account/read') result = { account: null, requiresOpenaiAuth: false }
  if (msg.method === 'config/read') result = { config: { model: models[0] } }
  if (msg.method === 'model/list') {
    const offset = Number(msg.params?.cursor || 0)
    result = { data: models.slice(offset, offset + 4).map((id, index) => ({ id, model: id,
      displayName: id, description: '', inputModalities: ['text', 'image'], isDefault: offset + index === 0,
      hidden: false, supportedReasoningEfforts: [], defaultReasoningEffort: 'medium' })),
      nextCursor: offset === 0 ? '4' : null }
  }
  const response = result === undefined ? { error: { code: -32601, message: 'Metadata-only fixture' } } : { result }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...response }) + '\\n')
})
`)
  await chmod(path, 0o755)
  return path
}

async function runNativeModelFlow({ page, capture, poll }) {
  const trigger = page.locator('[data-agent-mode-trigger]')
  const menu = page.locator('[data-agent-mode-menu]')
  await trigger.waitFor()
  await trigger.click()
  const codex = menu.locator('[data-agent-mode-option="codex"]')
  await poll(() => codex.isEnabled(), 60_000, 'Codex metadata fixture ready')
  await codex.click()
  assert.equal(await trigger.getAttribute('data-composer-agent'), 'codex')
  const model = page.locator('[data-composer-model-trigger]').first()
  await poll(async () => (await model.innerText()).includes(models[0]), 30_000, 'Native configured default')
  await model.click()
  await page.locator('[data-composer-model-panel]').waitFor()
  const items = page.getByRole('menuitemradio')
  await poll(async () => await items.count() === models.length, 30_000, 'All paginated models visible')
  for (const id of models) {
    const item = page.getByRole('menuitemradio', { name: new RegExp('^' + id.replaceAll('.', '\\.')) })
    assert.match(await item.innerText(), /Vision|识图/u)
  }
  await capture('codex-native-models-vision')
  await page.getByRole('menuitemradio', { name: /^gpt-6-astra/u }).click()
  assert.match(await model.innerText(), /gpt-6-astra/u)
  await trigger.click()
  await menu.waitFor()
  await page.keyboard.press('Escape')
  assert.match(await model.innerText(), /gpt-6-astra/u)
  return ['Codex uses its native configured default without a Kun provider model override',
    'All eight paginated native models display their reported image capability',
    'A native model selection survives reopening and refreshing the Agent selector']
}

module.exports = { writeCodexModelStub, runNativeModelFlow }
