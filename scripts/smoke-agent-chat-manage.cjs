'use strict'
const assert = require('node:assert/strict')

// Runs inside smoke-development-direct-chat's disposable profile with the
// offline model fixture. Fixtures are seeded through runtime requests; the new
// surfaces are driven through stable data attributes, so the same flow
// captures evidence in either application locale.

async function selectedConversation(page) {
  return page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const { useAgentChatNavigationStore } = await import('/src/components/rooms/agent-chat-navigation.ts')
    return { route: useChatStore.getState().route, roomId: useAgentChatNavigationStore.getState().roomId }
  })
}

async function openRowMenu(page, row) {
  await row.hover()
  await row.locator('.sidebar-agent-chat-menu').click()
}

async function openListState(page, state) {
  await page.locator('.sidebar-agent-chats-list-menu').click()
  await page.locator(`[data-list-state="${state}"]`).click()
}

async function seedConversations({ page, request }) {
  const entry = await request(page, '/v1/agents/chat-entry')
  const kun = (await request(page, '/v1/agents/' + encodeURIComponent(entry.agentId))).agent
  const partner = (await request(page, '/v1/agents', 'POST', { clientRequestId: 'manage-smoke-partner',
    name: 'Research Partner', title: 'Finds and checks sources', defaultRole: 'reviewer',
    instructions: 'Find primary sources first, quote them precisely and say what is still uncertain.' })).agent
  const partnerRoom = (await request(page, `/v1/agents/${encodeURIComponent(partner.id)}/conversation`, 'POST', {})).room
  const group = await page.evaluate(async ({ agents }) => {
    const { roomsClient } = await import('/src/components/rooms/rooms-client.ts')
    const { agentMember } = await import('/src/components/rooms/agent-client.ts')
    return (await roomsClient.create({ name: 'Launch review', description: '', repositories: [],
      members: agents.map((agent) => agentMember(agent)), defaultMemberId: agents[0].id, collaborationMode: 'peer' },
    'manage-smoke-group')).room
  }, { agents: [kun, partner] })
  return { entry, kun, partner, partnerRoom, group }
}

