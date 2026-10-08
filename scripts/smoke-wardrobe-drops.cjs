'use strict'
const assert = require('node:assert/strict')

// Runs only inside smoke-development-direct-chat's isolated Electron + Kun
// profile with the offline model fixture. One finished Agent turn must drop the
// first bottle; opening it moves the item into the wardrobe; the studio locks
// unowned items; confirming a new Agent look applies it to every icon at once.
// node scripts/smoke-development-direct-chat.cjs --wardrobe-only --evidence .cache/kun-wardrobe
async function exerciseWardrobeDrops({ page, request, poll, capture, recordDiagnostic, fixture, openPrivate }) {
  assert.equal(fixture.snapshot().real, false, 'Wardrobe evidence must use the disposable offline fixture')
  await openPrivate('小 Kun')
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  const labels = await page.evaluate(async () => {
    const { default: i18n } = await import('/src/i18n.ts')
    const keys = ['roomsWardrobeOpen', 'roomsWardrobeLater', 'roomsWardrobeKeep', 'roomsWardrobeLockedHint', 'roomsAvatarHeadwear',
      'roomsAvatarPresets', 'agentsSave', 'roomsMoreActions', 'roomsAvatarChoose']
    return Object.fromEntries(keys.map((key) => [key, i18n.t(key, { ns: 'common' })]))
  })
  const roomId = (await request(page, '/v1/agents/chat-entry')).roomId
  const before = await request(page, '/v1/rooms/wardrobe')
  assert.equal(before.wardrobe.pending.length, 0, 'A fresh profile has no bottles')
  assert.equal(before.wardrobe.items['glasses/square'], 1, 'Starter pack and default looks are owned from the start')
  assert.equal(before.wardrobe.items['headwear/astronaut-helmet'], undefined, 'A legendary helmet starts locked')
  assert.equal(await page.locator('[data-sidebar-wardrobe]').count(), 0)

  // 1. The first finished conversation turn always drops a common or rare bottle.
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  await editor.fill('你好')
  await editor.press('Enter')
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.length === 1, 60_000, 'first finished turn drops one bottle')
  const dropped = (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending[0]
  assert.equal(dropped.roomId, roomId)
  assert.equal(dropped.kind, 'item')
  assert(['common', 'rare'].includes(dropped.rarity), 'the first bottle is common or rare')
  const card = page.locator(`.rooms-wardrobe-drop[data-wardrobe-drop="${dropped.id}"]`)
  await card.waitFor()
  await page.locator('[data-sidebar-wardrobe]').waitFor()
  await capture('wardrobe-drop-card')

  // 2. "Later" folds the card into one line; it comes back on demand.
  await card.getByRole('button', { name: labels.roomsWardrobeLater, exact: true }).click()
  await card.waitFor({ state: 'hidden' })
  await page.locator('.rooms-wardrobe-drop-more').click()
  await card.waitFor()

  // 3. Opening reveals the item and moves it into the wardrobe before the dialog closes.
  await card.getByRole('button', { name: labels.roomsWardrobeOpen, exact: true }).click()
  const reveal = page.locator('[data-wardrobe-reveal]')
  await reveal.waitFor()
  await poll(async () => reveal.locator('.rooms-wardrobe-reveal-art img').evaluateAll((images) =>
    images.length >= 1 && images.every((image) => image.complete && image.naturalWidth > 0)), 30_000, 'reveal art loads')
  await capture('wardrobe-reveal')
  const key = `${dropped.item.category}/${dropped.item.id}`
  const opened = await request(page, '/v1/rooms/wardrobe')
  assert.equal(opened.wardrobe.pending.length, 0)
  assert.equal(opened.wardrobe.items[key], (before.wardrobe.items[key] ?? 0) + 1, 'the opened item is owned')
  if (dropped.duplicate) assert.equal(opened.wardrobe.feathers, dropped.feathers, 'duplicates pay feathers')
  await reveal.getByRole('button', { name: labels.roomsWardrobeKeep, exact: true }).click()
  await reveal.waitFor({ state: 'hidden' })
  await poll(async () => (await page.locator('[data-sidebar-wardrobe]').count()) === 0, 10_000, 'sidebar entry clears')

  // 4. A second turn within the minimum interval is remembered but not counted.
  const messagesBefore = (await request(page, `/v1/rooms/${roomId}/messages?limit=20`)).messages.length
  await editor.fill('再说一次')
  await editor.press('Enter')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/messages?limit=20`)).messages.length >= messagesBefore + 2, 60_000, 'second reply arrives')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/direct`)).activity == null, 30_000, 'second turn settles')
  const quiet = await request(page, '/v1/rooms/wardrobe')
  assert.equal(quiet.wardrobe.pending.length, 0, 'no bottle inside the minimum interval')
  assert.equal(quiet.wardrobe.totalDrops, 1)
  assert.equal(quiet.wardrobe.pity.lastCountedAt, opened.wardrobe.pity.lastCountedAt)

  // 5. The Agent studio locks unowned items and applies a confirmed look at once.
  const agentId = (await request(page, '/v1/agents?limit=20')).agents.find((agent) => agent.name === '小 Kun').id
  const avatarBefore = (await request(page, `/v1/agents/${agentId}`)).agent.avatar
  const row = page.locator('.sidebar-agent-chat-row').filter({ hasText: '小 Kun' }).first()
  const rowHtml = () => row.locator('.rooms-avatar').first().evaluate((node) => node.innerHTML)
  const headerHtml = () => page.locator('.direct-header .rooms-avatar').first().evaluate((node) => node.innerHTML)
  const [rowBefore, headerBefore] = [await rowHtml(), await headerHtml()]
  await page.locator('.direct-header').getByRole('button', { name: labels.roomsMoreActions, exact: true }).click()
  await page.locator('[data-conversation-action="profile"]').click()
  const profileHtml = () => page.locator('[data-active-drawer-page="true"] .agent-details .rooms-avatar').first().evaluate((node) => node.innerHTML)
  const profileBefore = await profileHtml()
  await page.getByRole('button', { name: labels.roomsAvatarChoose, exact: true }).first().click()
  const dialog = page.locator('.rooms-init-dialog[data-size="wide"]')
  await dialog.waitFor()
  await dialog.locator('.rooms-wardrobe-strip').waitFor()
  await dialog.getByRole('tab', { name: labels.roomsAvatarHeadwear, exact: true }).click()
  const helmet = dialog.getByRole('button', { name: '宇航头盔', exact: true })
  assert.equal(await helmet.getAttribute('data-locked'), 'true', 'unowned items are locked')
  assert.equal(await dialog.getByRole('button', { name: '带麦耳机', exact: true }).getAttribute('data-locked'), null, 'starter items are open')
  await capture('wardrobe-studio-locked')
  // aria-disabled keeps Playwright's actionability check away; the real click lands anyway.
  await helmet.click({ force: true })
  await poll(async () => (await dialog.locator('.rooms-avatar-composer-notice').innerText()).includes(labels.roomsWardrobeLockedHint), 5000, 'locked notice')
  await dialog.getByRole('tab', { name: labels.roomsAvatarPresets, exact: true }).click()
  assert.equal(await dialog.getByRole('button', { name: '宇航员', exact: true }).getAttribute('data-locked'), 'true', 'incomplete role cards are locked')
  await dialog.getByRole('button', { name: '侦探', exact: true }).click()
  await dialog.getByRole('button', { name: labels.agentsSave, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await poll(async () => JSON.stringify((await request(page, `/v1/agents/${agentId}`)).agent.avatar) !== JSON.stringify(avatarBefore),
    10_000, 'confirming the studio saves the Agent avatar without the profile Save button')
  const saved = (await request(page, `/v1/agents/${agentId}`)).agent
  assert.equal(saved.avatar.kind, 'composed')
  assert.equal(saved.avatar.parts.headwear, 'detective-hat')
  await poll(async () => (await rowHtml()) !== rowBefore, 15_000, 'sidebar conversation row follows the new avatar')
  await poll(async () => (await headerHtml()) !== headerBefore, 15_000, 'conversation header follows the new avatar')
  await poll(async () => (await profileHtml()) !== profileBefore, 15_000, 'Agent profile header follows the new avatar')
  await poll(async () => page.locator('.sidebar-agent-chat-row img[data-composed], .direct-header img[data-composed]').evaluateAll((images) =>
    images.length >= 2 && images.every((image) => image.complete && image.naturalWidth > 0)), 30_000, 'composed icons render')
  await capture('wardrobe-agent-avatar-applied')
  assert.equal(Object.keys(fixture.snapshot().byPrompt).length, 2, 'Only the two chat prompts reached the model')
  const result = { native: true, offline: true, roomId, drop: dropped, savedAvatar: saved.avatar, assertions: [
    'first finished Agent turn drops one common/rare bottle under the reply and in the sidebar',
    'later folds the card; open reveals the item and the wardrobe owns it before the dialog closes',
    'a turn inside the 60s interval is remembered without dropping',
    'studio locks unowned items and incomplete role cards; confirming a look saves the Agent avatar at once',
    'sidebar row, conversation header and profile header follow the new avatar' ] }
  await recordDiagnostic('wardrobe-drops', result)
  return result
}

module.exports = { exerciseWardrobeDrops }
