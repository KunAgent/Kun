'use strict'
const assert = require('node:assert/strict')

// Runs only inside smoke-development-direct-chat's isolated Electron + Kun
// profile. The real UI saves through preload/main/HTTP and never calls a model.
// node scripts/smoke-development-direct-chat.cjs --workbench-only --avatar-only \
//   --evidence .cache/kun-avatar-app
async function exerciseLayeredAvatarControls({ page, request, poll, capture, recordDiagnostic,
  fixture, switchCode, openConversation }) {
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
    const keys = ['roomsMoreActions', 'roomsAppearance', 'roomsMyAvatar', 'roomsAvatarCustomize',
      'roomsAvatarTransparent', 'roomsAvatarRandom', 'roomsCancel', 'agentsSave']
    return { ...Object.fromEntries(keys.map((key) => [key, i18n.t(key, { ns: 'common' })])),
      coder: i18n.language.startsWith('zh') ? '程序员' : 'Coder',
      mint: i18n.language.startsWith('zh') ? '青绿' : 'Mint',
      happy: i18n.language.startsWith('zh') ? '眯眼笑' : 'Happy' }
  })
  const editor = page.locator('[data-active-drawer-page="true"] .rooms-user-avatar-form')
  const category = () => editor.getByLabel(labels.roomsAvatarCustomize, { exact: true })
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
  await category().selectOption('color')
  await editor.getByRole('button', { name: labels.mint, exact: true }).click()
  await category().selectOption('face')
  await editor.getByRole('button', { name: labels.happy, exact: true }).click()
  await category().selectOption('bg')
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
  await category().selectOption('color')
  assert.equal(await editor.getByRole('button', { name: labels.mint, exact: true }).getAttribute('aria-pressed'), 'true')
  await category().selectOption('face')
  assert.equal(await editor.getByRole('button', { name: labels.happy, exact: true }).getAttribute('aria-pressed'), 'true')
  await capture('avatar-app-saved-reopened')
  await editor.getByRole('button', { name: labels.roomsAvatarRandom, exact: true }).click()
  await editor.getByRole('button', { name: labels.roomsCancel, exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  assert.deepEqual(await request(page, '/v1/rooms/user-profile'), saved, 'Cancelling the reopened draft must preserve storage')
  assert.equal(fixture.snapshot().mainCalls, 0, 'Avatar customization must not call a chat model')
  const result = { native: true, offline: true, roomId: room.id, profile: saved, modelCalls: fixture.snapshot().calls,
    assertions: ['30 bundled preset thumbnails load in the real app', 'draft edits stay local until Save',
      'Electron/preload/main/Kun persist the selected parts and increment revision',
      'shared profile updates and reopening restores controls', 'Cancel preserves the persisted composition'] }
  await recordDiagnostic('avatar-app-profile', result)
  return result
}

module.exports = { exerciseLayeredAvatarControls }
