'use strict'
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { CODING_AGENT_PROFILE, CODING_AGENT_MODEL, CODING_AGENT_ALTERNATE_MODEL, CODING_AGENT_REPLY } = require('./smoke-coding-agent-fixture.cjs')

async function auditEntries(file) {
  try { return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) }
  catch { return [] }
}

/** The fixture profile must pass the same local handshake a user runs in Code settings. */
async function verifyCodingAgentReadiness({ page, poll, runtimeRequest }) {
  const row = async () => (await runtimeRequest(page, '/v1/harnesses?usage=code'))
    .harnesses.find((entry) => entry.definition.id === CODING_AGENT_PROFILE.harnessId)
  assert.deepEqual((await row())?.enabledProfiles, [CODING_AGENT_PROFILE], 'Offline OpenCode profile must have explicit consent')
  await poll(async () => !(await row())?.status.detecting, 60_000, 'offline OpenCode detection')
  const result = await runtimeRequest(page, '/v1/harnesses/opencode/test', 'POST', {
    level: 'handshake', credentialMode: CODING_AGENT_PROFILE.credentialMode, model: CODING_AGENT_MODEL
  })
  assert.equal(result.readiness?.usable, true, JSON.stringify(result))
  assert.equal(result.handshake?.agent?.name, 'OpenCode offline fixture')
  return result
}

