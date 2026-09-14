'use strict'
const assert = require('node:assert/strict')
async function exercisePinStream({ page, request, poll, capture, fixture, switchRooms }) {
  await switchRooms()
  await page.locator('.direct-header').waitFor()
  const entry = await request(page, '/v1/agents/chat-entry')
  const create = async () => {
    const before = await page.evaluate(() => localStorage.getItem('kun.rooms.selected'))
    await page.getByRole('button', { name: 'New conversation', exact: true }).click()
    await page.getByRole('button', { name: 'Create new agent', exact: true }).click()
    await poll(async () => (await page.evaluate(() => localStorage.getItem('kun.rooms.selected'))) !== before && await page.locator('.rooms-rich-input').count(), 15000, 'new private conversation')
  }
  for (let i = 0; i < 3; i++) await create()
  await poll(async () => await page.locator('[data-sidebar-entry]').count() === 4, 10000, 'four sidebar entries')
  const currentRoom = await page.evaluate(() => localStorage.getItem('kun.rooms.selected'))
  await page.locator('.rooms-rich-input').fill('preserved draft')
  await page.evaluate(async () => {
    const { rendererRuntimeClient } = await import('/src/agent/runtime-client.ts')
    const original = rendererRuntimeClient.runtimeRequest.bind(rendererRuntimeClient)
    globalThis.__pinSaves = 0
    globalThis.__liveEvents = []
    rendererRuntimeClient.onSseEvent((payload) => {
      if (payload.streamId.startsWith('room-text-')) for (const event of payload.events) globalThis.__liveEvents.push({ kind: event.kind, time: Date.now(), length: event.message?.body?.length })
    })
    rendererRuntimeClient.onSseError((payload) => { if (payload.streamId.startsWith('room-text-')) globalThis.__liveEvents.push({ error: payload.message }) })
    rendererRuntimeClient.runtimeRequest = async (path, method, body, options) => {
      if (method === 'PATCH' && /^\/v1\/rooms\/[^/]+$/.test(path) && body?.includes('"pinned"')) {
        globalThis.__pinSaves++; await new Promise((resolve) => setTimeout(resolve, 700))
      }
      return original(path, method, body, options)
    }
  })
  const target = page.locator('[data-sidebar-entry="agent:' + entry.agentId + '"]')
  await target.hover(); await target.locator('.rooms-sidebar-row-menu').click()
  const start = Date.now()
  await page.getByRole('button', { name: 'Pin room', exact: true }).click()
  await poll(async () => await page.locator('[data-sidebar-entry]').first().getAttribute('data-pinned') === 'true', 350, 'optimistic pin before network acknowledgement')
  const optimisticMs = Date.now() - start
  const animations = await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.getKeyframes().some((key) => key.transform)).length)
  assert(animations > 0, 'Rows move with a compositor animation')
  await capture('pin-immediate')
  await poll(async () => (await request(page, `/v1/rooms/${entry.roomId}`)).room.pinned, 10000, 'persisted pin')
  assert.equal(await page.evaluate(() => localStorage.getItem('kun.rooms.selected')), currentRoom)
  assert.equal(await page.locator('.rooms-rich-input').innerText(), 'preserved draft')
  await page.waitForTimeout(600)
  assert.equal(await page.locator('[data-sidebar-entry]').first().getAttribute('data-sidebar-entry'), 'agent:' + entry.agentId)
  await capture('pin-confirmed')
  await page.evaluate(() => {
    globalThis.__streamSamples = []
    globalThis.__streamObserver = new MutationObserver(() => {
      const body = document.querySelector('.rooms-message-member .rooms-message-body')?.textContent ?? ''
      const samples = globalThis.__streamSamples
      if (body.length && samples.at(-1)?.length !== body.length) samples.push({ time: Date.now(), length: body.length })
    })
    globalThis.__streamObserver.observe(document.querySelector('[data-rooms-workspace]'), { childList: true, subtree: true, characterData: true })
  })
  await page.locator('.rooms-rich-input').fill('STREAM_BENCH')
  await page.locator('.rooms-rich-input').press('Enter')
  await poll(async () => (await page.locator('.rooms-message-member .rooms-message-body').innerText().catch(() => '')).includes('word10'), 15000, 'live text during generation')
  await page.evaluate(() => {
    globalThis.__typingPaint = []
    document.querySelector('.rooms-rich-input').addEventListener('keydown', (event) => {
      const began = event.timeStamp
      requestAnimationFrame(() => globalThis.__typingPaint.push(performance.now() - began))
    })
  })
  const typingStart = Date.now()
  await page.locator('.rooms-rich-input').pressSequentially('draft during output', { delay: 5 })
  const typingMs = Date.now() - typingStart
  await page.waitForTimeout(50)
  const typingPaint = await page.evaluate(() => globalThis.__typingPaint)
  typingPaint.sort((a, b) => a - b)
  const typingPaintP95Ms = typingPaint[Math.floor(typingPaint.length * .95)]
  assert(typingPaintP95Ms < 200, `Input-to-frame p95 ${typingPaintP95Ms}ms (automation command ${typingMs}ms)` )
  await poll(async () => {
    const values = await request(page, `/v1/rooms/${currentRoom}/direct`)
    return values.requests[0]?.status === 'completed'
  }, 60000, 'streamed response completion')
  await poll(async () => (await page.locator('.rooms-message-member .rooms-message-body').innerText()).includes('word99'), 10000, 'final word')
  const samples = await page.evaluate(() => { globalThis.__streamObserver.disconnect(); return globalThis.__streamSamples })
  const firstChunk = fixture.snapshot().benchmarkChunks[0]
  const during = samples.filter((sample) => sample.time <= fixture.snapshot().benchmarkChunks.at(-1))
  const gaps = during.slice(1).map((sample, index) => sample.time - during[index].time).sort((a, b) => a - b)
  const p95GapMs = gaps[Math.floor(gaps.length * .95)] ?? Infinity
  const firstTextMs = during[0]?.time - firstChunk
  const liveEvents = await page.evaluate(() => globalThis.__liveEvents)
  assert(during.length >= 30, `Expected smooth incremental updates; saw ${during.length}; events=${JSON.stringify(liveEvents)}; samples=${JSON.stringify(samples)}`)
  assert(firstTextMs < 650, `First text lag ${firstTextMs}ms`)
  assert(p95GapMs < 300, `Stream update p95 gap ${p95GapMs}ms`)
  assert(samples.every((sample, index) => !index || sample.length >= samples[index - 1].length), 'No stream rewinds: ' + JSON.stringify(samples))
  assert.equal((await page.locator('.rooms-message-member .rooms-message-body').innerText()).trim(), Array.from({ length: 100 }, (_, index) => 'word' + index).join(' '))
  await capture('stream-finished')
  assert.equal(await page.locator('.rooms-rich-input').innerText(), 'draft during output')
  // Reconnect the renderer while another turn is still streaming; hydration must not duplicate text.
  await page.locator('.rooms-rich-input').fill('STREAM_BENCH reconnect')
  await page.locator('.rooms-rich-input').press('Enter')
  await poll(() => fixture.snapshot().benchmarkChunks.length >= 120, 15000, 'second stream')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor()
  if (!await page.locator('[data-rooms-workspace]').count()) await switchRooms()
  await poll(async () => (await request(page, `/v1/rooms/${currentRoom}/direct`)).requests[0]?.status === 'completed', 30000, 'reconnected stream completion')
  await poll(async () => await page.locator('.rooms-message-member .rooms-message-body').count() === 2, 10000, 'two distinct responses')
  for (const text of await page.locator('.rooms-message-member .rooms-message-body').allInnerTexts()) {
    assert.equal(text.trim(), Array.from({ length: 100 }, (_, index) => 'word' + index).join(' '))
  }
  for (let i = 0; i < 62; i++) await create()
  const list = page.locator('.rooms-im-sidebar-list')
  await list.getByRole('button', { name: 'Load more', exact: true }).click()
  await poll(async () => await list.locator('div[style*="height"]').first().evaluate((element) => element.clientHeight > 4000), 15000, 'virtualized sidebar')
  await list.evaluate((element) => { element.scrollTop = 1500 })
  await page.waitForTimeout(300)
  const geometry = await list.evaluate((element) => {
    const top = element.getBoundingClientRect().top
    const rows = [...element.querySelectorAll('[data-sidebar-entry]')].filter((row) => row.getBoundingClientRect().top >= top && row.getBoundingClientRect().bottom < element.getBoundingClientRect().bottom)
    return { anchorId: rows[0].dataset.sidebarEntry, anchorTop: rows[0].getBoundingClientRect().top, targetId: rows[2].dataset.sidebarEntry }
  })
  const anchorRoom = await page.evaluate(() => localStorage.getItem('kun.rooms.selected'))
  const middle = page.locator('[data-sidebar-entry="' + geometry.targetId + '"]')
  await middle.hover(); await middle.locator('.rooms-sidebar-row-menu').click()
  await page.getByRole('button', { name: 'Pin room', exact: true }).click()
  await page.waitForTimeout(900)
  const afterTop = await page.locator('[data-sidebar-entry="' + geometry.anchorId + '"]').evaluate((element) => element.getBoundingClientRect().top)
  assert(Math.abs(afterTop - geometry.anchorTop) < 2, 'Virtual list preserves the reading anchor')
  assert.equal(await page.evaluate(() => localStorage.getItem('kun.rooms.selected')), anchorRoom)
  await capture('pin-virtual-anchor')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await list.evaluate((element) => { element.scrollTop = 0 })
  await page.waitForTimeout(300)
  const pinned = page.locator('[data-sidebar-entry][data-pinned="true"]').first()
  await pinned.hover(); await pinned.locator('.rooms-sidebar-row-menu').click()
  await page.getByRole('button', { name: 'Unpin', exact: true }).click()
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0)
  await capture('pin-reduced-motion')
  return { optimisticMs, animations, streamUpdates: during.length, firstTextMs, p95GapMs, typingMs, typingPaintP95Ms, reconnect: true, virtualAnchorDrift: Math.abs(afterTop - geometry.anchorTop), reducedMotion: true }
}
module.exports = { exercisePinStream }
