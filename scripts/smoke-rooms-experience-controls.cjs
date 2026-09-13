'use strict'
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')
const { createServer } = require('node:http')

const MARK = 'ROOM_EXPERIENCE_SMOKE'
const NAME = 'Rooms experience desktop smoke'
const INPUT = 'Discuss a question or describe the work to do…'
const textParts = (messages) => messages.flatMap((message) => typeof message.content === 'string'
  ? [message.content] : (message.content ?? []).flatMap((part) => part.text ? [part.text] : []))
function jsonLines(messages) {
  return textParts(messages).flatMap((text) => text.split('\n')).flatMap((line) => {
    try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : [] } catch { return [] }
  })
}
function roomExperienceModelFixture() {
  const state = { experienceRequests: 0, experienceTriages: 0, experienceVotes: 0, experiencePublications: 0 }
  return { snapshot: () => ({ ...state }), respond({ body, prompt, called, tool }) {
    if (!JSON.stringify(body.messages).includes(MARK)) return null
    if (JSON.stringify(body.messages).includes('Decide whether this member has a concrete new contribution')) {
      state.experienceTriages++
      return { content: JSON.stringify({ action: 'skip', reason: 'The explicitly addressed member supplies the useful contribution.' }) }
    }
    if (!prompt.includes('Participate as this Kun room member')) return null
    state.experienceRequests++
    const values = jsonLines(body.messages)
    const invitation = values.findLast((value) => value.pollId && Array.isArray(value.options) && value.options[0]?.id)
    const context = values.findLast((value) => value.currentUserRequest && value.member)
    if (invitation && !called('vote_room_poll')) {
      assert(body.tools?.some((entry) => entry.function?.name === 'vote_room_poll'), 'Invited native run did not advertise vote_room_poll')
      state.experienceVotes++
      return { content: '', toolCalls: tool('vote_room_poll', { pollId: invitation.pollId, optionIds: [invitation.options[0].id] }) }
    }
    if (!invitation && !called('read_room_updates')) return { content: '', toolCalls: tool('read_room_updates', {}) }
    if (called('send_room_message')) return { content: 'The scoped contribution is complete.' }
    state.experiencePublications++
    const source = String(context?.currentUserRequest?.body ?? 'the current question').slice(0, 160)
    return { content: '', toolCalls: tool('send_room_message', { body: invitation
      ? `${MARK}: ${context?.member?.id ?? 'member'} voted for ${invitation.options[0].id}; no execution was authorized.`
      : `${MARK}: ${context?.member?.id ?? 'member'} inspected the question read-only.\n\nSource: ${source}\n\nA concrete finding: retain stable message and turn identities.` }) }
  } }
}
async function managerCommit(home, profile, input) {
  const manager = JSON.parse(await readFile(join(home, '.kun', 'control', 'manager.json'), 'utf8'))
  assert.equal(resolve(manager.dataDir), resolve(profile), 'Experience fixture must use its disposable Manager profile')
  const url = new URL(manager.baseUrl)
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  const response = await fetch(new URL('/v1/data/room/commit', url), { method: 'POST',
    headers: { authorization: `Bearer ${manager.managerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ input }), signal: AbortSignal.timeout(15000) })
  assert(response.ok, `Cannot seed isolated experience data: ${response.status} ${await response.text()}`)
}
async function monitor(page) {
  await page.evaluate(async () => {
    const { rendererRuntimeClient: client } = await import('/src/agent/runtime-client.ts')
    const original = client.runtimeRequest.bind(client)
    globalThis.__experienceTraffic = []
    client.runtimeRequest = (path, method = 'GET', ...args) => {
      globalThis.__experienceTraffic.push({ path, method })
      return original(path, method, ...args)
    }
    globalThis.__restoreExperienceTraffic = () => { client.runtimeRequest = original }
  })
}
const traffic = (page) => page.evaluate(() => globalThis.__experienceTraffic ?? [])
const mainPanel = (page) => page.locator('[data-rooms-workspace] > section').first()
const mainComposer = (page) => mainPanel(page).locator(':scope > .rooms-composer')
const drawer = (page) => page.getByRole('dialog', { name: 'Room details', exact: true })
const activeDrawer = (page) => drawer(page).locator('[data-active-drawer-page="true"]')
const messageRow = (page, id) => mainPanel(page).locator('#room-message-' + id)
async function closeDrawer(page) {
  if (await drawer(page).count()) await drawer(page).getByRole('button', { name: 'Close', exact: true }).click()
}
async function chooseRoom(page, name) {
  await closeDrawer(page)
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('heading', { name, exact: true }).waitFor()
}
async function bodyIn(editor) { return (await editor.innerText()).trim() }
async function sendFrom(composer, body, poll) {
  await composer.getByLabel('Automatic intent', { exact: true }).selectOption('discussion')
  await composer.getByRole('textbox', { name: INPUT, exact: true }).fill(body)
  await composer.getByRole('button', { name: 'Send', exact: true }).click()
  await poll(() => bodyIn(composer.getByRole('textbox', { name: INPUT, exact: true })).then((value) => value === ''), 10000, 'composer send acknowledged')
}
async function installNotificationCounter(application) {
  await application.evaluate(({ Notification }) => {
    const original = Notification.prototype.show
    globalThis.__experienceNotifications = []
    Notification.prototype.show = function () { globalThis.__experienceNotifications.push({ title: this.title, body: this.body }) }
    globalThis.__restoreExperienceNotifications = () => { Notification.prototype.show = original }
  })
}
async function loopbackSentinel() {
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end('<title>private sentinel must never be fetched</title>') })
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  return { url: `http://127.0.0.1:${server.address().port}/private-metadata`, count: () => requests,
    close: () => new Promise((done) => { server.close(done); server.closeAllConnections?.() }) }
}
async function experienceImage(page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 320
    const context = canvas.getContext('2d')
    const gradient = context.createLinearGradient(0, 0, 512, 320)
    gradient.addColorStop(0, '#355d97'); gradient.addColorStop(1, '#59b7a5')
    context.fillStyle = gradient; context.fillRect(0, 0, 512, 320)
    context.fillStyle = '#ffe6a1'; context.beginPath(); context.arc(390, 90, 50, 0, Math.PI * 2); context.fill()
    context.fillStyle = 'white'; context.font = 'bold 30px sans-serif'; context.fillText('ROOM EXPERIENCE', 28, 190)
    context.font = '18px sans-serif'; context.fillText('Isolated image and avatar fixture', 28, 230)
    return canvas.toDataURL('image/png').split(',')[1]
  })
}

