'use strict'
const assert = require('node:assert/strict')
const { chmod, mkdir, readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

/**
 * Offline OpenCode ACP fixture: publishes three primary agents as session
 * modes (build, plan and a user-defined docs agent) and journals every
 * session/set_mode so the smoke can prove the composer choice reached ACP.
 */
async function writeOpenCodeAgentStub(root) {
  const path = join(root, 'opencode-agent-fixture')
  const journal = join(root, 'opencode-agent-journal.jsonl')
  await mkdir(root, { recursive: true })
  await writeFile(path, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('1.1.47'); process.exit(0) }
const fs = require('node:fs')
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
let mode = 'build'
const modes = () => ({ currentModeId: mode, availableModes: [
  { id: 'build', name: 'build', description: 'The default agent. Executes tools based on configured permissions.' },
  { id: 'plan', name: 'plan', description: 'Plan mode. Disallows all edit tools.' },
  { id: 'docs', name: 'docs', description: 'Writes and reviews project documentation.' }
] })
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line) } catch { return }
  if (msg.id === undefined) return
  let result = {}
  if (msg.method === 'initialize') result = { protocolVersion: 1,
    agentInfo: { name: 'OpenCode fixture', version: '1.1.47' }, agentCapabilities: { loadSession: true }, authMethods: [] }
  if (msg.method === 'session/new' || msg.method === 'session/load') result = {
    sessionId: msg.params?.sessionId ?? 'opencode-fixture-session', modes: modes(),
    models: { currentModelId: 'fixture/model', availableModels: [{ modelId: 'fixture/model', name: 'Fixture model' }] }
  }
  if (msg.method === 'session/set_mode') {
    mode = msg.params.modeId
    fs.appendFileSync(${JSON.stringify(journal)}, JSON.stringify({ method: msg.method, modeId: mode }) + '\\n')
  }
  if (msg.method === 'session/prompt') {
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OpenCode fixture reply from ' + mode } } } })
    result = { stopReason: 'end_turn' }
  }
  send({ jsonrpc: '2.0', id: msg.id, result })
})
`)
  await chmod(path, 0o755)
  return { path, journal }
}

/** Local-stub credential evidence only; the fixture never contacts a service. */
async function writeOpenCodeCredentialFixture(home) {
  const directory = join(home, '.local', 'share', 'opencode')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'auth.json'),
    JSON.stringify({ fixture: { type: 'api', key: 'opencode-agents-offline-fixture-no-service-access' } }))
}

async function runOpenCodeAgentFlow({ page, capture, poll, runtimeRequest, journal }) {
  const checks = []
  await page.locator('[data-agent-mode-trigger]').click()
  const opencode = page.locator('[data-agent-mode-option="opencode"]')
  await poll(() => opencode.isEnabled(), 90_000, 'OpenCode ACP fixture ready')
  await opencode.click()
  const picker = page.locator('[data-native-agent-picker="opencode"] button')
  await picker.waitFor()
  assert.match(await picker.innerText(), /Auto/u)
  checks.push('Selecting OpenCode shows the native Agent switch next to the model control, starting on Auto')

  await picker.click()
  const menu = page.locator('[data-native-agent-menu="opencode"]')
  await poll(async () => await menu.locator('[data-native-agent="docs"]').count() === 1, 60_000, 'OpenCode agents listed')
  assert.deepEqual(await menu.locator('[role="menuitemradio"]').evaluateAll((items) => items.map((item) => item.dataset.nativeAgent)),
    ['', 'build', 'plan', 'docs'])
  await capture('opencode-agents-1-menu')
  await menu.locator('[data-native-agent="docs"]').click()
  assert.match(await picker.innerText(), /Docs/u)
  await capture('opencode-agents-2-selected')
  checks.push('The menu lists build, plan and the user-defined docs agent; picking docs updates the chip')

  const composer = page.locator('.ds-composer-textarea')
  await composer.fill('Reply using the OpenCode docs agent fixture.')
  await page.locator('.ds-composer-primary-action').click()
  let thread
  await poll(async () => {
    const list = await runtimeRequest(page, '/v1/threads?limit=100')
    thread = list.threads.find((item) => item.harnessId === 'opencode')
    if (!thread) return false
    thread = await runtimeRequest(page, `/v1/threads/${thread.id}`)
    return thread.turns.some((turn) => turn.status === 'completed' && turn.items.some((item) =>
      item.kind === 'assistant_text' && item.text.includes('OpenCode fixture reply from docs')))
  }, 90_000, 'OpenCode docs agent reply')
  assert.equal(thread.turns.at(-1).harnessAgentId, 'docs')
  const modes = (await readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).modeId)
  assert.equal(modes.at(-1), 'docs')
  await page.getByText('OpenCode fixture reply from docs').first().waitFor()
  await capture('opencode-agents-3-reply')
  checks.push('The turn records harnessAgentId docs and the ACP session switches to docs before the prompt')
  return checks
}

module.exports = { writeOpenCodeAgentStub, writeOpenCodeCredentialFixture, runOpenCodeAgentFlow }
