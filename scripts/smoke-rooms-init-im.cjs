'use strict'
const assert = require('node:assert/strict')
const { Buffer } = require('node:buffer')

async function exerciseRoomsInitIm({ page, request, poll, capture, fixture, resize, switchRooms }) {
  const count = () => Object.values(fixture.snapshot()).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
  const before = count(), assertions = []
  const side = () => page.locator('.rooms-im-sidebar')
  const composer = () => page.locator('[data-rooms-workspace] > section > .rooms-composer')
  await switchRooms()
  await page.getByRole('heading', { name: '协调员', exact: true, level: 1 }).waitFor()
  const state = await request(page, '/v1/agents/onboarding')
  assert.equal(state.completed, true); assert.equal(Object.keys(state.bindings).length, 5)
  const catalog = await request(page, '/v1/agents?limit=100')
  assert.equal(catalog.agents.length, 5)
  assert.equal((await request(page, '/v1/rooms/sidebar')).entries.length, 6)
  for (const agent of catalog.agents) {
    const room = (await request(page, '/v1/agents/' + agent.id + '/conversation', 'POST', {})).room
    assert.equal((await request(page, '/v1/rooms/' + room.id + '/messages')).messages.length, 0)
  }
  assert.equal(count(), before)
  await side().getByRole('button', { name: '我的团队', exact: true }).waitFor()
  await capture('init-team-welcome')
  const welcome = page.getByRole('region', { name: 'Start an Agent conversation', exact: true })
  const example = welcome.locator('.rooms-welcome-examples button').first()
  await example.click()
  const input = composer().getByRole('textbox').first()
  assert((await input.innerText()).includes('帮我把这个需求'))
  await input.fill('MY_DRAFT_MUST_SURVIVE')
  await composer().getByLabel('Automatic intent', { exact: true }).selectOption('execute')
  await example.click()
  assert.equal(await composer().getByLabel('Automatic intent', { exact: true }).inputValue(), 'execute')
  await composer().getByLabel('Automatic intent', { exact: true }).selectOption('auto')
  assert.equal((await input.innerText()).trim(), 'MY_DRAFT_MUST_SURVIVE')
  assert.equal(count(), before)
  await input.fill('')
  await side().getByRole('button', { name: 'My avatar', exact: true }).click()
  const avatar = () => page.getByRole('dialog', { name: 'My avatar', exact: true })
  await avatar().waitFor()
  await avatar().getByRole('button', { name: 'Restore Kun avatar', exact: true }).click()
  await avatar().getByRole('button', { name: 'Save', exact: true }).click()
  await poll(async () => await avatar().count() === 0, 10000, 'default avatar saved')
  await side().getByRole('button', { name: 'My avatar', exact: true }).click()
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
  await side().getByRole('button', { name: 'My avatar', exact: true }).click()
  await avatar().getByRole('button', { name: 'Restore Kun avatar', exact: true }).click()
  await avatar().getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual((await request(page, '/v1/rooms/user-profile')).profile.avatar, uploaded)
  assert.equal(count(), before, 'Initialization, drafts and avatars must not call a model')
  assertions.push('atomic five-Agent initialization, empty persistent conversations, no model calls, non-destructive examples, cropped persistent user avatar')
  for (const agent of catalog.agents) {
    await side().getByRole('button', { name: agent.name, exact: true }).click()
    await page.getByRole('heading', { name: agent.name, exact: true, level: 1 }).waitFor()
    const room = (await request(page, '/v1/agents/' + agent.id + '/conversation', 'POST', {})).room
    await composer().getByRole('textbox').first().fill('INDEPENDENT_AGENT_SMOKE: reply briefly to verify this private conversation.')
    await composer().getByLabel('Automatic intent', { exact: true }).selectOption('discussion')
    await composer().getByRole('button', { name: 'Send', exact: true }).click()
    await poll(async () => (await request(page, '/v1/rooms/' + room.id + '/messages')).messages.some((m) => m.authorKind === 'member' && m.originRunId), 30000, 'native private reply: ' + agent.name)
    await poll(async () => (await request(page, '/v1/agents/' + agent.id + '/runs')).runs.some((r) => r.phase === 'discussion' && r.status === 'completed'), 30000, 'completed exact private run')
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
  await page.reload(); await page.locator('[data-workspace-mode-trigger]').first().waitFor(); await switchRooms()
  await poll(async () => (await request(page, '/v1/rooms/user-profile')).profile.avatar?.attachmentId === uploaded.attachmentId, 10000, 'profile survives reload')
  assert.deepEqual((await request(page, '/v1/agents/onboarding')).bindings, state.bindings)
  await capture('init-restored-conversation')
  assertions.push('five real native private responses and exact runs, user-right / Agent-left geometry, uploaded history avatar, themes, narrow viewport and reload')
  return { assertions, bindings: state.bindings, groupId: state.groupId, avatarAttachmentId: uploaded.attachmentId }
}
module.exports = { exerciseRoomsInitIm }

async function exerciseRoomsUpgrade({ page, request, poll, capture, fixture }) {
  const count = () => Object.values(fixture.snapshot()).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
  const before = count()
  const old = await request(page, '/v1/agents/onboarding')
  assert.equal(old.fresh, false); assert.equal(old.completed, false)
  for (const slot of old.slots.filter((slot) => ['researcher', 'designer'].includes(slot.templateId))) {
    await request(page, '/v1/agents/' + slot.agent.id, 'PATCH', { clientRequestId: 'archive-' + slot.templateId,
      expectedRevision: slot.agent.revision, archived: true })
  }
  const legacy = (await request(page, '/v1/agents', 'POST', { clientRequestId: 'upgrade-specialist',
    name: 'Legacy specialist', instructions: 'Keep these exact custom responsibilities.', title: 'Existing developer' })).agent
  await page.getByRole('button', { name: 'Preview team', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Meet your team', exact: true })
  await modal.waitFor()
  const developer = modal.locator('.rooms-init-roster > section').filter({ has: page.locator('strong').filter({ hasText: /^开发$/ }) })
  await developer.getByRole('button', { name: 'Choose existing Agent', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose existing Agent', exact: true })
  await picker.getByRole('textbox').fill('Legacy specialist')
  await picker.getByRole('button').filter({ hasText: 'Legacy specialist' }).click()
  await capture('upgrade-team-preview')
  await modal.getByRole('button', { name: 'Complete team and start chatting', exact: true }).click()
  await poll(async () => (await request(page, '/v1/agents/onboarding')).completed, 10000, 'existing team completed')
  const next = await request(page, '/v1/agents/onboarding')
  assert.equal(next.bindings.developer, legacy.id)
  assert.deepEqual((await request(page, '/v1/agents/' + legacy.id)).agent, legacy)
  for (const slot of old.slots.filter((slot) => ['researcher', 'designer'].includes(slot.templateId))) {
    assert.notEqual(next.bindings[slot.templateId], slot.agent.id)
    assert((await request(page, '/v1/agents/' + slot.agent.id)).agent.archivedAt)
  }
  await page.getByRole('heading', { name: '协调员', exact: true, level: 1 }).waitFor()
  await page.getByRole('button', { name: 'Meet your team', exact: true }).click()
  await page.getByRole('dialog', { name: 'Meet your team', exact: true }).getByRole('button', { name: 'Open team chat', exact: true }).click()
  await page.getByRole('heading', { name: '我的团队', exact: true, level: 1 }).waitFor()
  await capture('upgrade-completed-team')
  assert.equal(count(), before)
  return { groupId: next.groupId, bindings: next.bindings, assertions: ['existing-profile preview and native modal picker work',
    'custom Agent retained verbatim, archived defaults preserved, missing jobs created once', 'team opens without model calls'] }
}
module.exports.exerciseRoomsUpgrade = exerciseRoomsUpgrade
