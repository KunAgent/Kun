'use strict'
const { exerciseComposerModelPanel } = require('./smoke-composer-model-panel.cjs')
const assert = require('node:assert/strict')
const { confirmAgentCreationModel } = require('./smoke-agent-creation-model.cjs')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

// This helper runs inside smoke-development-direct-chat's disposable profile.
// Creating fixture identities and files never touches the signed-in Kun profile.
async function openAgentPrivateChat({ page, switchCode, name = '小 Kun' }) {
  const before = await roomWorkbenchSnapshot(page)
  if (before.route !== 'chat' && before.route !== 'agent-chat') await switchCode()
  await page.locator('.sidebar-agent-chats').waitFor()
  const existing = page.locator('.sidebar-agent-chat-row').filter({ hasText: name }).first()
  if (await existing.count()) await existing.click()
  else {
    await page.locator('.sidebar-agent-chats').getByRole('button', { name: 'New conversation', exact: true }).click()
    await page.locator('.direct-new-chat').waitFor()
    await page.locator('.direct-agent-choices button').filter({ hasText: name }).first().click()
  }
  await page.locator('.direct-header').waitFor()
  await page.locator('[data-workspace-mode-trigger][data-workspace-mode="chat"]').first().waitFor()
  assert.equal((await roomWorkbenchSnapshot(page)).route, 'agent-chat')
}

async function roomWorkbenchSnapshot(page) {
  return page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const { useAgentChatNavigationStore } = await import('/src/components/rooms/agent-chat-navigation.ts')
    const state = useChatStore.getState()
    return { route: state.route, activeThreadId: state.activeThreadId, workspaceRoot: state.workspaceRoot,
      conversationRoomId: useAgentChatNavigationStore.getState().roomId }
  })
}

