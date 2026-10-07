'use strict'
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { CODING_AGENT_PROFILE, CODING_AGENT_MODEL, CODING_AGENT_REPLY } = require('./smoke-coding-agent-fixture.cjs')

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
  await page.locator('.direct-coding-agent-chip[data-engine="opencode"]').waitFor()
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
    'Groups require a Kun lead; a coding Agent joins by mention and its discussion turn runs in plan mode',
    'Offline model and ACP fixtures only; no paid provider, real account or project modification'
  ]
}

module.exports = { verifyCodingAgentReadiness, runCodingAgentFlow }
