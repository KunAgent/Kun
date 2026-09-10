'use strict'

const { createServer } = require('node:http')
const { execFileSync } = require('node:child_process')

async function startQueueSmokeModel() {
  const waiting = new Set()
  const prompts = []
  let released = false
  const finish = (response) => {
    response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Smoke complete.' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  }
  const server = createServer((request, response) => {
    if (request.url?.endsWith('/models')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'deepseek-chat' }] }))
      return
    }
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const input = JSON.parse(body || '{}')
      prompts.push(input.messages?.filter((message) => message.role === 'user').map((message) => message.content) ?? [])
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(': waiting for smoke release\n\n')
      if (released) finish(response)
      else waiting.add(response)
      response.on('close', () => waiting.delete(response))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    release: () => { released = true; for (const response of waiting) finish(response); waiting.clear() },
    prompts,
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

async function assertRuntimeQueueBridge(page, workspaceRoot, model) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ready = await page.evaluate(async () => {
      const { useChatStore } = await import('/src/store/chat-store.ts')
      return useChatStore.getState().runtimeConnection === 'ready'
    })
    if (ready) break
    await page.waitForTimeout(100)
  }
  const threadId = await page.evaluate(async ({ workspace, baseUrl }) => {
    const snapshot = await window.kunGui.runtimeRequest('/v1/model-connections', 'GET')
    if (!snapshot.ok) throw new Error(snapshot.body)
    const connected = await window.kunGui.runtimeRequest('/v1/model-connections/connect', 'POST', JSON.stringify({
      expectedRevision: JSON.parse(snapshot.body).revision, id: 'queue-smoke', name: 'Queue Smoke',
      kind: 'http', baseUrl, credential: 'isolated-smoke-placeholder', models: ['deepseek-chat'],
      selectedModel: 'deepseek-chat', probe: false, select: true
    }))
    if (!connected.ok) throw new Error(connected.body)
    const { useChatStore } = await import('/src/store/chat-store.ts')
    await useChatStore.getState().loadComposerModels()
    await useChatStore.getState().createThread({ workspaceRoot: workspace, forceNew: true, agentSurface: 'code' })
    const state = useChatStore.getState()
    const group = state.composerModelGroups.find((item) => item.modelIds.includes('deepseek-chat') && item.accountId)
    if (!group) throw new Error('Real model catalog has no account-backed deepseek-chat selection')
    state.setComposerModel('deepseek-chat', group.providerId)
    state.setRoute('chat')
    if (!state.activeThreadId) throw new Error(`Thread creation failed: ${state.error}; connection=${state.runtimeConnection}`)
    return state.activeThreadId
  }, { workspace: workspaceRoot, baseUrl: model.baseUrl })
  if (!threadId) throw new Error('No active smoke thread')
  const request = (suffix, method = 'GET', body) => page.evaluate(async ({ threadId, suffix, method, body }) => {
    const result = await window.kunGui.runtimeRequest(`/v1/threads/${encodeURIComponent(threadId)}${suffix}`, method,
      body === undefined ? undefined : JSON.stringify(body))
    if (!result.ok) throw new Error(`${method} ${suffix}: ${result.body}`)
    return JSON.parse(result.body)
  }, { threadId, suffix, method, body })
  const composer = page.locator('[data-floating-composer]').filter({ visible: true }).first()
  const textarea = composer.locator('textarea').first()
  const send = async (text) => {
    await textarea.fill(text)
    await composer.locator('.ds-composer-primary-action').click()
  }
  const rowSnapshot = (text) => page.evaluate(async (text) => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().queuedMessages.find((row) => row.text === text)
  }, text)
  const waitRow = async (text) => {
    let row
    for (let attempt = 0; attempt < 200; attempt += 1) {
      row = await rowSnapshot(text)
      if (row?.deliveryState === 'in_flight' && row.deliveryTurnId) break
      await page.waitForTimeout(100)
    }
    if (row?.deliveryState !== 'in_flight') throw new Error(`Queue admission did not settle: ${JSON.stringify(row)}`)
    if (!row?.accountId || !row.providerId || !row.model) throw new Error('Production queue row is missing its route snapshot')
    return row
  }
  try {
    await send('Smoke hold A')
    let activeTurnId
    for (let attempt = 0; attempt < 200; attempt += 1) {
      activeTurnId = await page.evaluate(async () => {
        const { useChatStore } = await import('/src/store/chat-store.ts')
        return useChatStore.getState().currentTurnId
      })
      if (activeTurnId) break
      await page.waitForTimeout(100)
    }
    if (!activeTurnId) throw new Error('A did not start')
    await send('你是谁')
    const b = await waitRow('你是谁')
    const edit = composer.locator(`[data-queued-message-id="${b.id}"] [data-queued-message-action="edit"]`)
    if (await edit.isDisabled()) throw new Error(`Account-backed production edit button is disabled: ${JSON.stringify(b)}; title=${await edit.getAttribute('title')}`)
    await textarea.fill('Input retained')
    await edit.click()
    await page.waitForFunction(() => document.querySelector('[data-floating-composer] textarea')?.value === 'Input retained\n你是谁')
    if (!await textarea.evaluate((node) => node === document.activeElement)) throw new Error('Restored composer is not focused')
    const cancelled = (await request('/queued-turns')).settledTurns?.find((turn) => turn.turnId === b.deliveryTurnId)
    if (cancelled?.terminalCode !== 'queue_cancelled') throw new Error(`Original B was not cancelled: ${JSON.stringify(cancelled)}`)
    if ((await request(`/turns/${activeTurnId}`)).status !== 'running') throw new Error('Editing B interrupted A')
    await send('B edited')
    const edited = await waitRow('B edited')
    for (const key of ['providerId', 'model', 'accountId']) {
      if (edited[key] !== b[key]) throw new Error(`Edited submission changed ${key}`)
    }
    if (edited.clientRequestId === b.clientRequestId || edited.deliveryTurnId === b.deliveryTurnId) throw new Error('Edited B reused original identity')
    await page.evaluate(async () => {
      const { useChatStore } = await import('/src/store/chat-store.ts')
      await useChatStore.getState().loadComposerModels()
    })
    await send('After catalog refresh')
    const c = await waitRow('After catalog refresh')
    const header = composer.locator('[data-queued-message-header]')
    if (await header.getAttribute('aria-expanded') === 'false') await header.click()
    const editC = composer.locator(`[data-queued-message-id="${c.id}"] [data-queued-message-action="edit"]`)
    if (await editC.isDisabled()) throw new Error('Catalog refresh disabled edit')
    await editC.click()
    await page.waitForFunction(() => document.querySelector('[data-floating-composer] textarea')?.value === 'After catalog refresh')
    await textarea.fill('')
    model.release()
    let completed = false
    for (let attempt = 0; attempt < 300; attempt += 1) {
      completed = (await request(`/turns/${edited.deliveryTurnId}`)).status === 'completed'
      if (completed) break
      await page.waitForTimeout(200)
    }
    if (!completed) throw new Error('Edited turn did not complete after model release')
    const finalQueue = await request('/queued-turns')
    if (finalQueue.queuedTurns.length) throw new Error('Queue did not settle')
    if (!finalQueue.settledTurns?.some((turn) => turn.turnId === b.deliveryTurnId && turn.terminalCode === 'queue_cancelled')) {
      throw new Error('Original B cancellation was not retained')
    }
    if (JSON.stringify(model.prompts).includes('你是谁') || JSON.stringify(model.prompts).includes('After catalog refresh')) {
      throw new Error('Cancelled prompt reached the model')
    }
    if (!JSON.stringify(model.prompts).includes('B edited')) throw new Error('Edited prompt did not reach the model')
    const runtime = await page.evaluate(async () => {
      const result = await window.kunGui.runtimeRequest('/v1/runtime/info', 'GET')
      const info = JSON.parse(result.body)
      return { buildId: info.buildId, version: info.serviceVersion }
    })
    return { threadId, accountId: b.accountId, providerId: b.providerId, model: b.model,
      originalTurnId: b.deliveryTurnId, editedTurnId: edited.deliveryTurnId,
      realEditClicks: 2, realComposerSend: true, runtime,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8' }).trim() }
  } finally {
    await request('', 'DELETE').catch(() => undefined)
  }
}

module.exports = { startQueueSmokeModel, assertRuntimeQueueBridge }
