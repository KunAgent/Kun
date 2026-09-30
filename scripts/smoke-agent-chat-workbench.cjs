'use strict'
const assert = require('node:assert/strict')
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
    await page.locator('.sidebar-agent-chats').getByRole('button', { name: 'New agent conversation', exact: true }).click()
    await page.locator('.direct-new-chat').waitFor()
    assert.equal(await page.locator('.direct-new-chat').getByRole('button', { name: 'Group chat', exact: true }).count(), 0,
      'Code private picker cannot create group chats')
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
      privateRoomId: useAgentChatNavigationStore.getState().roomId,
      groupRoomId: localStorage.getItem('kun.rooms.selected') }
  })
}

async function previewRoomWorkspaceFile(page, name, content, poll) {
  await page.locator('.rooms-workbench-rail').getByRole('button', { name: 'Files', exact: true }).click()
  const active = () => page.locator('[data-room-workbench-panel] [role="tabpanel"]:not([aria-hidden="true"])')
  await active().getByRole('button', { name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  await poll(async () => (await active().innerText()).includes(content), 15000, 'shared preview for ' + name)
}

async function collapseRoomPanel(page) {
  await page.locator('[data-room-workbench-panel]').getByRole('button', { name: 'Collapse right sidebar', exact: true }).first().click()
}

async function exerciseAgentChatWorkbench({ page, request, poll, capture, fixture, workspaceRoot, openPrivate, switchRooms, switchCode }) {
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
  await capture('workbench-01-project-task')

  await openPrivate()
  const entry = await request(page, '/v1/agents/chat-entry')
  assert(entry.initialized && entry.roomId && entry.agentId)
  const firstAgent = (await request(page, '/v1/agents')).agents.find((agent) => agent.id === entry.agentId)
  assert(firstAgent)
  const unsent = (await request(page, `/v1/rooms/${entry.roomId}`)).room
  assert(!unsent.pinned, 'The fresh private conversation is not artificially pinned')
  const firstPrivateRow = page.locator('.sidebar-agent-chat-row').filter({ hasText: firstAgent.name }).first()
  await firstPrivateRow.waitFor()
  await poll(async () => await firstPrivateRow.getAttribute('aria-current') === 'page', 15000,
    'fresh unsent private conversation appears selected in Code')
  const projectRow = page.getByRole('button', { name: /^Project scope smoke/ }).first()
  assert.equal(await projectRow.evaluate((element) => element.closest('.ds-sidebar-tree-row').dataset.active), 'false',
    'The project row is not highlighted while the Agent private conversation is selected')
  assert.equal((await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages.length, 0,
    'Empty private conversation visibility does not require a message')
  assertions.push('A freshly opened unsent and unpinned Agent conversation appears selected, with the project row unselected')
  const direct = await request(page, `/v1/rooms/${entry.roomId}/direct`)
  assert(direct.workspace.path && direct.workspace.path !== workspaceRoot, 'Unbound Agent has its own workspace')
  await mkdir(direct.workspace.path, { recursive: true })
  await writeFile(join(direct.workspace.path, 'private-evidence.txt'), 'Private workspace evidence\n')
  const editor = () => page.locator('.rooms-composer .rooms-rich-input')
  await editor().fill(privateDraft)
  const privateScope = await roomWorkbenchSnapshot(page)
  assert.equal(privateScope.route, 'agent-chat')
  assert.equal(privateScope.privateRoomId, entry.roomId)
  assert.equal(privateScope.activeThreadId, project.id, 'Private chat preserves the selected project task')
  assert.equal(privateScope.workspaceRoot, projectScope.workspaceRoot)
  await previewRoomWorkspaceFile(page, 'private-evidence.txt', 'Private workspace evidence', poll)
  assert.deepEqual(await roomWorkbenchSnapshot(page), privateScope)
  assert.equal(await editor().innerText(), privateDraft)
  await capture('workbench-02-code-private-preview')
  await collapseRoomPanel(page)
  assertions.push('Code private picker opens the selected Agent and shared file preview preserves its recipient, draft and project scope')

  await projectRow.click()
  await poll(async () => (await roomWorkbenchSnapshot(page)).route === 'chat', 15000, 'return to project task')
  await poll(async () => await page.locator('.ds-composer-textarea').inputValue() === projectDraft, 15000, 'project draft restored')
  assert.equal((await roomWorkbenchSnapshot(page)).activeThreadId, project.id)
  assert.equal((await roomWorkbenchSnapshot(page)).workspaceRoot, workspaceRoot)
  assert.equal(await projectRow.evaluate((element) => element.closest('.ds-sidebar-tree-row').dataset.active), 'true')
  const privateRow = page.locator('.sidebar-agent-chat-row').filter({ hasText: firstAgent.name }).first()
  await privateRow.waitFor()
  await privateRow.click()
  await editor().waitFor()
  assert.equal((await roomWorkbenchSnapshot(page)).privateRoomId, entry.roomId)
  assert.equal(await editor().innerText(), privateDraft)
  assert.equal(await page.locator('[data-room-workbench-panel]:visible').count(), 0, 'Room previews do not leak between task selections')
  assertions.push('Project and private chat sidebar selections restore separate drafts and keep the original project scope')

  const secondAgent = (await request(page, '/v1/agents', 'POST', {
    clientRequestId: 'smoke-room-reviewer', name: 'Room reviewer fixture', instructions: 'Review the supplied fixture evidence.', defaultRole: 'reviewer'
  })).agent
  await switchRooms()
  const sidebar = page.locator('.rooms-im-sidebar')
  await sidebar.getByRole('button', { name: 'Group chat', exact: true }).click()
  await page.locator('.direct-new-chat').waitFor()
  assert.equal(await page.locator('.direct-new-chat').getByRole('button', { name: 'Define in chat', exact: true }).count(), 0,
    'Rooms picker creates only group rooms')
  for (const name of [firstAgent.name, secondAgent.name]) {
    await page.locator('.direct-agent-choices button').filter({ hasText: name }).first().click()
  }
  await page.getByRole('button', { name: 'Start group (2 Agents)', exact: true }).click()
  await page.locator('.direct-new-chat').waitFor({ state: 'hidden' })
  await poll(async () => {
    const selected = (await roomWorkbenchSnapshot(page)).groupRoomId
    return Boolean(selected && selected !== entry.roomId)
  }, 15000, 'new group selection after asynchronous room-kind lookup')
  const createdGroupId = (await roomWorkbenchSnapshot(page)).groupRoomId
  assert(createdGroupId && createdGroupId !== entry.roomId)
  const initialGroup = (await request(page, `/v1/rooms/${createdGroupId}`)).room
  assert.equal(initialGroup.conversationKind, 'group')
  assert.deepEqual(initialGroup.members.map((member) => member.participantAgentId).sort(), [firstAgent.id, secondAgent.id].sort())
  const group = (await request(page, `/v1/rooms/${createdGroupId}`, 'PATCH', {
    clientRequestId: 'smoke-group-workbench', expectedRevision: initialGroup.revision,
    name: 'Product discussion fixture',
    repositories: [{ id: 'source', displayPath: workspaceRoot, displayName: 'Source repository' }]
  })).room
  await page.getByRole('heading', { name: new RegExp('^' + group.name) }).waitFor()
  const listed = await request(page, '/v1/rooms/sidebar?kind=group')
  assert(listed.entries.length > 0 && listed.entries.every((item) => item.kind === 'group'))
  const ids = await sidebar.locator('[data-sidebar-entry]').evaluateAll((elements) => elements.map((element) => element.dataset.sidebarEntry))
  assert(ids.includes('room:' + group.id) && !ids.includes('room:' + entry.roomId), 'Rooms default list excludes private chats')
  assert.equal(await page.locator('.sidebar-agent-chats').count(), 0, 'Rooms owns its own group navigation')
  await editor().fill(groupDraft)
  const groupScope = await roomWorkbenchSnapshot(page)
  assert.equal(groupScope.route, 'rooms')
  assert.equal(groupScope.groupRoomId, group.id)
  await previewRoomWorkspaceFile(page, 'baseline.txt', 'baseline', poll)
  assert.deepEqual(await roomWorkbenchSnapshot(page), groupScope)
  assert.equal(await editor().innerText(), groupDraft)
  await page.evaluate(async ({ workspaceRoot, roomId }) => {
    const { openRoomContentTarget } = await import('/src/components/rooms/room-content-navigation.ts')
    await openRoomContentTarget({ kind: 'code_file', workspaceRoot, relativePath: 'baseline.txt' },
      () => { throw new Error('File preview attempted to open a Code task') }, roomId)
  }, { workspaceRoot, roomId: group.id })
  assert.deepEqual(await roomWorkbenchSnapshot(page), groupScope, 'A referenced group file keeps the room and sender selected')
  await capture('workbench-03-rooms-group-preview')
  await collapseRoomPanel(page)
  assertions.push('Rooms default list contains group rooms, and file-tree plus content-reference previews preserve the room sender and draft')

  await switchCode()
  await openPrivate(firstAgent.name)
  assert.equal(await editor().innerText(), privateDraft)
  await switchRooms()
  await editor().waitFor()
  assert.equal((await roomWorkbenchSnapshot(page)).groupRoomId, group.id)
  assert.equal(await editor().innerText(), groupDraft)
  await capture('workbench-04-rooms-group-draft')
  await switchCode()
  await openPrivate(firstAgent.name)
  assert.equal(await editor().innerText(), privateDraft)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor()
  await openPrivate(firstAgent.name)
  assert.equal(await editor().innerText(), privateDraft)
  assert.equal((await roomWorkbenchSnapshot(page)).workspaceRoot, workspaceRoot)
  await capture('workbench-05-restored-code-private-chat')
  assertions.push('Switching Rooms and Code plus reloading the app restores the correct private and group drafts')
  assert.equal(fixture.snapshot().mainCalls, 0, 'Navigation, previews and fixture setup do not call a model')
  return { projectThreadId: project.id, privateRoomId: entry.roomId, groupRoomId: group.id,
    privateWorkspace: direct.workspace.path, projectWorkspace: workspaceRoot, assertions }
}

module.exports = { exerciseAgentChatWorkbench, openAgentPrivateChat, roomWorkbenchSnapshot, previewRoomWorkspaceFile, collapseRoomPanel }
