'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

async function exerciseDirectChat({ page, request, poll, capture, fixture, application, workspaceRoot, real, resize, switchRooms, approve }) {
  let userRequests = 0, approvals = 0
  await switchRooms()
  await page.locator('.direct-header').waitFor()
  const entry = await request(page, '/v1/agents/chat-entry')
  assert(entry.initialized && entry.roomId)
  const agents = await request(page, '/v1/agents')
  assert.equal(agents.agents.length, 1, 'Opening Rooms initializes exactly one Agent')
  assert.equal(agents.agents[0].name, '小 Kun')
  assert.equal((await request(page, '/v1/rooms?conversation_kind=user_agent')).rooms.length, 1)
  assert.equal(fixture.snapshot().mainCalls, 0, 'Initialization must not call a model')
  assert.equal(await page.locator('.rooms-init-banner').count(), 0)
  assert.equal(await page.locator('.agent-collaboration-strip').count(), 0)
  assert.equal(await page.locator('.rooms-composer select').count(), 0)
  await capture('01-empty-kun')
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await page.getByRole('button', { name: '👍', exact: true }).click()
  await poll(async () => (await page.locator('.rooms-rich-input').innerText()).includes('👍'), 10000, 'nested emoji menu')
  await page.locator('.rooms-rich-input').fill('')
  const editor = () => page.locator('.rooms-composer .rooms-rich-input')
  const send = async (text) => {
    if (real) assert(++userRequests <= 8, 'At most eight real user requests')
    else userRequests++
    await editor().fill(text)
    await editor().press('Enter')
  }
  const settle = async (roomId, before) => {
    let completed
    await poll(async () => {
      const data = await request(page, `/v1/rooms/${roomId}/direct`)
      for (const gate of data.approvals) {
        const next = application.waitForEvent('window')
        await page.getByRole('button', { name: 'Review and allow', exact: true }).first().click()
        const consent = await next
        await consent.getByRole('button', { name: 'Allow once', exact: true }).click()
        approvals++
      }
      const candidate = data.requests[0]?.id !== before ? data.requests[0] : undefined
      assert(!candidate || !['failed', 'recovery_required'].includes(candidate.status), JSON.stringify(candidate))
      if (candidate?.status === 'completed') { completed = candidate; return true }
      return false
    }, real ? 240000 : 60000, 'private reply completion')
    await poll(async () => (await request(page, `/v1/rooms/${roomId}/messages`)).messages.some((message) => message.originRunId === completed.runId && message.status === 'final'), 15000, 'public projection')
    const published = (await request(page, `/v1/rooms/${roomId}/messages`)).messages.find((message) => message.originRunId === completed.runId && message.status === 'final')
    await page.locator('#room-message-' + published.id).waitFor()
    return completed
  }
  await send('你好，请用一句简短的中文回复。')
  const greeting = await settle(entry.roomId)
  await capture('02-normal-reply')
  const messages = (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
  assert(messages.filter((message) => message.authorKind === 'member').every((message) => message.originRunId && !message.replyToMessageId))
  assert.equal(await page.locator('.rooms-message-reference').count(), 0)
  assert.equal(await page.locator('.rooms-reply-count').count(), 0)
  const bubbles = await page.locator('.rooms-message-bubble').evaluateAll((elements) => elements.map((element) => ({ author: element.closest('article').className, x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })))
  assert(bubbles.find((item) => item.author.includes('user')).x > bubbles.find((item) => item.author.includes('member')).x)
  const composed = await page.locator('.rooms-composer-surface').boundingBox()
  assert(composed.height < 110, 'Empty composer starts at one compact row')
  await send('CREATE_FILE：请直接用文件工具在当前工作目录创建 hello.txt，内容必须是 hello from Kun 加一个换行。完成后简短确认，不要只给出代码。')
  const created = await settle(entry.roomId, greeting.id)
  const location = await request(page, `/v1/rooms/${entry.roomId}/direct`)
  assert.equal(await readFile(join(location.workspace.path, 'hello.txt'), 'utf8'), 'hello from Kun\n')
  await capture('03-file-created')
  await send('UPDATE_FILE：修改刚才的 hello.txt，将全部内容替换为 updated by Kun 加一个换行。使用实际工具完成，简短确认。')
  const updated = await settle(entry.roomId, created.id)
  assert.equal(updated.threadId, created.threadId, 'Follow-up reuses the same model conversation')
  assert.equal(await readFile(join(location.workspace.path, 'hello.txt'), 'utf8'), 'updated by Kun\n')
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('button', { name: 'Conversation files', exact: true }).click()
  await page.getByRole('dialog', { name: 'Conversation files', exact: true }).getByRole('button', { name: 'hello.txt', exact: true }).click()
  await page.getByText('updated by Kun', { exact: false }).first().waitFor()
  await capture('04-updated-file-preview')
  await page.getByRole('dialog', { name: 'Room details', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await application.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog
    dialog.showOpenDialog = async (...args) => { dialog.showOpenDialog = original; return { canceled: false, filePaths: [path] } }
  }, workspaceRoot)
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('button', { name: 'Connect a project folder', exact: true }).click()
  await poll(async () => (await request(page, `/v1/rooms/${entry.roomId}`)).room.privateWorkspace === workspaceRoot ||
    (await request(page, `/v1/rooms/${entry.roomId}`)).room.privateWorkspace?.endsWith(workspaceRoot.split('/').at(-1)), 15000, 'connect chosen folder')
  await send('PROJECT_FILE：在当前已连接的项目目录创建 project-result.txt，内容为 project verified 加一个换行。实际完成后简短确认。')
  const project = await settle(entry.roomId, updated.id)
  assert.notEqual(project.threadId, updated.threadId, 'Changing project creates a compatible scoped session')
  assert.equal(await readFile(join(workspaceRoot, 'project-result.txt'), 'utf8'), 'project verified\n')
  assert.equal((await request(page, `/v1/rooms/${entry.roomId}/tasks`)).tasks.length, 0)
  await capture('05-project-work')
  await page.locator('.direct-current-model').click()
  const models = page.getByRole('dialog', { name: 'Model settings', exact: true })
  await models.getByRole('combobox', { name: 'Main model', exact: true }).waitFor()
  await capture('06-model-settings')
  assert((await models.innerText()).includes('Effective'))
  await models.getByRole('button', { name: 'Close', exact: true }).click()
  if (!real) {
    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await capture('07-new-chat-picker')
    await page.getByRole('button', { name: 'Create new agent', exact: true }).click()
    await poll(async () => (await page.locator('.direct-chat-title').innerText()).includes('New agent'), 15000, 'quick creation')
    assert.equal(await page.locator('.agent-profile-form').count(), 0, 'No creation form gates chat')
    const newAgent = (await request(page, '/v1/agents')).agents.find((agent) => agent.id !== entry.agentId)
    const conversation = (await request(page, `${'/v1/agents/' + newAgent.id}/conversations`)).conversations[0]
    await send('你好，新 Agent。请简短回复。')
    await settle(conversation.id)
    await capture('08-new-agent-chat')
    await page.locator('.direct-current-model').click()
    const options = await request(page, `/v1/agents/${newAgent.id}/models`)
    const other = options.options.find((item) => item.available && item.fastAvailable && item.model !== options.main.model)
    assert(other, 'A second configured model is available')
    const key = JSON.stringify([other.providerId, other.accountId, other.model])
    await models.getByRole('combobox', { name: 'Main model', exact: true }).selectOption(key)
    await models.getByRole('combobox', { name: 'Lightweight model', exact: true }).selectOption(key)
    await models.getByRole('button', { name: 'Save', exact: true }).click()
    await poll(async () => (await request(page, `/v1/agents/${newAgent.id}/models`)).agent.fastModelRef?.model === other.model, 10000, 'main and lightweight save')
    const unchanged = await request(page, `/v1/agents/${entry.agentId}/models`)
    assert(!unchanged.agent.modelRef && !unchanged.agent.fastModelRef)
    await capture('09-independent-models')
    await models.getByRole('button', { name: 'Close', exact: true }).click()
    const previous = (await request(page, `/v1/rooms/${conversation.id}/direct`)).requests[0]
    await send('用你现在的模型简短回复。')
    const switched = await settle(conversation.id, previous.id)
    const switchedRun = await request(page, `/v1/rooms/${conversation.id}/runs/${switched.runId}`)
    assert.equal(switchedRun.run.model, other.model)
    await send('HOLD_RESPONSE 请等待。')
    await poll(() => fixture.holding() && page.getByRole('button', { name: 'Stop response', exact: true }).isVisible(), 15000, 'active response')
    await editor().fill('Preserved draft')
    await page.getByRole('button', { name: 'Stop response', exact: true }).click()
    await poll(async () => ['stopping', 'cancelled'].includes((await request(page, `/v1/rooms/${conversation.id}/direct`)).requests[0]?.status), 20000, 'durable cancellation acknowledged')
    fixture.release()
    await poll(async () => !(await request(page, `/v1/rooms/${conversation.id}/direct`)).active, 20000, 'stop original response')
    const stopped = (await request(page, `/v1/rooms/${conversation.id}/direct`)).requests[0]
    assert.equal(stopped.status, 'cancelled')
    assert(!(await request(page, `/v1/rooms/${conversation.id}/messages`)).messages.some((message) => message.originRunId === stopped.runId && message.status === 'final'))
    assert.equal(await editor().innerText(), 'Preserved draft')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('[data-workspace-mode-trigger]').first().waitFor()
    if (!await page.locator('[data-rooms-workspace]').count()) await switchRooms()
    await editor().waitFor()
    assert.equal(await editor().innerText(), 'Preserved draft')
    await capture('10-restored-draft')
    await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark') })
    await page.waitForTimeout(500)
    await capture('11-dark-chat')
    await resize(760, 780); await page.waitForTimeout(400)
    assert((await page.evaluate(() => window.innerWidth)) < 768, 'Exercise the actual narrow responsive breakpoint')
    await capture('12-narrow-chat')
    assert(await page.locator('[data-rooms-workspace]').evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
  }
  assert.equal(fixture.snapshot().blocked, 0, 'Acceptance stays inside the model-call budget')
  return { userRequests, approvals, defaultAgentId: entry.agentId, roomId: entry.roomId, persistentThreadId: updated.threadId, projectThreadId: project.threadId,
    assertions: ['UI-only onboarding and quick creation', 'ordinary private response', 'real file creation and continuous modification', 'chosen project scope', 'no task required', 'main and lightweight settings', 'readable artifacts'] }
}
module.exports = { exerciseDirectChat }
