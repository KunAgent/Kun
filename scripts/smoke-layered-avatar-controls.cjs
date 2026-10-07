'use strict'
const assert = require('node:assert/strict')

// Runs only inside smoke-development-direct-chat's isolated Electron + Kun
// profile. The real UI saves through preload/main/HTTP and never calls a model.
// node scripts/smoke-development-direct-chat.cjs --workbench-only --avatar-only \
//   --evidence .cache/kun-avatar-app
async function exerciseLayeredAvatarControls({ page, request, poll, capture, recordDiagnostic,
  fixture, switchCode, openConversation, openPrivate, resize }) {
  assert.equal(fixture.snapshot().real, false, 'Avatar evidence must use the disposable offline fixture')
  await switchCode()
  const original = await request(page, '/v1/rooms/user-profile')
  const initialAvatar = { kind: 'composed', version: 1, parts: {
    color: 'sky', face: 'normal', headwear: 'headphones', outfit: 'cream-scarf', bg: '#f7f5ef'
  } }
  const seeded = await request(page, '/v1/rooms/user-profile', 'PUT', {
    clientRequestId: 'avatar-smoke-seed', expectedRevision: original.revision, avatar: initialAvatar
  })
  const { room } = await request(page, '/v1/rooms', 'POST', {
    clientRequestId: 'avatar-smoke-group', name: 'Layered avatar evidence', repositories: []
  })
  await openConversation(room.id)
  const labels = await page.evaluate(async () => {
    const { default: i18n } = await import('/src/i18n.ts')
    const keys = ['roomsMoreActions', 'roomsAppearance', 'roomsMyAvatar', 'roomsAvatarBodyColor',
      'roomsAvatarExpression', 'roomsAvatarBackground', 'roomsAvatarTransparent', 'roomsAvatarRandom', 'roomsCancel', 'agentsSave']
    return { ...Object.fromEntries(keys.map((key) => [key, i18n.t(key, { ns: 'common' })])),
      coder: i18n.language.startsWith('zh') ? '程序员' : 'Coder',
      mint: i18n.language.startsWith('zh') ? '青绿' : 'Mint',
      happy: i18n.language.startsWith('zh') ? '眯眼笑' : 'Happy' }
  })
  const editor = page.locator('[data-active-drawer-page="true"] .rooms-user-avatar-form')
  const tab = (key) => editor.getByRole('tab', { name: labels[key], exact: true })
  const waitPreview = () => poll(async () => editor.locator('.rooms-avatar-composer-preview img[data-composed]')
    .evaluateAll((images) => images.length === 1 && images.every((image) => image.complete && image.naturalWidth > 0)),
  30_000, 'actual app composed preview')
  const open = async () => {
    await page.locator('[data-room-header-kind="group"]').getByRole('button', { name: labels.roomsMoreActions, exact: true }).click()
    await page.getByRole('button', { name: labels.roomsAppearance, exact: true }).click()
    await page.getByRole('button', { name: labels.roomsMyAvatar, exact: true }).click()
    await editor.waitFor()
    // Dismiss the nested appearance menus through the normal outside click.
    await editor.locator('.rooms-avatar-composer-preview').click()
    await waitPreview()
  }
  await open()
  assert.equal(await editor.locator('.rooms-avatar-composer-option').count(), 30)
  await poll(async () => editor.locator('.rooms-avatar-composer-option img[data-composed]')
    .evaluateAll((images) => images.length === 30 && images.every((image) => image.complete && image.naturalWidth > 0)),
  30_000, 'all 30 actual app preset thumbnails')
  await capture('avatar-app-presets')
  await editor.getByRole('button', { name: labels.coder, exact: true }).click()
  await tab('roomsAvatarBodyColor').click()
  await editor.getByRole('button', { name: labels.mint, exact: true }).click()
  await tab('roomsAvatarExpression').click()
  await editor.getByRole('button', { name: labels.happy, exact: true }).click()
  await tab('roomsAvatarBackground').click()
  await editor.getByRole('button', { name: labels.roomsAvatarTransparent, exact: true }).click()
  await waitPreview()
  assert.deepEqual(await request(page, '/v1/rooms/user-profile'), seeded, 'Editing must not persist before Save')
  await capture('avatar-app-composed-draft')
  const expectedAvatar = { kind: 'composed', version: 1, parts: {
    color: 'mint', face: 'happy', glasses: 'square', outfit: 'black-hoodie', bg: 'transparent'
  } }
  await editor.getByRole('button', { name: labels.agentsSave, exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  const saved = await request(page, '/v1/rooms/user-profile')
  assert.deepEqual(saved.profile.avatar, expectedAvatar, 'Real runtime must persist the UI-selected composition')
  assert.equal(saved.revision, seeded.revision + 1, 'Save must advance the profile revision once')
  await poll(async () => page.evaluate(async (expected) => {
    const { useRoomUserProfile } = await import('/src/components/rooms/room-user-profile.ts')
    const current = useRoomUserProfile.getState()
    return current.revision === expected.revision && JSON.stringify(current.profile) === JSON.stringify(expected.profile)
  }, saved), 15_000, 'shared user profile observes the saved composition')
  await open()
  await tab('roomsAvatarBodyColor').click()
  assert.equal(await editor.getByRole('button', { name: labels.mint, exact: true }).getAttribute('aria-pressed'), 'true')
  await tab('roomsAvatarExpression').click()
  assert.equal(await editor.getByRole('button', { name: labels.happy, exact: true }).getAttribute('aria-pressed'), 'true')
  await capture('avatar-app-saved-reopened')
  await editor.getByRole('button', { name: labels.roomsAvatarRandom, exact: true }).click()
  await editor.getByRole('button', { name: labels.roomsCancel, exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  assert.deepEqual(await request(page, '/v1/rooms/user-profile'), saved, 'Cancelling the reopened draft must preserve storage')
  const studio = await exerciseAgentAvatarStudio({ page, request, poll, capture, openPrivate, resize })
  assert.equal(fixture.snapshot().mainCalls, 0, 'Avatar customization must not call a chat model')
  const result = { native: true, offline: true, roomId: room.id, profile: saved, modelCalls: fixture.snapshot().calls,
    assertions: ['30 bundled preset thumbnails load in the real app', 'draft edits stay local until Save',
      'Electron/preload/main/Kun persist the selected parts and increment revision',
      'shared profile updates and reopening restores controls', 'Cancel preserves the persisted composition', ...studio] }
  await recordDiagnostic('avatar-app-profile', result)
  return result
}

/** The Agent avatar dialog as a dress-up studio: stage, wardrobe tabs, item art, try-on and slots. */
async function exerciseAgentAvatarStudio({ page, request, poll, capture, openPrivate, resize }) {
  await openPrivate('小 Kun')
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  const agentId = (await request(page, '/v1/agents?limit=20')).agents.find((agent) => agent.name === '小 Kun').id
  const before = (await request(page, `/v1/agents/${agentId}`)).agent.avatar
  await page.locator('.direct-header').getByRole('button', { name: '更多操作', exact: true }).click()
  await page.locator('[data-conversation-action="profile"]').click()
  await page.getByRole('button', { name: '选择头像', exact: true }).first().click()
  const dialog = page.locator('.rooms-init-dialog[data-size="wide"]')
  await dialog.waitFor()
  const ready = (selector, count) => poll(async () => dialog.locator(selector).evaluateAll((images, expected) =>
    images.length >= expected && images.every((image) => image.complete && image.naturalWidth > 0), count), 30_000, selector)
  await dialog.locator('.rooms-avatar-stage-mirror').waitFor()
  await ready('.rooms-avatar-composer-option img[data-composed]', 30)
  await capture('avatar-studio-looks')
  await dialog.getByRole('tab', { name: '头饰', exact: true }).click()
  await ready('.rooms-avatar-composer-option .rooms-avatar-item-art img', 19)
  await capture('avatar-studio-hats')
  const hat = dialog.getByRole('button', { name: '巫师帽', exact: true })
  await hat.hover()
  await dialog.locator('.rooms-avatar-stage-badge').waitFor()
  await ready('.rooms-avatar-stage-mirror img[data-composed]', 1)
  await capture('avatar-studio-try-on')
  await hat.click()
  await dialog.locator('.rooms-avatar-slot[data-filled] .rooms-avatar-item-art img').first().waitFor()
  await dialog.getByRole('tab', { name: '衣服', exact: true }).click()
  await dialog.getByRole('button', { name: '魔法师披风', exact: true }).click()
  await page.mouse.move(4, 4)
  await poll(async () => (await dialog.locator('.rooms-avatar-stage-badge').count()) === 0, 10_000, 'try-on ends after leaving')
  await capture('avatar-studio-wearing')
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark') })
  await capture('avatar-studio-dark')
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('light') })
  await resize(760, 860)
  await capture('avatar-studio-narrow')
  assert(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), 'Studio has no horizontal overflow at 760px')
  await resize(1360, 900)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual((await request(page, `/v1/agents/${agentId}`)).agent.avatar, before, 'Cancelling the studio keeps the saved avatar')
  return ['Agent avatar dialog opens as a wide studio with 30 composed looks',
    'Hat tab shows 19 isolated item artworks; hovering tries one on the stage; clicking fills its slot',
    'Light, dark and 760px layouts captured; Cancel leaves the Agent avatar unchanged']
}

module.exports = { exerciseLayeredAvatarControls }
