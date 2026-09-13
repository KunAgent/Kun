'use strict'

const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')

const NAME = 'Architecture review and implementation planning'
const EMPTY_NAME = 'New team conversation'
const ATTACHMENT_NAME = 'Architecture decisions and acceptance notes.txt'
const INPUT_NAME = 'Discuss a question or describe the work to do\u2026'
const SEARCH_NAME = 'Search messages (2+ characters)'

/** Only the disposable Manager owns this database; do not open SQLite in the smoke process. */
async function isolatedManagerCommit(home, profile, input) {
  const manager = JSON.parse(await readFile(join(home, '.kun', 'control', 'manager.json'), 'utf8'))
  assert.equal(resolve(manager.dataDir), resolve(profile), 'UI fixtures must stay in this smoke profile')
  const url = new URL(manager.baseUrl)
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Expected isolated loopback Manager')
  const response = await fetch(new URL('/v1/data/room/commit', url), {
    method: 'POST', headers: { authorization: `Bearer ${manager.managerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }), signal: AbortSignal.timeout(15000)
  })
  assert(response.ok, `Cannot seed isolated UI fixture: ${response.status} ${await response.text()}`)
}

async function seedMessages({ page, request, home, profile, room }) {
  const { attachment } = await request(page, '/v1/attachments', 'POST', {
    name: ATTACHMENT_NAME, mimeType: 'text/plain',
    dataBase64: Buffer.from('Architecture decisions\n\nKeep discussions bounded. Preserve explicit delivery approval.\n').toString('base64'),
    documentText: 'Keep discussions bounded. Preserve explicit delivery approval.', documentFormat: 'text'
  })
  const bodies = [
    ...Array.from({ length: 18 }, (_, index) => `Review note ${index + 1}: keep the conversation readable and preserve the approved execution boundary.`),
    'Please review the queue design and explain the remaining tradeoffs before implementation.',
    'I suggest a bounded queue, explicit backpressure, and a small set of measurable acceptance checks.',
    'The implementation sketch keeps each worker accountable for its own inputs.\n\n```ts\n' +
      'const queue = createQueue({ capacity: 32, overflow: "wait", traceLabel: "' + 'long-trace-label-'.repeat(18) + '" });\n' +
      'await queue.enqueue({ topicId, memberId, sourceRevision });\nawait queue.waitUntilIdle();\n```',
    '| Area | Decision | Acceptance check |\n| --- | --- | --- |\n' +
      '| Scheduling | Two concurrent discussions | Fair progress across topics |\n' +
      '| Storage | Durable inbox and message revisions | Restart reuses the original response identity |',
    'Agreed. Keep automatic discussion independent from task approval, and make the current state easy to find.',
    'The acceptance notes are attached. We can continue with implementation once the review is complete.'
  ]
  const values = bodies.map((body, index) => {
    const member = room.members[index % room.members.length]
    return { kind: 'message', id: 'ui-message-' + index, roomId: room.id, value: {
      id: 'ui-message-' + index, roomId: room.id, messageSeq: index + 1, bodyRevision: 0,
      authorKind: index === 18 ? 'user' : 'member', authorMemberId: index === 18 ? undefined : member.id,
      authorLabelSnapshot: index === 18 ? 'You' : member.displayName, body, mentionMemberIds: [],
      attachmentIds: index === 23 ? [attachment.id] : [], status: 'final',
      ...(index === 22 ? { replyToMessageId: 'ui-message-19' } : {}),
      createdAt: new Date(Date.now() - (bodies.length - index) * 60000).toISOString()
    } }
  })
  // This inert display fixture cannot be scheduled; actual running status below comes from a held real request.
  values.push({ kind: 'task', id: 'ui-review-delivery', roomId: room.id, taskId: 'ui-review-delivery', value: {
    task: { id: 'ui-review-delivery', roomId: room.id, requestId: 'ui-delivery-request', sourceMessageId: 'ui-message-18',
      title: 'Review the architecture acceptance checklist', ownerMemberId: room.members[1].id,
      memberSnapshot: room.members[1], repositoryId: 'repo', workspaceId: 'ui-display-workspace',
      executionThreadId: 'ui-display-thread', status: 'awaiting_acceptance', stage: 'develop', requirementRevision: 0,
      revision: 0, latestProgress: 'Display fixture: review notes are ready.', verificationStatus: 'not_run',
      applicationStatus: 'not_applied', updatedAt: new Date().toISOString() }
  } })
  await isolatedManagerCommit(home, profile, {
    requestId: 'ui-canonical-fixture', checks: values.map(({ kind, id }) => ({ kind, id, expectedRevision: null })),
    puts: values, events: values.map(({ kind, id }) => ({ roomId: room.id, kind: kind + '.created', payload: { id } }))
  })
  return { attachmentId: attachment.id, finalMessageId: 'ui-message-23', count: bodies.length }
}

async function assertViewport(page, label) {
  const metrics = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!element) return null
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
    }
    return { width: innerWidth, height: innerHeight, root: rect('[data-rooms-workspace]'),
      timeline: rect('.rooms-timeline-scroll'), composer: rect('.rooms-composer'),
      textarea: rect('.rooms-rich-input'), send: rect('.rooms-composer-send'),
      bodyScrollWidth: document.documentElement.scrollWidth }
  })
  assert(metrics.timeline && metrics.composer && metrics.send, label + ': missing chat surface')
  assert(metrics.root.scrollWidth <= metrics.root.clientWidth + 1, label + ': workspace has horizontal overflow')
  assert(metrics.timeline.scrollWidth <= metrics.timeline.clientWidth + 1, label + ': message timeline has horizontal overflow')
  assert(metrics.composer.scrollWidth <= metrics.composer.clientWidth + 1, label + ': input tools overflow')
  assert(metrics.send.x >= 0 && metrics.send.x + metrics.send.width <= metrics.width + 1, label + ': send is outside viewport')
  assert(metrics.send.y >= 0 && metrics.send.y + metrics.send.height <= metrics.height + 1, label + ': send is clipped vertically')
  return { label, ...metrics }
}