/** Picker -> private chat -> host-published reply -> group discussion pinned to read-only plan mode. */
async function runCodingAgentFlow({ page, capture, poll, runtimeRequest, resize, auditFile }) {
  // Code is the default surface; conversations live in its sidebar.
  const chats = page.locator('.sidebar-agent-chats')
  await chats.waitFor()
  const lead = (await runtimeRequest(page, '/v1/agents', 'POST', { clientRequestId: 'coding-smoke-lead', name: 'Ada', title: 'Kun lead' })).agent
  const openPicker = async () => {
    await chats.getByRole('button', { name: 'New conversation', exact: true }).click()
    await page.locator('.direct-new-chat').waitFor()
  }
  await openPicker()
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  const row = page.locator('.direct-coding-agent').filter({ hasText: 'OpenCode' })
  await poll(async () => await row.getAttribute('data-ready').catch(() => null) === 'true', 60_000, 'ready OpenCode row in the picker')
  assert.match(await row.innerText(), new RegExp(CODING_AGENT_MODEL.replace('/', '\\/')))
  await capture('coding-01-picker')

  await row.locator('button').click()
  const header = page.locator('.direct-header')
  await poll(async () => (await header.locator('.direct-chat-title strong').innerText().catch(() => '')) === 'OpenCode', 30_000, 'OpenCode private chat')
  await header.locator('.rooms-avatar[data-engine="opencode"]').waitFor()
  const modelPicker = page.locator('.rooms-composer [data-coding-agent-model-picker="opencode"]')
  await modelPicker.waitFor()
  const agent = (await runtimeRequest(page, '/v1/agents?limit=50')).agents.find((item) => item.executor?.harnessId === 'opencode')
  assert.deepEqual({ ...agent.executor, accountId: undefined },
    { kind: 'harness', harnessId: 'opencode', credentialMode: 'native-login', model: CODING_AGENT_MODEL, accountId: undefined })
  assert.deepEqual(agent.memory, { readEnabled: false, captureEnabled: false })
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  await editor.fill('帮我看看这个项目从哪里启动 [coding-agent-smoke]')
  await editor.press('Enter')
  const privateReply = page.locator('.rooms-message-row').filter({ hasText: CODING_AGENT_REPLY })
  await privateReply.first().waitFor({ timeout: 90_000 })
  const privateRoom = (await runtimeRequest(page, `/v1/agents/${agent.id}/conversations`)).conversations[0]
  const privateMessages = (await runtimeRequest(page, `/v1/rooms/${privateRoom.id}/messages`)).messages
    .filter((message) => message.authorKind === 'member')
  assert.equal(privateMessages.length, 1, 'One turn publishes exactly one reply bubble')
  assert.match(privateMessages[0].body, /模型 opencode-fixture\/model/u)
  const privatePrompt = (await auditEntries(auditFile)).filter((entry) => entry.method === 'session/prompt').at(-1)
  assert(privatePrompt?.text.includes('从哪里启动'), 'The real ACP prompt carries the user message')
  assert(!privatePrompt.text.includes('send_im_message'), 'External prompts never ask for Kun publishing tools')
  await capture('coding-02-private-reply')
  await runCodingAgentModelFlow({ page, capture, poll, runtimeRequest, resize, agent, privateRoom, auditFile })
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark') })
  await capture('coding-03-private-dark')
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('light') })

  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('en') })
  await openPicker()
  await page.locator('.direct-create-actions button[aria-pressed]').click()
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  await poll(async () => await row.getAttribute('data-ready').catch(() => null) === 'true', 60_000, 'ready OpenCode row in group mode')
  await row.locator('button').click()
  await poll(async () => await row.locator('button').getAttribute('aria-pressed') === 'true', 20_000, 'OpenCode selected for the group')
  const start = page.locator('.direct-start-group')
  assert.equal(await start.isDisabled(), true, 'A coding Agent cannot start a group without a Kun lead')
  await page.locator('.direct-agent-choices button').filter({ hasText: 'Ada' }).first().click()
  await poll(async () => !(await start.isDisabled()), 20_000, 'group start enabled with a Kun lead')
  await capture('coding-04-group-picker')
  await start.click()
  let group
  await poll(async () => {
    group = (await runtimeRequest(page, '/v1/rooms?limit=20')).rooms
      .find((room) => room.members.some((member) => member.participantAgentId === agent.id))
    return Boolean(group)
  }, 30_000, 'created group')
  assert.equal(group.defaultMemberId, group.members.find((member) => member.participantAgentId === lead.id).id, 'The Kun Agent leads the group')
  const coder = group.members.find((member) => member.participantAgentId === agent.id)
  await runtimeRequest(page, `/v1/rooms/${group.id}/messages`, 'POST', { clientRequestId: 'coding-smoke-group',
    body: '@OpenCode 你怎么看这个入口？ [coding-agent-smoke]', mentionMemberIds: [coder.id], executionIntent: 'discussion' })
  const groupReply = page.locator('.rooms-message-row').filter({ hasText: CODING_AGENT_REPLY + '：模式 plan' })
  await groupReply.first().waitFor({ timeout: 90_000 })
  const groupPrompt = (await auditEntries(auditFile)).filter((entry) => entry.method === 'session/prompt').at(-1)
  assert.equal(groupPrompt.mode, 'plan', 'Group discussion pins OpenCode to its read-only plan mode')
  await groupReply.first().scrollIntoViewIfNeeded()
  await capture('coding-05-group-reply')
  await resize(960, 800)
  await capture('coding-06-group-narrow')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow at 960px')
  return [
    'The new chat picker lists the offline OpenCode engine with its probed model beside Kun Agents',
    'Choosing it creates one coding Agent contact with the engine mark, the pinned route and Kun memory off',
    'A private message runs through the real ACP subprocess and the host posts exactly one reply bubble',
    'The conversation picker lists only native Agent models and persists the selected model across reload',
    'The next actual ACP prompt uses the selected conversation model while the Agent default stays unchanged',
    'The profile model settings use the native Agent catalog and save its default without clearing the conversation override',
    'Groups require a Kun lead; a coding Agent joins by mention and its discussion turn runs in plan mode',
    'Offline model and ACP fixtures only; no paid provider, real account or project modification'
  ]
}