async function previewRoomWorkspaceFile(page, name, content, poll) {
  await page.locator('.rooms-workbench-rail').getByRole('button', { name: 'Files', exact: true }).click()
  const active = () => page.locator('[data-room-workbench-panel] [role="tabpanel"]:not([aria-hidden="true"])')
  const workspaceTab = active().locator('.rooms-private-file-tabs').getByRole('button', { name: 'Workspace', exact: true })
  if (await workspaceTab.count()) await workspaceTab.click()
  await active().getByRole('button', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  await poll(async () => (await active().innerText()).includes(content), 15000, 'shared preview for ' + name)
}

async function collapseRoomPanel(page) {
  await page.locator('[data-room-workbench-panel]').getByRole('button', { name: 'Collapse right sidebar', exact: true }).first().click()
}

async function waitCodeConversation(page, poll, roomId, privateName) {
  await poll(async () => {
    const state = await roomWorkbenchSnapshot(page)
    return state.route === 'agent-chat' && state.conversationRoomId === roomId
  }, 15000, 'selected Code conversation ' + roomId)
  const surface = page.locator(`[data-room-surface="agent-chat"][data-room-id="${roomId}"]`)
  await surface.waitFor()
  if (privateName) await poll(async () =>
    (await surface.locator('.direct-chat-title strong').innerText().catch(() => '')) === privateName,
  15000, 'private recipient ' + privateName)
  await surface.locator('.rooms-composer .rooms-rich-input').waitFor()
}

async function seedPrivateHistory({ page, request, poll, roomId }) {
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  await editor.fill('Shared private conversation history fixture.')
  await editor.press('Enter')
  let completed
  await poll(async () => {
    const direct = await request(page, `/v1/rooms/${roomId}/direct`)
    const current = direct.requests[0]
    assert(!current || !['failed', 'recovery_required'].includes(current.status), JSON.stringify(current))
    if (current?.status === 'completed') { completed = current; return true }
    return false
  }, 60000, 'offline private greeting establishes shared history')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/messages`)).messages
    .some((message) => message.originRunId === completed.runId && message.status === 'final'),
  15000, 'private greeting public history')
  return (await request(page, `/v1/rooms/${roomId}/messages`)).messages.map((message) => message.id)
}

async function createConversationFromCode({ page, request, poll, picker, previous }) {
  await picker.waitFor({ state: 'hidden' })
  await poll(async () => {
    const selected = (await roomWorkbenchSnapshot(page)).conversationRoomId
    return Boolean(selected && !previous.includes(selected))
  }, 15000, 'new conversation selected in Code')
  const roomId = (await roomWorkbenchSnapshot(page)).conversationRoomId
  return (await request(page, `/v1/rooms/${roomId}`)).room
}

async function exerciseAgentChatWorkbench({ page, request, poll, capture, fixture, workspaceRoot, openPrivate }) {
  const projectDraft = 'Project task draft stays with the project.'
  const privateDraft = 'Private Agent draft stays with the recipient.'
  const groupDraft = 'Group draft stays with the room.'
  const assertions = []
  await poll(() => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().runtimeConnection === 'ready'
  }), 30000, 'Code runtime ready for isolated task creation')
  const project = await page.evaluate(async (workspaceRoot) => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const id = await useChatStore.getState().createThread({ workspaceRoot, forceNew: true })
    if (!id) throw new Error('Could not seed isolated project task')
    await useChatStore.getState().renameThread(id, 'Project scope smoke')
    return { id }
  }, workspaceRoot)
  await page.locator('.ds-composer-textarea').waitFor()
  await page.locator('.ds-composer-textarea').fill(projectDraft)
  const projectScope = await roomWorkbenchSnapshot(page)
  assert.equal(projectScope.activeThreadId, project.id)
  assert.equal(projectScope.workspaceRoot, workspaceRoot)
  await page.locator('[data-workspace-mode-trigger]').first().click()
  assert.deepEqual(await page.locator('[role="menuitemradio"][data-workspace-mode]').evaluateAll((items) =>
    items.map((item) => item.dataset.workspaceMode)), ['write', 'chat'], 'Rooms is no longer a workspace mode')
  await page.keyboard.press('Escape')
  await capture('workbench-01-project-task')
  assertions.push('The workspace mode menu offers only Work and Code')
  assertions.push(...await exerciseComposerModelPanel({ page, poll, capture, prefix: 'workbench-01b' }))

  await openPrivate()
  const entry = await request(page, '/v1/agents/chat-entry')
  assert(entry.initialized && entry.roomId && entry.agentId)
  const firstAgent = (await request(page, '/v1/agents')).agents.find((agent) => agent.id === entry.agentId)
  assert(firstAgent)
  const firstPrivateRow = page.locator('.sidebar-agent-chat-row').filter({ hasText: firstAgent.name }).first()
  await firstPrivateRow.waitFor()
  await poll(async () => await firstPrivateRow.getAttribute('aria-current') === 'page', 15000,
    'fresh unsent private conversation appears selected in Code')
  const projectRow = page.getByRole('button', { name: /^Project scope smoke/ }).first()
  assert.equal(await projectRow.evaluate((element) => element.closest('.ds-sidebar-tree-row').dataset.active), 'false',
    'The project row is not highlighted while the Agent private conversation is selected')
  const historyIds = await seedPrivateHistory({ page, request, poll, roomId: entry.roomId })
  assert(historyIds.length >= 2, 'The fixture establishes user and Agent messages for cross-conversation history checks')
  const direct = await request(page, `/v1/rooms/${entry.roomId}/direct`)
  assert(direct.workspace.path && direct.workspace.path !== workspaceRoot, 'Unbound Agent has its own workspace')
  await mkdir(direct.workspace.path, { recursive: true })
  await writeFile(join(direct.workspace.path, 'private-evidence.txt'), 'Private workspace evidence\n')
  const editor = () => page.locator('.rooms-composer .rooms-rich-input')
  await editor().fill(privateDraft)
  const privateScope = await roomWorkbenchSnapshot(page)
  assert.equal(privateScope.route, 'agent-chat')
  assert.equal(privateScope.conversationRoomId, entry.roomId)
  assert.equal(privateScope.activeThreadId, project.id, 'Private chat preserves the selected project task')
  await previewRoomWorkspaceFile(page, 'private-evidence.txt', 'Private workspace evidence', poll)
  assert.deepEqual(await roomWorkbenchSnapshot(page), privateScope)
  assert.equal(await editor().innerText(), privateDraft)
  await capture('workbench-02-code-private-preview')
  await collapseRoomPanel(page)
  await projectRow.click()
  await poll(async () => (await roomWorkbenchSnapshot(page)).route === 'chat', 15000, 'return to project task')
  await poll(async () => await page.locator('.ds-composer-textarea').inputValue() === projectDraft, 15000, 'project draft restored')
  await firstPrivateRow.click()
  await waitCodeConversation(page, poll, entry.roomId, firstAgent.name)
  assert.equal(await editor().innerText(), privateDraft)
  assertions.push('Project and private chat selections in Code restore separate drafts and keep the project scope')

  const picker = page.locator('.direct-new-chat')
  await page.locator('.sidebar-agent-chats').getByRole('button', { name: 'New conversation', exact: true }).click()
  await picker.waitFor()
  assert.equal(await picker.getByRole('button', { name: 'Define in chat', exact: true }).count(), 1)
  assert.equal(await picker.getByRole('button', { name: 'Group chat', exact: true }).count(), 1,
    'The Code picker offers private and group creation')
  await picker.getByRole('button', { name: 'Define in chat', exact: true }).click()
  const createdModelRef = await confirmAgentCreationModel({ page, request })
  const secondPrivate = await createConversationFromCode({ page, request, poll, picker, previous: [entry.roomId] })
  assert.equal(secondPrivate.conversationKind, 'user_agent')
  const secondAgent = (await request(page, '/v1/agents')).agents.find((agent) =>
    agent.id === secondPrivate.members[0].participantAgentId)
  assert(secondAgent)
  assert.deepEqual(secondAgent.modelRef, createdModelRef)
  await waitCodeConversation(page, poll, secondPrivate.id, secondAgent.name)
  await capture('workbench-03-code-new-private-chat')
  assertions.push('The Code picker creates a private Agent and opens it without leaving Code')

  await page.locator('.sidebar-new-chat').click()
  await picker.waitFor()
  await picker.getByRole('button', { name: 'Group chat', exact: true }).click()
  for (const name of [firstAgent.name, secondAgent.name]) {
    await page.locator('.direct-agent-choices button').filter({ hasText: name }).first().click()
  }
  await capture('workbench-04-code-group-picker')
  await page.getByRole('button', { name: 'Start group (2 Agents)', exact: true }).click()
  const initialGroup = await createConversationFromCode({ page, request, poll, picker, previous: [entry.roomId, secondPrivate.id] })
  assert.equal(initialGroup.conversationKind, 'group')
  assert.deepEqual(initialGroup.members.map((member) => member.participantAgentId).sort(), [firstAgent.id, secondAgent.id].sort())
  const group = (await request(page, `/v1/rooms/${initialGroup.id}`, 'PATCH', {
    clientRequestId: 'smoke-group-workbench', expectedRevision: initialGroup.revision,
    name: 'Product discussion fixture',
    repositories: [{ id: 'source', displayPath: workspaceRoot, displayName: 'Source repository' }]
  })).room
  await page.getByRole('heading', { name: new RegExp('^' + group.name) }).waitFor()
  await waitCodeConversation(page, poll, group.id)
  await page.locator('.rooms-header .rooms-mode-control select').waitFor()
  const conversations = page.locator('.sidebar-agent-chats')
  await conversations.locator('[data-sidebar-entry="room:' + group.id + '"]').waitFor()
  await conversations.locator('[data-sidebar-entry="room:' + entry.roomId + '"]').waitFor()
  assert.equal(await page.locator('.rooms-im-sidebar').count(), 0, 'Code has no separate Rooms list')
  await editor().fill(groupDraft)
  const groupScope = await roomWorkbenchSnapshot(page)
  assert.equal(groupScope.route, 'agent-chat')
  assert.equal(groupScope.conversationRoomId, group.id)
  await previewRoomWorkspaceFile(page, 'baseline.txt', 'baseline', poll)
  assert.deepEqual(await roomWorkbenchSnapshot(page), groupScope)
  assert.equal(await editor().innerText(), groupDraft)
  await page.evaluate(async ({ workspaceRoot, roomId }) => {
    const { openRoomContentTarget } = await import('/src/components/rooms/room-content-navigation.ts')
    await openRoomContentTarget({ kind: 'code_file', workspaceRoot, relativePath: 'baseline.txt' },
      () => { throw new Error('File preview attempted to open a Code task') }, roomId)
  }, { workspaceRoot, roomId: group.id })
  assert.deepEqual(await roomWorkbenchSnapshot(page), groupScope, 'A referenced group file keeps the room and sender selected')
  await capture('workbench-05-code-group-preview')
  await collapseRoomPanel(page)
  assertions.push('The Code picker creates a group that opens in Code, lists with private chats and keeps its own draft and files')

  await firstPrivateRow.click()
  await waitCodeConversation(page, poll, entry.roomId, firstAgent.name)
  assert.equal(await editor().innerText(), privateDraft)
  assert.deepEqual((await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages.map((message) => message.id), historyIds)
  for (const id of historyIds) await page.locator('#room-message-' + id).waitFor()
  await conversations.locator('[data-sidebar-entry="room:' + group.id + '"] .sidebar-agent-chat-row').click()
  await waitCodeConversation(page, poll, group.id)
  assert.equal(await editor().innerText(), groupDraft)
  await page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    useChatStore.getState().setRoute('rooms')
  })
  assert.equal((await roomWorkbenchSnapshot(page)).route, 'agent-chat', 'The retired Rooms route opens Code conversations')
  await capture('workbench-06-code-group-conversation')
  assertions.push('Private and group conversations switch inside Code with separate drafts; the legacy Rooms route stays in Code')

  await openPrivate(firstAgent.name)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor()
  await openPrivate(firstAgent.name)
  assert.equal(await editor().innerText(), privateDraft)
  assert.equal((await roomWorkbenchSnapshot(page)).workspaceRoot, workspaceRoot)
  await capture('workbench-07-restored-code-private-chat')
  await page.locator('.sidebar-new-task').click()
  await page.locator('[data-home-quick-start]').waitFor()
  await capture('workbench-08-code-home')
  assertions.push('Reload restores the private conversation and the Code home offers conversation shortcuts')
  assert.equal(fixture.snapshot().real, false, 'This acceptance uses the isolated offline model fixture')
  assert.equal(fixture.snapshot().blocked, 0)
  return { projectThreadId: project.id, privateRoomId: entry.roomId, groupRoomId: group.id,
    codeCreatedPrivateId: secondPrivate.id, sharedHistoryIds: historyIds, historyUserRequests: 1,
    privateWorkspace: direct.workspace.path, projectWorkspace: workspaceRoot, assertions }
}

module.exports = { exerciseAgentChatWorkbench, openAgentPrivateChat, roomWorkbenchSnapshot, previewRoomWorkspaceFile, collapseRoomPanel }
