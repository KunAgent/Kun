'use strict'
const assert = require('node:assert/strict')
const { confirmAgentCreationModel } = require('./smoke-agent-creation-model.cjs')
const { createHash } = require('node:crypto')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const { previewRoomWorkspaceFile, collapseRoomPanel, roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')

async function exerciseDirectChat({ page, request, poll, capture, fixture, application, workspaceRoot, real, resize, openPrivate, approve }) {
  let userRequests = 0, approvals = 0
  await openPrivate()
  await page.locator('.direct-header').waitFor()
  const entry = await request(page, '/v1/agents/chat-entry')
  assert(entry.initialized && entry.roomId)
  const agents = await request(page, '/v1/agents')
  assert.equal(agents.agents.length, 1, 'Opening Code Conversations initializes exactly one Agent')
  assert.equal(agents.agents[0].name, '小 Kun')
  assert.equal((await request(page, '/v1/rooms?conversation_kind=user_agent')).rooms.length, 1)
  assert.equal(fixture.snapshot().mainCalls, 0, 'Initialization must not call a model')
  assert.equal(await page.locator('.rooms-init-banner').count(), 0)
  assert.equal(await page.locator('.agent-collaboration-strip').count(), 0)
  assert.equal(await page.locator('.rooms-composer select').count(), 1, 'Private composer has one explicit model selector')
  const composerModel = page.locator('.rooms-composer').getByRole('combobox', { name: 'Model for this conversation', exact: true })
  await poll(() => composerModel.isEnabled(), 10000, 'private composer model metadata loaded')
  await capture('01-empty-kun')
  // Code conversations keep composer tools in the "+" menu, like the Code task composer.
  await page.locator('.rooms-composer').getByRole('button', { name: 'Add context', exact: true }).click()
  await page.locator('.rooms-popover-surface').getByRole('button', { name: 'Emoji', exact: true }).click()
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
    await poll(async () => !(await request(page, `/v1/rooms/${roomId}/direct`)).active &&
      !(await page.locator('.rooms-agent-activity').count()), 15000, 'working row clears after completion')
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
  const publishedWork = (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
    .filter((message) => message.originRunId === created.runId)
  const start = publishedWork.find((message) => message.deliveryPhase === 'start')
  const final = publishedWork.find((message) => message.deliveryPhase === 'final')
  assert(start && final && start.messageSeq < final.messageSeq, 'Work shows a start bubble before its final result')
  const createdRun = await request(page, `/v1/rooms/${entry.roomId}/runs/${created.runId}`)
  assert(Number.isFinite(createdRun.run.firstResponseMs), 'The run records time to first public response')
  const paintedStart = await page.evaluate(async (id) => {
    const { roomResponseLatencySnapshot } = await import('/src/components/rooms/room-im-response-metrics.ts')
    return roomResponseLatencySnapshot().find((item) => item.messageId === id)
  }, start.id)
  assert(Number.isFinite(paintedStart?.commitToRenderMs), 'The renderer records commit-to-render latency separately')
  const location = await request(page, `/v1/rooms/${entry.roomId}/direct`)
  assert.equal(await readFile(join(location.workspace.path, 'hello.txt'), 'utf8'), 'hello from Kun\n')
  await capture('03-file-created')
  await send('UPDATE_FILE：修改刚才的 hello.txt，将全部内容替换为 updated by Kun 加一个换行。使用实际工具完成，简短确认。')
  const updated = await settle(entry.roomId, created.id)
  assert.equal(updated.threadId, created.threadId, 'Follow-up reuses the same model conversation')
  assert.equal(await readFile(join(location.workspace.path, 'hello.txt'), 'utf8'), 'updated by Kun\n')
  const senderBeforePreview = await roomWorkbenchSnapshot(page)
  await previewRoomWorkspaceFile(page, 'hello.txt', 'updated by Kun', poll)
  assert.deepEqual(await roomWorkbenchSnapshot(page), senderBeforePreview,
    'Opening a private file preview preserves the selected Agent, Code route and project scope')
  await capture('04-updated-file-preview')
  await collapseRoomPanel(page)
  if (process.argv.includes('--delivery-only')) {
    await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark') })
    await capture('05-dark-delivery')
    await resize(760, 780)
    await page.waitForTimeout(200)
    assert((await page.evaluate(() => window.innerWidth)) < 768, 'Exercise the narrow renderer layout')
    await capture('06-narrow-delivery')
    assert(await page.locator('[data-rooms-workspace]').evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    return { userRequests, approvals, roomId: entry.roomId,
      responseTiming: { firstResponseMs: createdRun.run.firstResponseMs, commitToRenderMs: paintedStart.commitToRenderMs },
      assertions: ['first public response before work', 'final result after work', 'real file creation and modification', 'desktop, dark and narrow screenshots'] }
  }
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
  const models = page.locator('.rooms-details-panel:visible')
  const openRoleModels = async () => {
    await page.locator('.direct-header').getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('button', { name: 'Model settings', exact: true }).click()
    await models.getByRole('combobox', { name: 'Main model', exact: true }).waitFor()
  }
  await openRoleModels()
  await capture('06-model-settings')
  assert((await models.innerText()).includes('Effective'))
  await models.getByRole('button', { name: 'Close', exact: true }).click()
  if (!real) {
    await page.locator('.sidebar-agent-chats').getByRole('button', { name: 'New conversation', exact: true }).click()
    await capture('07-new-chat-picker')
    await page.getByRole('button', { name: 'Define in chat', exact: true }).click()
    const createdModelRef = await confirmAgentCreationModel({ page, request })
    await poll(async () => (await page.locator('.direct-chat-title').innerText()).includes('New agent'), 15000, 'quick creation')
    assert.equal(await page.locator('.agent-profile-form').count(), 0, 'No creation form gates chat')
    const newAgent = (await request(page, '/v1/agents')).agents.find((agent) => agent.id !== entry.agentId)
    assert.deepEqual(newAgent.modelRef, createdModelRef)
    const conversation = (await request(page, `${'/v1/agents/' + newAgent.id}/conversations`)).conversations[0]
    await send('你好，新 Agent。请简短回复。')
    await settle(conversation.id)
    await capture('08-new-agent-chat')
    await openRoleModels()
    const options = await request(page, `/v1/agents/${newAgent.id}/models`)
    const other = options.options.find((item) => item.available && item.fastAvailable && item.model !== options.main.model)
    assert(other, 'A second configured model is available')
    const key = JSON.stringify([other.providerId, other.accountId, other.model])
    await models.getByRole('combobox', { name: 'Main model', exact: true }).selectOption(key)
    await poll(async () => {
      const saved = (await request(page, `/v1/agents/${newAgent.id}/models`)).agent.modelRef
      return JSON.stringify([saved?.providerId, saved?.accountId, saved?.model]) === key &&
        await models.getByRole('combobox', { name: 'Lightweight model', exact: true }).isEnabled()
    }, 10000, 'main model saved immediately before lightweight selection')
    await models.getByRole('combobox', { name: 'Lightweight model', exact: true }).selectOption(key)
    await poll(async () => {
      const saved = (await request(page, `/v1/agents/${newAgent.id}/models`)).agent
      return [saved.modelRef, saved.fastModelRef].every((ref) => JSON.stringify([ref?.providerId, ref?.accountId, ref?.model]) === key)
    }, 10000, 'exact main and lightweight provider/account/model saved immediately')
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
    // A message sent while the reply is running steers into the live turn
    // instead of queueing a separate one.
    await send('请把这句并入当前回复。')
    await poll(async () => {
      const data = await request(page, `/v1/rooms/${conversation.id}/direct`)
      const merged = data.requests.find((entry) => entry.steer)
      if (!merged || merged.status !== 'running' || merged.turnId) return false
      const run = await request(page, `/v1/rooms/${conversation.id}/runs/${merged.runId}`)
      return run.run.mergedIntoRunId === merged.steer.targetRunId && run.run.turnId === merged.steer.targetTurnId
    }, 20000, 'busy message merged into the running reply')
    const merged = (await request(page, `/v1/rooms/${conversation.id}/direct`)).requests.find((entry) => entry.steer)
    assert.equal(merged.steer.targetRunId, (await request(page, `/v1/rooms/${conversation.id}/runs/${merged.runId}`)).run.mergedIntoRunId)
    await capture('09b-steered-merge')
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
    await openPrivate(newAgent.name)
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
