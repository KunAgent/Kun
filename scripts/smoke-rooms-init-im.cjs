'use strict'
const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')

// Code initializes the default Agent and its private conversation without a
// separate Rooms onboarding. The user's IM avatar is edited from a group header.
async function exerciseRoomsInitIm({ page, request, poll, capture, fixture, resize, openConversation }) {
  const count = () => Object.values(fixture.snapshot()).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
  const before = count(), assertions = []
  const composer = () => page.locator('[data-rooms-workspace] > section > .rooms-composer')
  const details = () => page.getByRole('region', { name: 'Room details', exact: true })
  let entry
  await poll(async () => { entry = await request(page, '/v1/agents/chat-entry'); return Boolean(entry.initialized && entry.roomId) },
    30000, 'Code initializes the default Agent conversation')
  const initial = (await request(page, '/v1/agents?limit=100')).agents
  assert.equal(initial.length, 1, 'Code initializes exactly one default Agent')
  assert.equal((await request(page, '/v1/agents/' + initial[0].id + '/conversation', 'POST', {})).room.id, entry.roomId)
  assert.equal((await request(page, '/v1/rooms/' + entry.roomId + '/messages')).messages.length, 0)
  assert.equal(count(), before, 'Initialization must not call a model')
  await openConversation(entry.roomId, initial[0].name)
  await capture('init-code-private-chat')
  const reviewer = (await request(page, '/v1/agents', 'POST', { clientRequestId: 'init-im-reviewer', name: 'Init IM reviewer',
    instructions: 'INDEPENDENT_AGENT_SMOKE: review briefly and read-only.', defaultRole: 'reviewer' })).agent
  const catalog = [initial[0], reviewer]
  const group = (await request(page, '/v1/rooms', 'POST', { clientRequestId: 'init-im-group', name: 'Init IM team',
    collaborationMode: 'peer', defaultMemberId: 'first', members: catalog.map((agent, index) => ({ id: index ? 'second' : 'first',
      participantAgentId: agent.id, displayName: agent.name, presetId: agent.presetId, role: agent.defaultRole, roleNotes: '',
      enabled: true, allowedRepositoryIds: [], revision: 0 })) })).room
  const listed = (await request(page, '/v1/rooms/sidebar?kind=all')).entries.map((value) => value.roomId)
  assert(listed.includes(entry.roomId) && listed.includes(group.id), 'Code lists the private chat and the group together')
  assert.equal(count(), before, 'Creating Agents and a group must not call a model')
  await openConversation(group.id)
  const avatar = () => details().locator('[data-active-drawer-page="true"] .rooms-user-avatar-form')
  const openAvatar = async () => {
    await page.locator('.rooms-header').getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('button', { name: 'Conversation appearance', exact: true }).click()
    await page.getByRole('button', { name: 'My avatar', exact: true }).click()
    await avatar().waitFor()
    // The header menus stay open after this action; a click in the panel title dismisses them.
    await details().locator('.rooms-detail-titlebar h2').click()
  }
  await openAvatar()
  await avatar().getByRole('button', { name: 'Restore Kun avatar', exact: true }).click()
  await avatar().getByRole('button', { name: 'Save', exact: true }).click()
  await poll(async () => await avatar().count() === 0, 10000, 'default avatar saved')
  await openAvatar()
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 480; c.height = 320
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ff5555'; ctx.fillRect(0, 0, 240, 320); ctx.fillStyle = '#4477ff'; ctx.fillRect(240, 0, 240, 320)
    return c.toDataURL('image/png').split(',')[1]
  })
  await avatar().locator('input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await avatar().getByLabel('Horizontal', { exact: true }).fill('90')
  await avatar().locator('canvas').waitFor()
  await capture('init-avatar-crop')
  assert.equal((await request(page, '/v1/rooms/user-profile')).profile.avatar, null, 'Preview must not save')
  await avatar().getByRole('button', { name: 'Save', exact: true }).click()
  await poll(async () => (await request(page, '/v1/rooms/user-profile')).profile.avatar?.kind === 'uploaded', 10000, 'uploaded profile persisted')
  await poll(async () => await avatar().count() === 0, 10000, 'avatar editor closed')
  const uploaded = (await request(page, '/v1/rooms/user-profile')).profile.avatar
  const content = await request(page, '/v1/rooms/avatars/' + uploaded.attachmentId)
  assert.equal(content.image.width, 128); assert.equal(content.image.height, 128)
  await openAvatar()
  await avatar().getByRole('button', { name: 'Restore Kun avatar', exact: true }).click()
  await avatar().getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual((await request(page, '/v1/rooms/user-profile')).profile.avatar, uploaded)
  assert.equal(count(), before, 'Initialization, drafts and avatars must not call a model')
  assertions.push('one default Agent with an empty persistent conversation, no model calls, cropped persistent user avatar from a Code group header')
  for (const agent of catalog) {
    const room = (await request(page, '/v1/agents/' + agent.id + '/conversation', 'POST', {})).room
    await openConversation(room.id, agent.name)
    await composer().locator('.rooms-rich-input').fill('INDEPENDENT_AGENT_SMOKE: reply briefly to verify this private conversation.')
    await composer().getByRole('button', { name: 'Send', exact: true }).click()
    await poll(async () => (await request(page, '/v1/rooms/' + room.id + '/messages')).messages.some((m) => m.authorKind === 'member' && m.originRunId), 30000, 'native private reply: ' + agent.name)
    await poll(async () => (await request(page, '/v1/agents/' + agent.id + '/runs')).runs.some((r) => r.phase === 'conversation' && r.status === 'completed' && r.outcome === 'published'), 30000, 'completed exact private run')
  }
  const user = page.locator('.rooms-message-user').first(), member = page.locator('.rooms-message-member').first()
  await member.waitFor()
  const positions = await page.evaluate(() => {
    const user = document.querySelector('.rooms-message-user'), member = document.querySelector('.rooms-message-member')
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right } }
    return { user: rect(user), member: rect(member), userAvatar: rect(user.querySelector('.rooms-avatar')), userBubble: rect(user.querySelector('.rooms-message-bubble')),
      agentAvatar: rect(member.querySelector('.rooms-avatar')), agentBubble: rect(member.querySelector('.rooms-message-bubble')) }
  })
  assert(positions.user.x > positions.member.x, 'User row should be on the right')
  assert(positions.userAvatar.x >= positions.userBubble.right, 'User avatar should follow the bubble')
  assert(positions.agentAvatar.right <= positions.agentBubble.x, 'Agent avatar should precede the bubble')
  assert((await user.locator('.rooms-avatar img').getAttribute('src')).startsWith('data:image/'))
  await capture('init-im-private-conversation')
  for (const theme of ['light', 'dark']) {
    await page.evaluate(async (value) => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme(value) }, theme)
    await resize(1360, 900); await capture('init-desktop-' + theme)
    await resize(760, 760); await capture('init-narrow-' + theme)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Viewport should not overflow')
  }
  await resize(1360, 900)
  await page.reload(); await page.locator('[data-workspace-mode-trigger]').first().waitFor(); await openConversation(entry.roomId, initial[0].name)
  await poll(async () => (await request(page, '/v1/rooms/user-profile')).profile.avatar?.attachmentId === uploaded.attachmentId, 10000, 'profile survives reload')
  assert.equal((await request(page, '/v1/agents/chat-entry')).roomId, entry.roomId)
  await capture('init-restored-conversation')
  assertions.push('native private responses and exact runs for each Agent, user-right / Agent-left geometry, uploaded history avatar, themes, narrow viewport and reload')
  return { assertions, agentIds: catalog.map((agent) => agent.id), groupId: group.id, avatarAttachmentId: uploaded.attachmentId }
}
module.exports = { exerciseRoomsInitIm }
