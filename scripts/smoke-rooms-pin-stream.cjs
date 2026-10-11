'use strict'
const assert = require('node:assert/strict')
const { confirmAgentCreationModel } = require('./smoke-agent-creation-model.cjs')
const { roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')
async function exercisePinStream({ page, request, poll, capture, fixture, openPrivate, openConversation }) {
  await openPrivate()
  await page.locator('.direct-header').waitFor()
  const entry = await request(page, '/v1/agents/chat-entry')
  const conversations = page.locator('.sidebar-agent-chats')
  const rows = conversations.locator('[data-sidebar-entry]')
  const selected = async () => (await roomWorkbenchSnapshot(page)).conversationRoomId
  const create = async () => {
    const before = await selected()
    await conversations.getByRole('button', { name: 'New conversation', exact: true }).click()
    await page.getByRole('button', { name: 'Define in chat', exact: true }).click()
    await confirmAgentCreationModel({ page, request })
    await poll(async () => (await selected()) !== before && await page.locator('.rooms-rich-input').count(), 15000, 'new private conversation')
  }
  for (let i = 0; i < 3; i++) await create()
  await poll(async () => await rows.count() === 4, 10000, 'four sidebar entries')
  const currentRoom = await selected()
  await page.locator('.rooms-rich-input').fill('preserved draft')
  await page.evaluate(async () => {
    const { rendererRuntimeClient } = await import('/src/agent/runtime-client.ts')
    const original = rendererRuntimeClient.runtimeRequest.bind(rendererRuntimeClient)
    globalThis.__pinSaves = 0
    rendererRuntimeClient.runtimeRequest = async (path, method, body, options) => {
      if (method === 'PATCH' && /^\/v1\/rooms\/[^/]+$/.test(path) && body?.includes('"pinned"')) {
        globalThis.__pinSaves++; await new Promise((resolve) => setTimeout(resolve, 700))
      }
      return original(path, method, body, options)
    }
  })
  const target = conversations.locator('[data-sidebar-entry="room:' + entry.roomId + '"]')
  await target.hover(); await target.locator('.sidebar-agent-chat-menu').click()
  const start = Date.now()
  await page.getByRole('button', { name: 'Pin conversation', exact: true }).click()
  await poll(async () => await rows.first().getAttribute('data-pinned') === 'true', 350, 'optimistic pin before network acknowledgement')
  const optimisticMs = Date.now() - start
  await capture('pin-immediate')
  await poll(async () => (await request(page, `/v1/rooms/${entry.roomId}`)).room.pinned, 10000, 'persisted pin')
  assert.equal(await selected(), currentRoom)
  assert.equal(await page.locator('.rooms-rich-input').innerText(), 'preserved draft')
  await page.waitForTimeout(600)
  assert.equal(await rows.first().getAttribute('data-sidebar-entry'), 'room:' + entry.roomId)
  await capture('pin-confirmed')
  // Private replies are published as whole IM bubbles through send_im_message, so
  // typing must stay responsive while a reply is in flight and a reconnect must not duplicate it.
  const editor = page.locator('.rooms-rich-input')
  const replies = async () => (await request(page, `/v1/rooms/${currentRoom}/messages`)).messages
    .filter((message) => message.authorKind === 'member' && message.status === 'final' && message.originRunId)
  const idle = async () => {
    const values = await request(page, `/v1/rooms/${currentRoom}/direct`)
    return !values.active && (!values.requests[0] || values.requests[0].status === 'completed')
  }
  // The fixture holds every model call of a HOLD_RESPONSE turn; release each one until the reply settles.
  const settled = async (description) => poll(async () => {
    if (fixture.holding()) fixture.release()
    return idle()
  }, 60000, description)
  // A new Agent greets first; measure only after that setup reply has been published.
  await poll(async () => await idle() && (await replies()).length > 0, 60000, 'new Agent greeting settles')
  const before = (await replies()).map((message) => message.id)
  await editor.fill('HOLD_RESPONSE reply while the user keeps typing')
  await editor.press('Enter')
  await poll(() => fixture.holding(), 15000, 'reply in flight')
  await page.evaluate(() => {
    globalThis.__typingPaint = []
    document.querySelector('.rooms-rich-input').addEventListener('keydown', (event) => {
      const began = event.timeStamp
      requestAnimationFrame(() => globalThis.__typingPaint.push(performance.now() - began))
    })
  })
  const typingStart = Date.now()
  await editor.pressSequentially('draft during output', { delay: 5 })
  const typingMs = Date.now() - typingStart
  await page.waitForTimeout(50)
  const typingPaint = await page.evaluate(() => globalThis.__typingPaint)
  typingPaint.sort((a, b) => a - b)
  const typingPaintP95Ms = typingPaint[Math.floor(typingPaint.length * .95)]
  assert(typingPaintP95Ms < 200, `Input-to-frame p95 ${typingPaintP95Ms}ms (automation command ${typingMs}ms)` )
  await settled('held reply completion')
  await poll(async () => (await replies()).length === before.length + 1, 15000, 'one published reply')
  const first = (await replies()).find((message) => !before.includes(message.id))
  await page.locator('#room-message-' + first.id).waitFor()
  assert.equal(await editor.innerText(), 'draft during output')
  await capture('reply-finished')
  // Reconnect the renderer while another reply is in flight; hydration must not duplicate it.
  await editor.fill('HOLD_RESPONSE reconnect')
  await editor.press('Enter')
  await poll(() => fixture.holding(), 15000, 'second reply in flight')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor()
  await openConversation(currentRoom)
  await settled('reconnected reply completion')
  await poll(async () => (await replies()).length === before.length + 2, 15000, 'two distinct replies')
  const published = (await replies()).filter((message) => !before.includes(message.id))
  assert.equal(new Set(published.map((message) => message.originRunId)).size, 2)
  for (const message of published) {
    await page.locator('#room-message-' + message.id).waitFor()
    assert.equal(await page.locator('#room-message-' + message.id).count(), 1)
  }
  await capture('reply-reconnected')
  const pinned = conversations.locator('[data-sidebar-entry][data-pinned="true"]').first()
  await pinned.hover(); await pinned.locator('.sidebar-agent-chat-menu').click()
  await page.getByRole('button', { name: 'Unpin conversation', exact: true }).click()
  await poll(async () => !(await request(page, `/v1/rooms/${entry.roomId}`)).room.pinned, 10000, 'persisted unpin')
  await poll(async () => await conversations.locator('[data-sidebar-entry][data-pinned="true"]').count() === 0, 10000, 'unpinned sidebar row')
  assert.equal(await selected(), currentRoom)
  await capture('pin-removed')
  return { optimisticMs, typingMs, typingPaintP95Ms, reconnect: true, unpinned: true }
}
module.exports = { exercisePinStream }