async function exerciseRoomsExperience({ page, request, poll, capture, fixture, home, profile, workspaceRoot, resize, application }) {
  await closeDrawer(page); await resize(1360, 900)
  const { room: initial } = await request(page, '/v1/rooms', 'POST', { clientRequestId: 'experience-room', name: NAME,
    collaborationMode: 'peer', repositories: [{ id: 'repo', displayPath: workspaceRoot, displayName: 'Experience source' }] })
  let room = initial
  const base = '/v1/rooms/' + room.id
  await chooseRoom(page, NAME)
  await monitor(page); await installNotificationCounter(application)
  const sentinel = await loopbackSentinel()
  const screenshots = [], assertions = [], modelCounts = []
  const shot = async (name) => { await capture('experience-' + name); screenshots.push(name) }
  const topics = async () => (await request(page, base + '/topics')).topics
  const messages = async () => (await request(page, base + '/messages?limit=200')).messages
  const requests = async () => (await request(page, base + '/requests?limit=200')).requests
  const counts = () => {
    const value = fixture.snapshot()
    return { responses: value.experienceRequests ?? 0, triages: value.experienceTriages ?? 0,
      votes: value.experienceVotes ?? 0, publications: value.experiencePublications ?? 0 }
  }
  const idle = () => poll(async () => !(await requests()).some((entry) => ['pending', 'running', 'stopping', 'recovery_required'].includes(entry.status)) &&
    (await topics()).every((topic) => topic.status === 'idle' && topic.pendingCount === 0), 30000, 'experience topics settle')
  const quiet = async (label, action, allowed = [], expectedFixtureRequests = 0) => {
    let stableSince = 0, previousModels = JSON.stringify(fixture.snapshot())
    await poll(async () => {
      const states = await Promise.all(room.members.filter((member) => member.participantAgentId)
        .map((member) => request(page, '/v1/agents/' + member.participantAgentId + '/memory-work')))
      const models = JSON.stringify(fixture.snapshot())
      if (models !== previousModels || states.some((state) => state.jobs.some((job) => ['pending', 'running'].includes(job.status)))) stableSince = 0
      else stableSince ||= Date.now()
      previousModels = models
      return stableSince > 0 && Date.now() - stableSince >= 1800
    }, 30000, 'prior memory work settles before presentation assertions')
    const before = counts(), allModelsBefore = fixture.snapshot(), start = (await traffic(page)).length, requestCount = (await requests()).length
    const budget = (await topics()).map(({ rootRequestId, responseCount, triageCount, generation }) => ({ rootRequestId, responseCount, triageCount, generation }))
    await action(); await page.waitForTimeout(300)
    assert.deepEqual(counts(), before, `${label}: presentation invoked a model`)
    assert.deepEqual(fixture.snapshot(), allModelsBefore, `${label}: presentation invoked another model route`)
    assert.equal((await requests()).length, requestCount + expectedFixtureRequests, `${label}: presentation created an unintended room request`)
    assert.deepEqual((await topics()).map(({ rootRequestId, responseCount, triageCount, generation }) => ({ rootRequestId, responseCount, triageCount, generation })), budget, `${label}: discussion budget changed`)
    const writes = (await traffic(page)).slice(start).filter((item) => item.method !== 'GET' && !item.path.endsWith('/read'))
    assert(writes.every((item) => allowed.some((pattern) => pattern.test(item.path))), `${label}: unintended writes ${JSON.stringify(writes)}`)
    modelCounts.push({ label, ...before }); assertions.push(label)
  }
  const seed = async (id, puts, events = puts.map((put) => ({ roomId: room.id, kind: put.kind + '.created', payload: { id: put.id } }))) =>
    managerCommit(home, profile, { requestId: id, checks: puts.map((put) => ({ kind: put.kind, id: put.id, expectedRevision: null })), puts, events })
  const staticMessage = (id, body, extra = {}) => ({ kind: 'message', id, roomId: room.id, value: {
    id, roomId: room.id, body, messageSeq: 1, bodyRevision: 0, authorKind: 'member', authorMemberId: room.members[0].id,
    authorLabelSnapshot: room.members[0].displayName, mentionMemberIds: [], attachmentIds: [], status: 'final',
    createdAt: new Date().toISOString(), ...extra } })
  try {
    // Poll creation, a reaction, and the user's own ballot are all presentation-only operations.
    let publicPoll
    await quiet('poll creation has no request or discussion budget', async () => {
      await mainComposer(page).getByRole('button', { name: 'Create poll', exact: true }).click()
      const creator = page.getByRole('group', { name: 'Create poll', exact: true })
      await creator.getByLabel('Poll question', { exact: true }).fill(MARK + ': choose a readable API')
      await creator.getByLabel('Option 1', { exact: true }).fill('Small explicit API')
      await creator.getByLabel('Option 2', { exact: true }).fill('Large implicit API')
      await creator.getByRole('button', { name: 'Publish poll', exact: true }).click()
      await poll(async () => { publicPoll = (await messages()).find((message) => message.presentationKind === 'poll'); return Boolean(publicPoll) }, 10000, 'poll message persisted')
      await messageRow(page, publicPoll.id).locator('.rooms-poll-card').waitFor()
      await shot('poll-created')
    }, [/\/polls$/])
    const pollCard = messageRow(page, publicPoll.id).locator('.rooms-poll-card')
    await quiet('local vote and reaction do not wake members', async () => {
      await pollCard.getByLabel('Small explicit API').check()
      await pollCard.getByRole('button', { name: 'Vote', exact: true }).click()
      await poll(() => request(page, `${base}/polls/${publicPoll.pollId}`).then((value) => value.ballots['local-user']?.optionIds[0] === 'option-1'), 5000, 'local ballot persisted')
      const row = messageRow(page, publicPoll.id)
      await row.getByRole('button', { name: 'Add reaction', exact: true }).click()
      await page.getByRole('dialog', { name: 'Add reaction', exact: true }).getByRole('button', { name: '👍', exact: true }).click()
      await poll(() => request(page, `${base}/messages/${publicPoll.id}/interactions`).then((value) => value.reactions.reactions.some((entry) => entry.emoji === '👍' && entry.count === 1)), 5000, 'reaction persisted')
      await shot('poll-local-ballot-and-reaction')
    }, [/\/polls\/[^/]+\/vote$/, /\/messages\/[^/]+\/reactions$/])
    await pollCard.getByRole('button', { name: 'Invite members to vote', exact: true }).click()
    const invite = page.getByRole('dialog', { name: 'Invite members to vote', exact: true })
    await invite.getByLabel(room.members.find((member) => member.id === 'developer').displayName, { exact: true }).check()
    await invite.getByRole('button', { name: 'Invite members to vote', exact: true }).click()
    await poll(() => request(page, `${base}/polls/${publicPoll.pollId}`).then((value) => Boolean(value.ballots['member-developer'])), 30000, 'native invited member ballot')
    await idle()
    const voted = await request(page, `${base}/polls/${publicPoll.pollId}`)
    assert(voted.ballots['member-developer'].threadId && voted.ballots['member-developer'].turnId, 'Member ballot lacks exact native identity')
    assert.equal(counts().votes, 1); assert.equal((await requests()).length, 1)
    assertions.push('explicit invitation uses native vote_room_poll then public reply')
    await shot('poll-agent-ballot')

    // A real member response owns a stable run. A nested reply and two drafts stay in one root.
    const rootBody = MARK + ': inspect reply identity and keep the source checkout unchanged.'
    await sendFrom(mainComposer(page), rootBody, poll); await idle()
    let rootMessage, firstResponse
    await poll(async () => {
      const list = await messages(); rootMessage = list.find((message) => message.authorKind === 'user' && message.body === rootBody)
      firstResponse = list.find((message) => message.authorKind === 'member' && message.sourceRequestId === rootMessage?.sourceRequestId)
      return Boolean(firstResponse?.originRunId)
    }, 30000, 'native root response')
    const replyRows = Array.from({ length: 22 }, (_, index) => staticMessage('experience-reply-' + index,
      `Static historical reply ${index + 1}. ` + 'A preserved finding about this exact reply branch. '.repeat(5), {
        replyToMessageId: rootMessage.id, displayThreadRootId: rootMessage.id, rootRequestId: rootMessage.rootRequestId
      }))
    await seed('experience-reply-history', replyRows)
    await mainComposer(page).getByRole('textbox', { name: INPUT, exact: true }).fill('MAIN_DRAFT_MUST_SURVIVE')
    await messageRow(page, rootMessage.id).getByRole('button', { name: 'Reply', exact: true }).click()
    const replies = activeDrawer(page).getByRole('region', { name: 'Reply thread', exact: true })
    await replies.locator('.rooms-reply-root').waitFor()
    assert.equal(await replies.getAttribute('data-display-thread-root-id'), rootMessage.id)
    const target = replies.locator('[data-room-message-id="experience-reply-5"]')
    await target.scrollIntoViewIfNeeded(); await target.getByRole('button', { name: 'Reply', exact: true }).click()
    const nestedBody = MARK + ': nested response to reply six'
    await sendFrom(replies.locator('.rooms-composer'), nestedBody, poll); await idle()
    const nested = (await messages()).find((message) => message.body === nestedBody)
    assert(nested); assert.equal(nested.replyToMessageId, 'experience-reply-5')
    assert.equal(nested.displayThreadRootId, rootMessage.id); assert.equal(nested.rootRequestId, rootMessage.rootRequestId)
    const nestedPage = await request(page, `${base}/replies/${nested.id}?limit=100`)
    assert.equal(nestedPage.root.id, rootMessage.id)
    assert(nestedPage.messages.some((message) => message.id === nested.id))
    await replies.locator('.rooms-composer').getByRole('textbox', { name: INPUT, exact: true }).fill('REPLY_DRAFT_MUST_SURVIVE')
    const oldResponse = replies.locator(`[data-room-message-id="${firstResponse.id}"]`)
    await oldResponse.scrollIntoViewIfNeeded()
    const replyScroll = await replies.locator('.rooms-reply-scroll').evaluate((element) => element.scrollTop)
    await quiet('reply to run and back preserves scope, drafts and reading position', async () => {
      await oldResponse.getByRole('button', { name: 'View this run', exact: true }).click()
      const run = activeDrawer(page).getByRole('region', { name: 'Run details', exact: true })
      await run.locator('.rooms-run-header').waitFor()
      assert.equal(await run.getAttribute('data-run-id'), firstResponse.originRunId)
      await run.getByLabel('Filter run process', { exact: true }).selectOption('tools')
      await run.getByLabel('Search loaded process records', { exact: true }).fill('read_room_updates')
      const tool = run.locator('[data-run-tool-call-id]').first(); await tool.waitFor()
      const callId = await tool.getAttribute('data-run-tool-call-id')
      const pair = await request(page, `${base}/runs/${firstResponse.originRunId}/items?call_id=${encodeURIComponent(callId)}&limit=4`)
      assert(pair.items.some((item) => item.kind === 'tool_call')); assert(pair.items.some((item) => item.kind === 'tool_result'))
      assert(pair.items.every((item) => item.callId === callId))
      await shot('run-tool-pair')
      await drawer(page).getByRole('button', { name: 'Back to previous view', exact: true }).click()
      await replies.waitFor()
      assert(Math.abs(await replies.locator('.rooms-reply-scroll').evaluate((element) => element.scrollTop) - replyScroll) < 3)
      assert.equal(await bodyIn(replies.getByRole('textbox', { name: INPUT, exact: true })), 'REPLY_DRAFT_MUST_SURVIVE')
      assert.equal(await bodyIn(mainComposer(page).getByRole('textbox', { name: INPUT, exact: true })), 'MAIN_DRAFT_MUST_SURVIVE')
      await shot('nested-reply-drafts-restored')
    })
    await closeDrawer(page)

    // Real attachment and project content are previewed without dispatching a model or editing sources.
    const imageData = await experienceImage(page)
    const modelsBeforeUpload = fixture.snapshot(), requestsBeforeUpload = (await requests()).length
    // Use the same provider -> preload -> main image preparation -> Runtime path as the composer.
    // Upload-time display projections must be created by production code, never fixture-injected.
    const attachment = await page.evaluate(async (dataBase64) => {
      const { uploadRuntimeAttachment } = await import('/src/lib/runtime-attachment.ts')
      return uploadRuntimeAttachment({ name: 'experience-image.png', mimeType: 'image/png', dataBase64 })
    }, imageData)
    assert.equal(attachment.kind, 'image')
    assert.deepEqual(fixture.snapshot(), modelsBeforeUpload, 'Image upload unexpectedly called a model')
    assert.equal((await requests()).length, requestsBeforeUpload, 'Image upload unexpectedly created a discussion request')
    const board = await request(page, '/v1/project-boards/snapshot?workspace=' + encodeURIComponent(workspaceRoot))
    const boardChanged = await request(page, '/v1/project-boards/cards', 'POST', { workspace: workspaceRoot, expectedRevision: board.revision,
      title: MARK + ' board reference', description: 'Presentation metadata only.', status: 'pending' })
    const boardCard = boardChanged.cards.find((card) => card.title === MARK + ' board reference')
    assert(boardCard)
    await seed('experience-content-history', [
      staticMessage('experience-image', 'An image attachment is available for read-only inspection.', { attachmentIds: [attachment.id] }),
      staticMessage('experience-file', 'The original source file is a reference, not new execution authority.', { sourceRequestId: rootMessage.sourceRequestId, references: [{ kind: 'repository_file', repositoryId: 'repo', relativePath: 'baseline.txt', titleSnapshot: 'baseline.txt' }] }),
      staticMessage('experience-board', 'A project card reference.', { sourceRequestId: rootMessage.sourceRequestId, references: [{ kind: 'board_card', repositoryId: 'repo', cardId: boardCard.id, titleSnapshot: boardCard.title }] }),
      staticMessage('experience-private-link', 'Blocked link example: ' + sentinel.url)
    ])
    const sourceBefore = await readFile(join(workspaceRoot, 'baseline.txt'), 'utf8')
    await quiet('thumbnail lightbox and file/board previews remain read-only', async () => {
      const picture = messageRow(page, 'experience-image'); await picture.scrollIntoViewIfNeeded()
      await picture.locator('.rooms-content-thumbnail img').waitFor()
      await picture.getByRole('button', { name: 'experience-image.png', exact: true }).click()
      const lightbox = page.getByRole('dialog', { name: 'experience-image.png', exact: true }); await lightbox.locator('img').waitFor()
      await shot('image-lightbox'); await lightbox.getByRole('button', { name: 'Close', exact: true }).click()
      await messageRow(page, 'experience-file').getByRole('button', { name: 'baseline.txt', exact: true }).click()
      await activeDrawer(page).locator('.rooms-content-document pre').waitFor()
      assert.equal((await activeDrawer(page).locator('.rooms-content-document pre').innerText()).trim(), sourceBefore.trim())
      await shot('source-preview'); await closeDrawer(page)
      await messageRow(page, 'experience-board').getByRole('button', { name: boardCard.title, exact: true }).click()
      await activeDrawer(page).getByRole('button', { name: 'Open in Board', exact: true }).waitFor()
      await shot('board-preview'); await closeDrawer(page)
      assert.equal(await readFile(join(workspaceRoot, 'baseline.txt'), 'utf8'), sourceBefore)
    })
    await quiet('loopback link preview is blocked and disabling previews stops further requests', async () => {
      const link = messageRow(page, 'experience-private-link'); await link.scrollIntoViewIfNeeded()
      await link.getByText('Link preview unavailable', { exact: true }).waitFor()
      assert.equal(sentinel.count(), 0, 'Link preview reached the private loopback sentinel')
      await page.getByRole('button', { name: 'Conversation appearance', exact: true }).click()
      const appearance = page.getByRole('dialog', { name: 'Conversation appearance', exact: true })
      await appearance.getByLabel('Automatically load link previews', { exact: true }).uncheck(); await page.keyboard.press('Escape')
      const checkpoint = (await traffic(page)).length
      await seed('experience-disabled-link', [staticMessage('experience-private-link-disabled', 'Preview disabled: ' + sentinel.url + '?second=1')])
      await messageRow(page, 'experience-private-link-disabled').scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
      assert(!(await traffic(page)).slice(checkpoint).some((entry) => entry.path.includes('/link-preview')))
      assert.equal(sentinel.count(), 0)
      await shot('link-preview-disabled')
    })

    await quiet('avatar selection and upload change presentation only', async () => {
      const agentId = room.members[0].participantAgentId
      assert(agentId, 'Room member must reference a persistent Agent')
      const settings = async () => {
        await closeDrawer(page)
        await page.getByRole('button', { name: 'Room details', exact: true }).click()
        await drawer(page).getByRole('button', { name: 'Members', exact: true }).click()
        await activeDrawer(page).locator('.rooms-member-card').first().getByRole('button', { name: 'Agent profile and memory', exact: true }).click()
        await activeDrawer(page).getByRole('button', { name: 'Choose avatar', exact: true }).waitFor()
        return activeDrawer(page)
      }
      let dialog = await settings()
      await dialog.getByRole('button', { name: 'Choose avatar', exact: true }).click()
      const choice = page.getByRole('dialog', { name: 'Choose avatar', exact: true }).locator('.rooms-avatar-picker-option').nth(5)
      const avatarId = await choice.locator('[data-avatar-id]').getAttribute('data-avatar-id')
      await choice.click()
      await dialog.getByRole('button', { name: 'Choose avatar', exact: true }).click()
      assert.equal(await page.getByRole('dialog', { name: 'Choose avatar', exact: true }).locator('[aria-pressed="true"]').count(), 1)
      await shot('avatar-selected-marker'); await page.keyboard.press('Escape')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await poll(async () => (await request(page, '/v1/agents/' + agentId)).agent.avatar?.id === avatarId, 10000, 'global avatar selected')
      await closeDrawer(page)
      room = (await request(page, base)).room
      assert.deepEqual(room.members[0].avatar, { kind: 'builtin', id: avatarId })
      dialog = await settings()
      await dialog.locator('.rooms-avatar-picker-field input[type="file"]').setInputFiles({ name: 'experience-avatar.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') })
      await dialog.locator('.rooms-avatar-picker-field .rooms-avatar img').waitFor()
      await shot('avatar-upload-preview')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await poll(async () => (await request(page, '/v1/agents/' + agentId)).agent.avatar?.kind === 'uploaded', 10000, 'global uploaded avatar saved')
      await closeDrawer(page)
      room = (await request(page, base)).room
      assert.equal(room.members[0].avatar.kind, 'uploaded')
    }, [/\/v1\/rooms\/avatars$/, /^\/v1\/agents\/[^/]+$/])

    // Preferences and filtered lists update from SSE without changing execution or reviving muted notices.
    const { room: other } = await request(page, '/v1/rooms', 'POST', { clientRequestId: 'experience-other', name: 'Experience other room' })
    await quiet('mute/unmute preserves authorization and does not backfill notifications', async () => {
      const originalRevision = (await request(page, base)).room.revision
      await page.getByRole('button', { name: 'Room notifications', exact: true }).click()
      await page.getByRole('button', { name: 'Mute until I turn it back on', exact: true }).click(); await page.keyboard.press('Escape')
      await poll(() => request(page, base + '/preferences').then((value) => value.preference.mode === 'muted'), 5000, 'mute preference saved')
      assert.equal((await request(page, base)).room.revision, originalRevision)
      await chooseRoom(page, other.name)
      await seed('experience-muted-notice', [{ kind: 'request', id: 'experience-muted-request', roomId: room.id, value: {
        id: 'experience-muted-request', roomId: room.id, status: 'needs_input', sourceMessageId: rootMessage.id,
        threadId: 'experience-inert-notice-thread', roomSnapshot: room,
        message: { clientRequestId: 'inert-notice', body: 'Muted fixture needs input', executionIntent: 'discussion', mentionMemberIds: [], attachmentIds: [] },
        clarification: 'This inert notification must remain suppressed.'
      } }], [{ roomId: room.id, kind: 'request.updated', payload: { id: 'experience-muted-request' } }])
      const notificationKey = 'request:experience-muted-request:needs_input:0:0'
      await poll(() => page.evaluate((key) => Object.keys(localStorage).filter((name) => name.startsWith('kun.rooms.notificationQueue.v1.'))
        .some((name) => JSON.parse(localStorage.getItem(name)).notified.includes(key)), notificationKey), 10000, 'muted notice was consumed durably')
      const count = await application.evaluate(() => globalThis.__experienceNotifications.length)
      await chooseRoom(page, NAME)
      await page.getByRole('button', { name: 'Room notifications muted', exact: true }).click()
      await page.getByRole('button', { name: 'Unmute notifications', exact: true }).click(); await page.keyboard.press('Escape')
      await poll(() => request(page, base + '/preferences').then((value) => value.preference.mode === 'all' && Boolean(value.preference.silencedThrough)), 5000, 'unmute watermark saved')
      await page.waitForTimeout(1300)
      assert.equal(await application.evaluate(() => globalThis.__experienceNotifications.length), count)
      await shot('notifications-unmuted')
    }, [/\/preferences$/], 1)
    await chooseRoom(page, other.name)
    await page.getByLabel('Filter conversations', { exact: true }).selectOption('unread')
    await seed('experience-unread-arrival', [staticMessage('experience-new-unread', 'An unread arrival while a different room is selected.')])
    await poll(() => page.getByRole('button', { name: NAME, exact: true }).count().then((value) => value === 1), 10000, 'filtered unread list receives a new room through SSE')
    await shot('unread-filter-live')
    await page.getByLabel('Filter conversations', { exact: true }).selectOption('attention')
    await page.getByRole('button', { name: NAME, exact: true }).waitFor()
    await page.getByLabel('Filter conversations', { exact: true }).selectOption('all')
    await page.getByLabel('Filter by repository', { exact: true }).selectOption(room.repositories.find((repository) => repository.id === 'repo').canonicalRoot)
    assert.equal(await page.getByRole('button', { name: other.name, exact: true }).count(), 0)
    await page.getByLabel('Filter by repository', { exact: true }).selectOption('')
    await chooseRoom(page, NAME)
    assertions.push('unread/attention/repository filters keep live room metadata')
    await quiet('unified message search navigates to the precise source', async () => {
      await page.locator('.rooms-list-search input').fill('inspect reply identity')
      const search = page.getByRole('region', { name: 'Search rooms, members, messages and tasks', exact: true })
      await search.waitFor()
      await search.getByRole('button').filter({ hasText: rootBody }).first().click()
      await messageRow(page, rootMessage.id).waitFor()
      await shot('unified-search-jump')
    })


    await quiet('layout resize and run summary do not dispatch work', async () => {
      await page.getByRole('button', { name: 'Conversation appearance', exact: true }).click()
      const appearance = page.getByRole('dialog', { name: 'Conversation appearance', exact: true })
      // The wrapping label contains the select's option text; exact getByLabel('Message layout') cannot match it.
      // Scope the semantic combobox to this dialog and its observed bubble option instead.
      const layout = appearance.getByRole('combobox').filter({ has: page.locator('option[value="bubble"]') })
      assert.equal(await layout.count(), 1, 'Expected one message-layout combobox in the appearance menu')
      await layout.selectOption('bubble')
      await poll(() => page.locator('[data-rooms-workspace]').getAttribute('data-chat-layout').then((value) => value === 'bubble'), 5000, 'bubble layout preference applied')
      await page.keyboard.press('Escape')
      await messageRow(page, rootMessage.id).scrollIntoViewIfNeeded()
      const bubble = await messageRow(page, rootMessage.id).locator('.rooms-message-bubble').boundingBox()
      const row = await messageRow(page, rootMessage.id).boundingBox()
      assert(bubble.x + bubble.width >= row.x + row.width - 80, 'User bubble is not aligned to the right')
      const splitter = page.getByRole('separator', { name: 'Resize conversation list', exact: true })
      const old = Number(await splitter.getAttribute('aria-valuenow'))
      await splitter.focus(); await splitter.press('ArrowRight')
      assert.equal(Number(await splitter.getAttribute('aria-valuenow')), old + 8)
      await page.getByRole('button', { name: 'Room details', exact: true }).click()
      await drawer(page).getByRole('button', { name: 'Room overview', exact: true }).click()
      await activeDrawer(page).getByRole('region', { name: 'Room activity and usage', exact: true }).waitFor()
      const summary = await request(page, base + '/run-summary')
      assert(summary.runs > 0 && summary.responses > 0 && summary.triages > 0)
      const detailHandle = drawer(page).getByRole('separator', { name: 'Resize room details', exact: true })
      const detailWidth = Number(await detailHandle.getAttribute('aria-valuenow'))
      await detailHandle.focus(); await detailHandle.press('ArrowLeft')
      assert.equal(Number(await detailHandle.getAttribute('aria-valuenow')), detailWidth + 8)
      await shot('bubble-layout-and-summary')
      for (const theme of ['dark', 'light']) {
        await page.evaluate(async (value) => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme(value) }, theme)
        await resize(960, 780); await page.waitForTimeout(200)
        const bounds = await drawer(page).boundingBox(), width = await page.evaluate(() => innerWidth)
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
        await shot('narrow-' + theme)
      }
      await resize(1360, 900); await closeDrawer(page)
    })
    assert.equal((await request(page, base + '/tasks')).tasks.length, 0)
    assert.equal(sentinel.count(), 0)
    const result = { roomId: room.id, pollId: publicPoll.pollId, rootMessageId: rootMessage.id, nestedMessageId: nested.id,
      exactRunId: firstResponse.originRunId, avatar: room.members[0].avatar, boardCardId: boardCard.id,
      privatePreviewRequests: sentinel.count(), models: counts(), modelCounts, screenshots, assertions,
      staticFixture: 'Read-only history and inert needs-input notice were seeded through the isolated Manager; votes, replies, avatars and native turns use production HTTP/IPC.' }
    return result
  } finally {
    await sentinel.close()
    await page.evaluate(() => globalThis.__restoreExperienceTraffic?.()).catch(() => undefined)
    await application.evaluate(() => globalThis.__restoreExperienceNotifications?.()).catch(() => undefined)
  }
}
module.exports = { roomExperienceModelFixture, exerciseRoomsExperience }