async function runCodingAgentModelFlow({ page, capture, poll, runtimeRequest, resize, agent, privateRoom, auditFile }) {
  const picker = () => page.locator('.rooms-composer [data-coding-agent-model-picker="opencode"]')
  const trigger = () => picker().locator('[data-composer-model-trigger]')
  const panel = () => page.locator('[data-composer-model-panel]')
  const checkNativeModels = async () => {
    await poll(async () => await panel().getByRole('menuitemradio').count() === 2, 30_000, 'native OpenCode model catalog')
    const models = await panel().getByRole('menuitemradio').evaluateAll((items) => items.map((item) => item.title))
    assert(models.some((item) => item.includes(CODING_AGENT_MODEL)))
    assert(models.some((item) => item.includes(CODING_AGENT_ALTERNATE_MODEL)))
    assert(models.every((item) => !item.includes('deepseek')), 'An external Agent never offers the Kun model catalog')
  }
  await trigger().click()
  await checkNativeModels()
  await capture('coding-model-01-native-menu')
  await panel().getByRole('menuitemradio', { name: /OpenCode alternate model/u }).click()
  await poll(async () => (await runtimeRequest(page, `/v1/rooms/${privateRoom.id}`)).room.privateExecutorModel === CODING_AGENT_ALTERNATE_MODEL,
    30_000, 'conversation model persisted')
  await poll(async () => (await trigger().innerText()).includes('OpenCode alternate model'), 20_000, 'conversation model displayed')
  assert.equal((await runtimeRequest(page, `/v1/agents/${agent.id}`)).agent.executor.model, CODING_AGENT_MODEL,
    'Conversation model selection does not change the Agent default')
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  await editor.fill('Use the alternate native model [coding-agent-model-smoke]')
  await editor.press('Enter')
  await poll(async () => (await auditEntries(auditFile)).some((entry) => entry.method === 'session/prompt' &&
    entry.model === CODING_AGENT_ALTERNATE_MODEL && entry.text.includes('[coding-agent-model-smoke]')),
  60_000, 'actual ACP prompt uses alternate native model')
  await page.locator('.rooms-message-row').filter({ hasText: '模型 ' + CODING_AGENT_ALTERNATE_MODEL }).first().waitFor({ timeout: 60_000 })
  await capture('coding-model-02-selected-reply')
  await resize(960, 800)
  await trigger().click()
  await checkNativeModels()
  await capture('coding-model-03-narrow-menu')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Native model picker does not overflow at 960px')
  await page.keyboard.press('Escape')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const row = page.locator(`[data-sidebar-entry="room:${privateRoom.id}"] .sidebar-agent-chat-row`)
  await row.waitFor()
  await row.click()
  await poll(async () => (await trigger().innerText()).includes('OpenCode alternate model'), 30_000, 'native model restored after reload')
  await resize(1360, 900)
  await page.locator('.direct-chat-title').click()
  await page.locator('[data-info-action="models"]').click()
  const defaults = page.locator('.direct-model-settings [data-coding-agent-model-picker="opencode"]')
  await defaults.waitFor()
  assert.equal(await page.locator('.direct-model-settings select').count(), 0, 'External model settings do not show Kun provider selects')
  await defaults.locator('[data-composer-model-trigger]').click()
  await checkNativeModels()
  await capture('coding-model-04-native-defaults')
  await panel().getByRole('menuitemradio', { name: /OpenCode alternate model/u }).click()
  await poll(async () => (await runtimeRequest(page, `/v1/agents/${agent.id}`)).agent.executor.model === CODING_AGENT_ALTERNATE_MODEL,
    30_000, 'Agent default native model persisted')
  assert.equal((await runtimeRequest(page, `/v1/rooms/${privateRoom.id}`)).room.privateExecutorModel, CODING_AGENT_ALTERNATE_MODEL)
  await defaults.locator('[data-composer-model-trigger]').click()
  await panel().getByRole('menuitemradio', { name: /OpenCode fixture model/u }).click()
  await poll(async () => (await runtimeRequest(page, `/v1/agents/${agent.id}`)).agent.executor.model === CODING_AGENT_MODEL,
    30_000, 'Agent default restored independently')
  assert.equal((await runtimeRequest(page, `/v1/rooms/${privateRoom.id}`)).room.privateExecutorModel, CODING_AGENT_ALTERNATE_MODEL,
    'Changing Agent defaults preserves existing conversation model selection')
  await capture('coding-model-05-default-and-override')
  await page.locator('[data-room-workbench-panel]').getByRole('button', { name: /^(Collapse right sidebar|收起右侧栏)$/u }).first().click()
}

module.exports = { verifyCodingAgentReadiness, runCodingAgentFlow }
