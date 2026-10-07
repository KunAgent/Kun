'use strict'
const assert = require('node:assert/strict')
const { viewRunningRoomRun, exerciseFinishedRoomRuns } = require('./smoke-rooms-run-inspector.cjs')
const { roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')
const NAME = 'Peer discussion desktop smoke'
const PROMPT = 'ROOM_PEER_SMOKE_FIRST: discuss a safe queue design without using external tools or creating tasks.'
const CONTINUATION = 'ROOM_PEER_SMOKE_CONTINUE: continue this same discussion with a short new conclusion.'
const NEW_TOPIC = 'ROOM_PEER_SMOKE_NEW: start a separate read-only discussion about testing the queue.'
const CONTINUED_BODY = 'Use a bounded queue and explicit backpressure; no implementation was started.'
const NEW_BODY = 'Test the queue with a bounded fake clock and no file changes.'

function roomPeerModelFixture() {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const state = { peerResponseRequests: 0, peerTriageRequests: 0, peerSubmissions: 0 }
  let first = true
  return {
    release,
    snapshot: () => ({ ...state }),
    respond: async ({ body, prompt, called, tool }) => {
      const all = JSON.stringify(body.messages)
      if (all.includes('Decide whether this member has a concrete new contribution')) {
        state.peerTriageRequests++
        return { content: JSON.stringify({ action: 'skip', reason: 'The supplied question already has a relevant responder.' }) }
      }
      if (!prompt.includes('Participate as this Kun room member')) return null
      state.peerResponseRequests++
      assert(body.tools?.some((entry) => entry.function?.name === 'send_room_message'), 'Peer response did not advertise its scoped publication tool')
      if (first) { first = false; await gate }
      if (called('send_room_message')) return { content: 'The complete contribution has been staged.' }
      state.peerSubmissions++
      const message = prompt.includes('ROOM_PEER_SMOKE_NEW') ? NEW_BODY :
        prompt.includes('ROOM_PEER_SMOKE_CONTINUE') ? CONTINUED_BODY :
          'A bounded queue prevents unbounded growth; no execution tasks are needed.'
      return { content: '', toolCalls: tool('send_room_message', { body: message }) }
    }
  }
}

async function exercisePeerRoom({ page, request, poll, capture, fixture, resize, openConversation }) {
  const existing = page.getByRole('region', { name: 'Room details', exact: true })
  if (await existing.count()) await existing.getByRole('button', { name: 'Close', exact: true }).click()
  await resize(1360, 900)
  // The Code picker starts a group with the default team; groups start in peer collaboration.
  const personal = (await request(page, '/v1/agents/chat-entry')).agentId
  const team = (await request(page, '/v1/agents?limit=100')).agents.filter((agent) =>
    agent.id.startsWith('agent-default-') && agent.id !== personal && !agent.archivedAt)
  assert.equal(team.length, 5, 'The default team supplies five persistent Agents')
  const previous = (await roomWorkbenchSnapshot(page)).conversationRoomId
  await page.locator('.sidebar-agent-chats').getByRole('button', { name: 'New conversation', exact: true }).click()
  const picker = page.locator('.direct-new-chat')
  await picker.getByRole('button', { name: 'Group chat', exact: true }).click()
  for (const agent of team) await picker.locator('.direct-agent-choices > button').filter({ has: page.locator('strong', { hasText: new RegExp('^' + agent.name + '$') }) }).click()
  await picker.getByRole('button', { name: 'Start group (5 Agents)', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  let roomId
  await poll(async () => { roomId = (await roomWorkbenchSnapshot(page)).conversationRoomId; return Boolean(roomId && roomId !== previous) }, 15000, 'new group opens in Code')
  await page.locator(`[data-room-surface="agent-chat"][data-room-id="${roomId}"]`).waitFor()
  const header = page.locator('.rooms-header')
  assert.equal(await header.getByLabel('Collaboration', { exact: true }).inputValue(), 'peer')
  await header.getByRole('button', { name: 'Rename', exact: true }).click()
  await header.getByRole('textbox', { name: 'Rename', exact: true }).fill(NAME)
  await header.getByRole('textbox', { name: 'Rename', exact: true }).press('Enter')
  await page.getByRole('heading', { name: new RegExp('^' + NAME) }).waitFor()
  const room = (await request(page, '/v1/rooms/' + roomId)).room
  assert(room.name === NAME && room.collaborationMode === 'peer')
  assert.equal(room.repositories.length, 0)
  assert.equal(room.members.length, 5)
  assert.equal(new Set(room.members.map((member) => member.participantAgentId)).size, 5)
  const base = '/v1/rooms/' + room.id
  const topics = async () => (await request(page, base + '/topics')).topics
  const composer = page.locator('[data-rooms-workspace] > section > .rooms-composer')
  const send = async (body) => {
    await composer.getByLabel('Message intent', { exact: true }).selectOption('discussion')
    await composer.locator('.rooms-rich-input').fill(body)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
  }
  // The topic selection lives in the composer's Add context menu.
  const composerTopic = async () => {
    await composer.getByRole('button', { name: 'Add context', exact: true }).click()
    const topic = page.getByRole('combobox', { name: 'Topic', exact: true })
    const value = await topic.count() ? await topic.inputValue() : ''
    await page.keyboard.press('Escape')
    return value
  }
  await send(PROMPT)
  let firstTopic
  await poll(async () => {
    firstTopic = (await topics())[0]
    return firstTopic?.members.some((member) => member.state === 'responding') && fixture.snapshot().peerResponseRequests > 0
  }, 30000, 'persisted peer response activation')
  const rootRequestId = firstTopic.rootRequestId
  await page.getByRole('button', { name: 'Room details', exact: true }).click()
  const drawer = page.getByRole('region', { name: 'Room details', exact: true })
  await drawer.locator('summary').filter({ hasText: 'Members and response budgets' }).click()
  await drawer.getByText(/^Responding(?: ·|$)/).waitFor()
  await drawer.getByText('31 / 32', { exact: true }).waitFor()
  await capture('peer-desktop-responding')
  const liveRun = await viewRunningRoomRun({ page, request, roomId: room.id, poll, capture })
  await resize(760, 780)
  await page.waitForTimeout(250)
  await capture('peer-narrow-responding')
  const bounds = await drawer.boundingBox()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, 'Peer drawer overflowed narrow viewport')
  // Code docks the details beside the conversation; the sidebar's mode trigger stays usable.
  assert(await page.locator('[data-workspace-mode-trigger]').first().evaluate((trigger) => {
    const bounds = trigger.getBoundingClientRect()
    return trigger.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
  }), 'Peer details cover the Code mode trigger')
  await drawer.getByRole('button', { name: 'Stop discussion', exact: true }).click()
  await poll(async () => ['stopping', 'stopped'].includes((await topics()).find((value) => value.rootRequestId === rootRequestId)?.status),
    15000, 'peer discussion stop intent')
  fixture.releasePeer()
  await poll(async () => (await topics()).find((value) => value.rootRequestId === rootRequestId)?.status === 'stopped',
    30000, 'peer original response confirmed stopped')
  assert.equal((await request(page, base + '/messages')).messages.filter((message) => message.authorKind === 'member' && message.status === 'final').length, 0,
    'Stopped first response published late')
  await drawer.getByText('Discussion stopped', { exact: true }).waitFor()
  await capture('peer-stopped')
  await drawer.getByRole('button', { name: 'Continue topic', exact: true }).click()
  await poll(async () => await composerTopic() === rootRequestId, 5000, 'composer continues exact peer topic')
  await send(CONTINUATION)
  await poll(async () => {
    const topic = (await topics()).find((value) => value.rootRequestId === rootRequestId)
    return topic?.generation > firstTopic.generation && topic.status === 'idle' && topic.pendingCount === 0
  }, 30000, 'continued peer topic publishes and becomes idle')
  const firstMessages = (await request(page, base + '/messages')).messages
  const continued = firstMessages.find((message) => message.authorKind === 'user' && message.body === CONTINUATION)
  assert.equal(continued.rootRequestId, rootRequestId)
  const continuedReply = firstMessages.find((message) => message.authorKind === 'member' && message.status === 'final' && message.sourceRequestId === continued.sourceRequestId)
  assert.equal(continuedReply?.body, CONTINUED_BODY, 'Runtime must publish the exact accepted send_room_message body, not the later assistant completion text')
  assert.equal(await composerTopic(), '')
  await resize(1360, 900)
  await page.getByRole('button', { name: 'Room details', exact: true }).click()
  await drawer.getByText('Waiting for new updates', { exact: true }).waitFor()
  await capture('peer-continued-idle')
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await send(NEW_TOPIC)
  await poll(async () => (await topics()).length === 2 && (await topics()).every((topic) => topic.status === 'idle' && !topic.pendingCount),
    30000, 'new topic stays independent from the continued topic')
  const finalMessages = (await request(page, base + '/messages')).messages
  const newMessage = finalMessages.find((message) => message.body === NEW_TOPIC)
  assert.notEqual(newMessage.rootRequestId, rootRequestId)
  const newReply = finalMessages.find((message) => message.authorKind === 'member' && message.status === 'final' && message.sourceRequestId === newMessage.sourceRequestId)
  assert.equal(newReply?.body, NEW_BODY, 'New topic lost the accepted structured publication body')
  assert.equal((await request(page, base + '/tasks')).tasks.length, 0)
  assert(fixture.snapshot().peerTriageRequests > 0)
  await page.getByRole('button', { name: 'Room details', exact: true }).click()
  await poll(() => drawer.getByText('Waiting for new updates', { exact: true }).count().then((count) => count === 2),
    10000, 'both idle topic states reach the drawer')
  await capture('peer-two-topics')
  for (const topic of await topics()) await request(page, `${base}/topics/${topic.rootRequestId}/stop`, 'POST', {
    clientRequestId: 'smoke-peer-stop-' + topic.rootRequestId, expectedRevision: topic.revision
  })
  await poll(async () => (await topics()).every((topic) => topic.status === 'stopped'), 30000, 'all smoke peer discussions stopped')
  const runInspector = await exerciseFinishedRoomRuns({ page, request, roomId: room.id,
    messages: finalMessages, poll, capture, fixture, resize })
  await openConversation(room.id)
  return { roomId: room.id, rootRequestId, newRootRequestId: newMessage.rootRequestId, viewport,
    liveRun, runInspector,
    defaultMode: 'peer', latePublicationSuppressed: true, continuedSameTopic: true, newTopicIndependent: true,
    submittedBodiesHonored: true, taskCount: 0, finalMessages: finalMessages.filter((message) => message.authorKind === 'member' && message.status === 'final').length }
}
module.exports = { roomPeerModelFixture, exercisePeerRoom }