async function exerciseAgentChatManagement({ page, request, poll, capture, fixture, switchCode }) {
  const assertions = []
  await poll(() => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().runtimeConnection === 'ready'
  }), 30000, 'Code runtime ready')
  if (!['chat', 'agent-chat'].includes((await selectedConversation(page)).route)) await switchCode()
  // The Code sidebar seeds the default private chat once the runtime is ready.
  await poll(async () => (await request(page, '/v1/agents/chat-entry')).initialized, 30000, 'default private chat')
  const { entry, kun, partner, partnerRoom, group } = await seedConversations({ page, request })
  const row = (roomId) => page.locator(`.sidebar-agent-chats [data-sidebar-entry="room:${roomId}"]`)
  await poll(async () => await row(entry.roomId).count() > 0 && await row(group.id).count() > 0 &&
    await row(partnerRoom.id).count() > 0, 15000, 'seeded conversations')
  await row(entry.roomId).locator('.sidebar-agent-chat-row').click()
  await poll(async () => (await selectedConversation(page)).roomId === entry.roomId, 15000, 'default private chat opened')

  await openRowMenu(page, row(partnerRoom.id))
  const privateMenu = page.locator('[data-conversation-menu="user_agent"]')
  await privateMenu.waitFor()
  assert.deepEqual(await privateMenu.locator('button').evaluateAll((items) =>
    items.map((item) => [item.dataset.conversationAction, item.classList.contains('is-danger')])),
  [['info', false], ['pin', false], ['archive', false], ['conversation', true], ['agent', true]])
  await capture('manage-01-private-row-menu')
  await privateMenu.locator('[data-conversation-action="info"]').click()
  await poll(async () => (await selectedConversation(page)).roomId === partnerRoom.id, 15000, 'partner chat opened')
  const agentBoard = page.locator('[data-conversation-info="agent"]')
  await agentBoard.waitFor()
  // The board shows the runtime's resolution for this chat, the same binding the composer uses.
  const resolved = await request(page, `/v1/agents/${encodeURIComponent(partner.id)}/models?room_id=${encodeURIComponent(partnerRoom.id)}`)
  await poll(async () => (await agentBoard.locator('.conversation-info-model strong').first().innerText()) === resolved.main.model,
    15000, 'resolved main model on the info board')
  assert.equal(await agentBoard.locator('h2').innerText(), partner.name)
  assert.equal(await agentBoard.locator('.conversation-info-hero > p').innerText(), partner.title)
  assert.equal(await agentBoard.locator('[data-info-danger]').count(), 2)
  await capture('manage-02-agent-info-board')
  assertions.push('The row menu opens the Agent info board with its identity, resolved model and removals')

  await row(group.id).locator('.sidebar-agent-chat-row').click()
  const groupBoard = page.locator('[data-conversation-info="group"]')
  await groupBoard.waitFor()
  await poll(async () => await groupBoard.locator('.conversation-info-member-model').count() === 2, 15000, 'member models')
  assert.deepEqual(await groupBoard.locator('.conversation-info-member-copy strong').allInnerTexts(), [kun.name, partner.name])
  await capture('manage-03-group-info-board')
  assertions.push('The open info board follows the user into the group and lists each member with its model')

  await openRowMenu(page, row(partnerRoom.id))
  await privateMenu.locator('[data-conversation-action="agent"]').click()
  const agentDialog = page.locator('.conversation-removal[data-removal="agent"]')
  await agentDialog.waitFor()
  await poll(async () => await agentDialog.locator('.conversation-removal-points li').count() === 4, 15000,
    'Agent removal names the group it stays in')
  await capture('manage-04-delete-agent-dialog')
  await agentDialog.locator('[data-removal-confirm="agent"]').click()
  await agentDialog.waitFor({ state: 'detached' })
  await poll(async () => await row(partnerRoom.id).count() === 0, 15000, 'deleted Agent leaves the list')
  assert((await request(page, `/v1/agents/${encodeURIComponent(partner.id)}`)).agent.archivedAt, 'Agent archived')
  assert((await request(page, `/v1/rooms/${encodeURIComponent(partnerRoom.id)}`)).room.deletedAt, 'Private chat deleted')
  assert.equal((await selectedConversation(page)).roomId, group.id, 'Deleting another conversation keeps the open one')
  const inactive = groupBoard.locator('li[data-member-status="archived"]')
  await poll(async () => await inactive.count() === 1, 15000, 'deleted Agent shown as inactive in the group')
  assert.equal(await inactive.locator('button.conversation-info-member-chat').count(), 0)
  await capture('manage-05-group-member-inactive')
  assertions.push('Deleting an Agent archives it, moves its private chat to Recently deleted and marks it inactive in groups')

  await openListState(page, 'deleted')
  await row(partnerRoom.id).waitFor()
  await openRowMenu(page, row(partnerRoom.id))
  const restore = page.locator('[data-conversation-action="restore"]')
  await restore.waitFor()
  await capture('manage-06-recently-deleted-restore')
  await restore.click()
  await poll(async () => !(await request(page, `/v1/agents/${encodeURIComponent(partner.id)}`)).agent.archivedAt &&
    !(await request(page, `/v1/rooms/${encodeURIComponent(partnerRoom.id)}`)).room.deletedAt, 15000, 'Agent and chat restored')
  await page.locator('.sidebar-agent-chats-scope').click()
  await row(partnerRoom.id).waitFor()
  await poll(async () => await inactive.count() === 0, 15000, 'restored Agent active again in the group')
  assertions.push('Recently deleted restores the Agent and its private chat together')

  await groupBoard.waitFor()
  await groupBoard.locator('[data-info-danger="group"]').click()
  const groupDialog = page.locator('.conversation-removal[data-removal="group"]')
  await groupDialog.waitFor()
  await capture('manage-07-delete-group-dialog')
  await groupDialog.locator('[data-removal-confirm="group"]').click()
  await poll(async () => (await selectedConversation(page)).route === 'chat', 15000, 'left the deleted group')
  await poll(async () => await row(group.id).count() === 0, 15000, 'deleted group leaves the list')
  assert((await request(page, `/v1/rooms/${encodeURIComponent(group.id)}`)).room.deletedAt, 'Group deleted')
  assertions.push('Deleting the open group from its info board leaves it and keeps it recoverable')

  await row(entry.roomId).locator('.sidebar-agent-chat-row').click()
  await page.locator('.direct-header').waitFor()
  await page.locator('[data-conversation-info="agent"]').waitFor()
  await page.locator('.direct-header .rooms-icon-button[aria-haspopup="dialog"]').last().click()
  const headerMenu = page.locator('.rooms-popover-surface .conversation-menu').last()
  await headerMenu.waitFor()
  assert.deepEqual((await headerMenu.locator('button').evaluateAll((items) =>
    items.map((item) => item.dataset.conversationAction))).slice(-2), ['conversation', 'agent'])
  await capture('manage-08-private-header-menu')
  await page.keyboard.press('Escape')
  await page.locator('.direct-chat-title').click()
  await page.locator('[data-conversation-info="agent"]').waitFor({ state: 'hidden' })
  await page.locator('.direct-chat-title').click()
  await page.locator('[data-conversation-info="agent"]').waitFor()
  await capture('manage-09-default-agent-board')
  assertions.push('The private header toggles the info board and lists removals last in its menu')
  assert.equal(fixture.snapshot().real, false, 'This acceptance uses the isolated offline model fixture')
  return { privateRoomId: entry.roomId, partnerId: partner.id, partnerRoomId: partnerRoom.id, groupId: group.id, assertions }
}

module.exports = { exerciseAgentChatManagement }