async function keyboardPopover(page, label, expectedControl) {
  const trigger = page.getByRole('button', { name: label, exact: true })
  await trigger.focus()
  assert.equal(await trigger.getAttribute('title'), label, 'Icon control must retain its tooltip')
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: label, exact: true })
  await dialog.waitFor()
  await dialog.getByRole(expectedControl.role, { name: expectedControl.name, exact: true }).waitFor()
  await page.waitForTimeout(100)
  assert(await dialog.evaluate((node) => node.contains(document.activeElement)), label + ': focus did not enter the menu')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  assert(await trigger.evaluate((node) => node === document.activeElement), label + ': focus did not return to trigger')
}

async function exerciseRoomsUi({ page, request, poll, capture, fixture, home, profile, workspaceRoot, resize }) {
  const drawer = page.getByRole('dialog', { name: 'Room details', exact: true })
  if (await drawer.count()) await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await resize(1360, 900)
  const setScale = async (scale) => page.evaluate(async (value) => {
    const { applyUiFontScale } = await import('/src/lib/apply-theme.ts')
    applyUiFontScale(value)
  }, scale)
  await setScale(1)
  await page.evaluate(async () => {
    const { useRoomPresentationPreferences } = await import('/src/components/rooms/room-presentation-preferences.ts')
    useRoomPresentationPreferences.getState().setPreference({ layout: 'thread', listWidth: 320, detailWidth: 400 })
  })
  const initial = await request(page, '/v1/rooms', 'POST', {
    clientRequestId: 'ui-room', name: NAME, description: 'A focused conversation for planning, development, and review.',
    collaborationMode: 'autonomous', repositories: [{ id: 'repo', displayPath: workspaceRoot, displayName: 'Architecture workspace' }]
  })
  const { room } = await request(page, '/v1/rooms/' + initial.room.id, 'PATCH', {
    clientRequestId: 'ui-member-names', expectedRevision: initial.room.revision,
    members: initial.room.members.map((member, index) => ({ ...member, displayName: [
      'Avery - architecture coordinator', 'Morgan - implementation and integration specialist', 'Quinn - verification reviewer'
    ][index] ?? member.displayName }))
  })
  const { room: empty } = await request(page, '/v1/rooms', 'POST', { clientRequestId: 'ui-empty', name: EMPTY_NAME })
  await request(page, '/v1/rooms', 'POST', { clientRequestId: 'ui-long-title',
    name: 'Research and documentation with a deliberately long room title for layout verification', description: 'Long room titles stay on a single line.' })
  await request(page, '/v1/rooms/' + room.id + '/messages', 'POST', {
    clientRequestId: 'ui-live-request', executionIntent: 'discussion',
    body: 'ROOM_UI_VISUAL: hold this isolated discussion while checking the layout.'
  })
  await poll(() => fixture.snapshot().uiCoordinationRequests > 0, 30000, 'held offline UI discussion')
  const seeded = await seedMessages({ page, request, home, profile, room })
  await page.getByRole('button', { name: new RegExp(NAME) }).click()
  await page.getByRole('heading', { name: NAME, exact: true }).waitFor()
  await page.locator('#room-message-' + seeded.finalMessageId).waitFor()
  const list = (await request(page, '/v1/rooms')).rooms.find((value) => value.id === room.id)
  assert.equal(list.latestMessage.id, seeded.finalMessageId)
  assert(list.runningCount > 0 && list.attentionCount > 0, 'Expected real running state and inert awaiting-review display fixture')
  await poll(() => page.getByRole('button', { name: NAME, exact: true }).locator('.rooms-conversation-preview')
    .innerText().then((text) => text.includes('The acceptance notes are attached.')), 15000, 'SSE updates the rendered list preview')
  const metrics = []
  const setTheme = async (theme) => page.evaluate(async (value) => {
    const { applyTheme } = await import('/src/lib/apply-theme.ts')
    applyTheme(value)
  }, theme)
  const settle = () => page.waitForTimeout(250)

  await keyboardPopover(page, 'More actions', { role: 'button', name: 'Room settings' })
  await keyboardPopover(page, 'Conversation options', { role: 'button', name: 'Refresh' })
  await keyboardPopover(page, 'Add context', { role: 'combobox', name: 'Reference task' })
  const searchButton = page.getByRole('button', { name: SEARCH_NAME, exact: true })
  await searchButton.click()
  const search = page.getByRole('textbox', { name: SEARCH_NAME, exact: true })
  await search.fill('bounded queue')
  await poll(() => page.locator('.rooms-message-row').count().then((value) => value === 1), 10000, 'search filters actual stored messages')
  await capture('ui-search-results')
  await search.press('Escape')
  await search.waitFor({ state: 'detached' })
  assert(await searchButton.evaluate((node) => node === document.activeElement), 'Search close must return focus')

  const input = page.locator('[data-rooms-workspace] > section > .rooms-composer').getByRole('textbox', { name: INPUT_NAME, exact: true })
  await input.fill('A short draft')
  const shortHeight = (await input.boundingBox()).height
  assert(shortHeight >= 39.5 && shortHeight <= 80, 'Short composer has an unexpected height: ' + shortHeight)
  await input.fill(Array.from({ length: 40 }, (_, index) => 'Draft line ' + index).join('\n'))
  await settle()
  const tallHeight = (await input.boundingBox()).height
  assert(tallHeight > shortHeight && tallHeight <= 201, 'Composer must grow but stop at 200px')
  await capture('ui-input-max-height')
  await input.fill('Review the proposal with ')
  await page.getByRole('button', { name: 'Mention member', exact: true }).click()
  await page.getByRole('listbox').waitFor()
  await input.press('ArrowDown')
  await input.press('Enter')
  await page.locator('.rooms-composer-chip').first().waitFor()
  await page.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('combobox', { name: 'Default repository', exact: true }).selectOption('repo')
  await page.getByRole('button', { name: 'Remove Architecture workspace', exact: true }).waitFor()
  const finalMessage = page.locator('#room-message-' + seeded.finalMessageId)
  await finalMessage.hover()
  await finalMessage.getByRole('button', { name: 'Reply', exact: true }).click()
  await drawer.getByRole('region', { name: 'Reply thread', exact: true }).locator('.rooms-composer-reply').waitFor()
  await capture('ui-input-context-and-reply')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await drawer.waitFor({ state: 'detached' })
  const mainChips = page.locator('[data-rooms-workspace] > section > .rooms-composer .rooms-composer-chip')
  while (await mainChips.count()) await mainChips.first().click()
  await input.fill('')

  await finalMessage.getByRole('button', { name: ATTACHMENT_NAME, exact: true }).click()
  const attachment = drawer.locator('[data-active-drawer-page="true"] .rooms-content-preview')
  await attachment.locator('pre').waitFor()
  assert((await attachment.locator('pre').innerText()).includes('Keep discussions bounded.'))
  await capture('ui-attachment-preview')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()

  const timeline = page.locator('.rooms-timeline-scroll')
  await timeline.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')) })
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).waitFor()
  const before = await timeline.evaluate((element) => element.scrollTop)
  await isolatedManagerCommit(home, profile, {
    requestId: 'ui-arrival-while-reading', checks: [{ kind: 'message', id: 'ui-arrival', expectedRevision: null }],
    puts: [{ kind: 'message', id: 'ui-arrival', roomId: room.id, value: {
      id: 'ui-arrival', roomId: room.id, messageSeq: 999, bodyRevision: 0, authorKind: 'member',
      authorMemberId: room.members[0].id, authorLabelSnapshot: room.members[0].displayName,
      body: 'New update: the review is ready. Your reading position is preserved.', status: 'final', mentionMemberIds: [],
      attachmentIds: [], createdAt: new Date().toISOString()
    } }], events: [{ roomId: room.id, kind: 'message.created', payload: { id: 'ui-arrival' } }]
  })
  await page.locator('#room-message-ui-arrival').waitFor({ state: 'attached' })
  assert(Math.abs((await timeline.evaluate((element) => element.scrollTop)) - before) < 2, 'New message moved the reading position')
  await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click()
  await poll(() => timeline.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight < 80),
    5000, 'return to latest messages')

  for (const [width, height] of [[1360, 900], [960, 780]]) {
    await resize(width, height)
    await settle()
    for (const theme of ['light', 'dark']) {
      await setTheme(theme)
      await settle()
      const label = `desktop-${width}x${height}-${theme}`
      metrics.push(await assertViewport(page, label))
      await capture('ui-' + label)
      await page.locator('#room-message-ui-message-20').scrollIntoViewIfNeeded()
      await capture('ui-' + label + '-code-table')
      await page.getByRole('button', { name: 'Back to latest messages', exact: true }).click()
    }
    const detailsButton = page.getByRole('button', { name: 'Room details', exact: true })
    await detailsButton.click()
    await drawer.getByRole('button', { name: 'Tasks', exact: true }).click()
    await drawer.getByText('Review the architecture acceptance checklist', { exact: false }).waitFor()
    const bounds = await drawer.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, 'Details overflow native window')
    await capture(`ui-desktop-${width}x${height}-details`)
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })
    assert(await detailsButton.evaluate((node) => node === document.activeElement), 'Details close must return focus')
  }

  await resize(1360, 900)
  await setTheme('light')
  for (const scale of [0.82, 1.25]) {
    await setScale(scale)
    await settle()
    const label = `desktop-1360x900-scale-${scale}`
    metrics.push(await assertViewport(page, label))
    await capture('ui-' + label)
    await keyboardPopover(page, 'More actions', { role: 'button', name: 'Room settings' })
  }
  await setScale(1)
  await page.getByRole('button', { name: new RegExp(EMPTY_NAME) }).click()
  await page.getByRole('heading', { name: EMPTY_NAME, exact: true }).waitFor()
  await capture('ui-empty-conversation')
  await page.getByRole('button', { name: new RegExp(NAME) }).click()
  await page.getByRole('heading', { name: NAME, exact: true }).waitFor()
  // Electron enforces a native 960px minimum. This is explicitly renderer emulation evidence.
  const emulation = await page.context().newCDPSession(page)
  await emulation.send('Emulation.setDeviceMetricsOverride', {
    width: 720, height: 780, deviceScaleFactor: 1, mobile: false, screenWidth: 720, screenHeight: 780
  })
  await settle()
  metrics.push(await assertViewport(page, 'renderer-emulated-720x780-light'))
  await capture('ui-renderer-emulated-720x780-light')
  await page.getByRole('button', { name: 'Rooms', exact: true }).click()
  await page.getByRole('button', { name: 'New room', exact: true }).waitFor()
  await capture('ui-renderer-emulated-720x780-list')
  await emulation.send('Emulation.clearDeviceMetricsOverride')
  await emulation.detach()
  fixture.releaseUi()
  return { roomId: room.id, emptyRoomId: empty.id, messages: seeded.count, metrics,
    fixture: 'Canonical messages/attachment and inert awaiting-review card; real offline held coordination request.',
    nativeWindowSizes: [[1360, 900], [960, 780]], baseScale: 1, additionalScales: [0.82, 1.25], rendererOnlyViewport: [720, 780],
    assertions: ['bounded list projection', 'three member identities and long names', 'Markdown code and table overflow',
      'keyboard popovers and focus return', 'search and focus return', '40-200px input growth',
      'mention/context/reply chips', 'real attachment preview', 'new messages preserve reading position',
      'return to latest', 'light/dark native windows', 'empty room', 'separate narrow renderer emulation'] }
}

module.exports = { exerciseRoomsUi }
