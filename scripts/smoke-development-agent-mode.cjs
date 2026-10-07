'use strict'
const assert = require('node:assert/strict')
const { chmod, mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

async function writeDevinAcpStub(root) {
  const path = join(root, 'devin-fixture')
  await mkdir(root, { recursive: true })
  await writeFile(path, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('Devin CLI 3000.11.3'); process.exit(0) }
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const rl = require('node:readline').createInterface({ input: process.stdin })
let modelId = 'devin-fixture-model'
rl.on('line', (line) => {
  let msg; try { msg = JSON.parse(line) } catch { return }
  if (msg.id === undefined) return
  let result = {}
  if (msg.method === 'initialize') result = { protocolVersion: 1,
    agentInfo: { name: 'Devin fixture', version: '3000.11.3' },
    agentCapabilities: { loadSession: true }, authMethods: [{ id: 'browser', name: 'Sign in' }] }
  if (msg.method === 'session/new' || msg.method === 'session/load') result = {
    sessionId: msg.params?.sessionId ?? 'devin-fixture-session',
    modes: { currentModeId: 'normal', availableModes: [{ id: 'normal', name: 'Normal' }] },
    models: { currentModelId: modelId, availableModels: [
      { modelId: 'devin-fixture-model', name: 'Devin fixture model' },
      { modelId: 'devin-fixture-alternative', name: 'Devin alternative model' }
    ] }
  }
  if (msg.method === 'session/set_model') modelId = msg.params.modelId
  if (msg.method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Devin fixture reply via ' + modelId } } } })
    result = { stopReason: 'end_turn' }
  }
  send({ jsonrpc: '2.0', id: msg.id, result })
})
`)
  await chmod(path, 0o755)
  return path
}

async function runAgentModeFlow({ page, capture, poll, runtimeRequest }) {
  const checks = []
  const trigger = page.locator('[data-agent-mode-trigger]')
  const menu = page.locator('[data-agent-mode-menu]')
  const composer = page.locator('.ds-composer-textarea')
  const open = async () => {
    if (!(await menu.isVisible().catch(() => false))) await trigger.click()
    await menu.waitFor()
  }
  await trigger.waitFor()
  await composer.fill('Keep this draft while changing Agent and Kun modes.')
  const draft = await composer.inputValue()
  await open()
  await menu.locator('[data-agent-mode-option="kun-code"]').waitFor()
  await menu.locator('[data-agent-mode-option="kun-design"]').click()
  assert.equal(await trigger.getAttribute('data-composer-agent'), 'kun')
  assert.equal(await trigger.getAttribute('data-task-surface'), 'design')
  assert.equal(await composer.inputValue(), draft)
  await capture('mode-1-kun-design')
  checks.push('The original mode trigger selects Kun Design without changing the draft')

  await open()
  const devin = menu.locator('[data-agent-mode-option="devin"]')
  await poll(() => devin.isEnabled(), 60_000, 'Devin ACP fixture ready')
  await devin.locator('[data-agent-icon="devin"]').waitFor()
  await capture('mode-2-agent-menu')
  await devin.click()
  assert.equal(await trigger.getAttribute('data-composer-agent'), 'devin')
  assert.equal(await trigger.getAttribute('data-task-surface'), 'code')
  assert.equal(await composer.inputValue(), draft)
  assert.equal(await page.locator('[data-composer-new-requirement]').count(), 0)
  await page.locator('button[aria-controls="floating-composer-action-menu"]').click()
  for (const kind of ['plan', 'auto-plan-build', 'graph']) {
    assert.equal(await page.locator(`[data-composer-${kind}-menu-item]`).count(), 0)
  }
  await page.keyboard.press('Escape')
  checks.push('Selecting Devin preserves the draft and removes Kun-only authoring and workflow controls')

  const model = page.locator('[data-composer-model-trigger]').first()
  await model.click()
  await page.locator('[data-composer-model-panel]').waitFor()
  await page.getByRole('menuitemradio', { name: /^Devin alternative model/u }).click()
  await model.locator('[data-model-source-icon="native-login"]').waitFor()
  assert.equal(await model.locator('[data-provider-icon="kun"]').count(), 0)
  await model.click()
  assert.equal(await page.locator('[data-model-agent-section]').count(), 0)
  assert.equal(await page.locator('[data-agent-mode-menu]').count(), 0)
  await capture('mode-3-model-menu-unchanged-role')
  await page.keyboard.press('Escape')
  checks.push('The existing model picker lists Devin native models without duplicating the Agent selector')

  await composer.fill('Reply using the Devin ACP fixture.')
  await page.locator('.ds-composer-primary-action').click()
  let thread
  await poll(async () => {
    const list = await runtimeRequest(page, '/v1/threads?limit=100')
    thread = list.threads.find((item) => item.harnessId === 'devin')
    if (!thread) return false
    thread = await runtimeRequest(page, `/v1/threads/${thread.id}`)
    return thread.turns.some((turn) => turn.status === 'completed' && turn.items.some((item) =>
      item.kind === 'assistant_text' && item.text.includes('Devin fixture reply via devin-fixture-alternative')))
  }, 60_000, 'real GUI to ACP subprocess response')
  await capture('mode-4-devin-conversation')
  checks.push('An actual ACP subprocess applies the selected model and streams its response through Kun')

  // A follow-up to the same Agent continues its native session: no hand-off
  // or "restored in a new session" notice may appear in the timeline.
  await composer.fill('Second Devin turn in the same session.')
  await page.locator('.ds-composer-primary-action').click()
  await poll(async () => {
    const current = await runtimeRequest(page, `/v1/threads/${thread.id}`)
    return current.turns.filter((turn) => turn.status === 'completed').length >= 2
  }, 60_000, 'second turn on the same Devin session')
  assert.doesNotMatch(await page.locator('body').innerText(), /交接给|Handed context off|恢复上下文|restored context/u)
  checks.push('A follow-up turn with the same Agent continues its native session without a hand-off')

  const invalid = await page.evaluate(async (threadId) => {
    const documentTarget = { documentId: 'fixture-doc', boardArtifactId: 'fixture-board' }
    return window.kunGui.runtimeRequest(`/v1/threads/${threadId}/turns`, 'POST', JSON.stringify({
      prompt: 'must not run', harnessId: 'devin', credentialMode: 'native-login',
      agentSurface: 'design', guiDesignMode: true, designDocumentTarget: documentTarget,
      designProfile: { version: 1, documentTarget, outputMedium: 'html', target: 'web',
        preset: 'none', context: { tone: [] } }
    }))
  }, thread.id)
  assert.equal(invalid.ok, false)
  assert.match(invalid.body, /Kun|kun_agent_required/u)
  checks.push('The host rejects Devin with Kun Design intent before execution')

  await composer.fill(draft)
  await open()
  await menu.locator('[data-agent-mode-option="kun-design"]').click()
  await menu.locator('[data-agent-mode-confirm-cancel]').click()
  assert.equal(await trigger.getAttribute('data-composer-agent'), 'devin')
  await menu.locator('[data-agent-mode-option="kun-design"]').click()
  await menu.locator('[data-agent-mode-confirm-yes]').click()
  assert.equal(await trigger.getAttribute('data-composer-agent'), 'kun')
  assert.equal(await trigger.getAttribute('data-task-surface'), 'design')
  assert.equal(await composer.inputValue(), draft)
  await open()
  await menu.locator('[data-agent-mode-option="kun-code"]').click()
  assert.equal(await trigger.getAttribute('data-task-surface'), 'code')
  assert.equal(await composer.inputValue(), draft)
  await capture('mode-5-return-to-kun')
  checks.push('A historical conversation requires handoff confirmation; Kun Code/Design switches keep the draft')
  return checks
}
module.exports = { runAgentModeFlow, writeDevinAcpStub }
