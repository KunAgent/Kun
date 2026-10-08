'use strict'
const assert = require('node:assert/strict')

// Runs only inside smoke-development-direct-chat's isolated Electron + Kun
// profile with the offline model fixture. The day's first finished Code task
// drops a bottle; the right-rail wardrobe opens it; settings default on; the
// studio hides unrevealed role cards; confirming a new Agent look applies it
// to every icon at once.
// node scripts/smoke-development-direct-chat.cjs --wardrobe-only --evidence .cache/kun-wardrobe
async function exerciseWardrobeDrops({ page, request, poll, capture, recordDiagnostic, fixture, workspaceRoot, switchCode, openPrivate }) {
  assert.equal(fixture.snapshot().real, false, 'Wardrobe evidence must use the disposable offline fixture')
  await switchCode()
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  const before = await request(page, '/v1/rooms/wardrobe')
  assert.equal(before.wardrobe.pending.length, 0, 'A fresh profile has no bottles')
  assert.deepEqual(before.wardrobe.settings, { drops: true, code: true, notice: 'card' }, 'Drops are on by default, Code tasks included')
  assert.equal(before.wardrobe.items['headwear/astronaut-helmet'], undefined, 'A legendary helmet starts locked')

  // 1. The day's first finished Code task always drops a bottle under the reply.
  await poll(() => page.evaluate(async () => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    return useChatStore.getState().runtimeConnection === 'ready'
  }), 30_000, 'Code runtime ready')
  const threadId = await page.evaluate(async (workspaceRoot) => {
    const { useChatStore } = await import('/src/store/chat-store.ts')
    const id = await useChatStore.getState().createThread({ workspaceRoot, forceNew: true })
    if (!id) throw new Error('Could not create the Code task')
    await useChatStore.getState().renameThread(id, '修复登录超时')
    return id
  }, workspaceRoot)
  await page.locator('.ds-composer-textarea').waitFor()
  await page.locator('.ds-composer-textarea').fill('你好')
  await page.locator('.ds-composer-textarea').press('Enter')
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.length === 1, 90_000, 'Code task drops a bottle')
  const dropped = (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending[0]
  assert.equal(dropped.source, 'code')
  assert.equal(dropped.threadId, threadId)
  assert.equal(dropped.sourceLabel, '修复登录超时')
  const card = page.locator(`.rooms-wardrobe-drop[data-wardrobe-drop="${dropped.id}"]`)
  await card.waitFor({ timeout: 30_000 })
  await poll(async () => card.locator('.rooms-wardrobe-bottle-icon img').evaluate((image) => image.complete && image.naturalWidth > 0),
    15_000, 'painted bottle art loads')
  await page.locator('[data-sidebar-wardrobe="1"]').waitFor()
  await capture('wardrobe-code-drop')

  // 2. The right rail has a wardrobe icon with the unopened count; it opens the panel.
  const railEntry = page.locator('[data-rail-entry="builtin:right-panel-wardrobe"]')
  await railEntry.locator('[data-rail-badge="1"]').waitFor()
  await railEntry.click()
  const panel = page.locator('[data-wardrobe-panel="ready"]')
  await panel.waitFor({ timeout: 30_000 })
  assert.equal(await panel.locator('[data-wardrobe-today="1"]').count(), 1, 'Today shows one bottle')
  await capture('wardrobe-panel-items')

  // 3. Opening from the panel reveals the item and records it in the log.
  await panel.locator(`[data-wardrobe-drop="${dropped.id}"]`).click()
  const reveal = page.locator('[data-wardrobe-reveal]')
  await reveal.waitFor()
  await capture('wardrobe-panel-reveal')
  const opened = await request(page, '/v1/rooms/wardrobe')
  assert.equal(opened.wardrobe.pending.length, 0)
  assert.equal(opened.wardrobe.history[0].id, dropped.id, 'The opened bottle is first in the log')
  await reveal.getByRole('button', { name: '收进衣橱', exact: true }).click()
  await reveal.waitFor({ state: 'hidden' })
  await poll(async () => (await page.locator('[data-sidebar-wardrobe]').count()) === 0, 10_000, 'sidebar entry clears')
  await panel.locator('[data-wardrobe-tab="log"]').click()
  await panel.getByText('Code · 修复登录超时', { exact: false }).first().waitFor()

  // 4. Settings: both switches start on; switching Code drops off persists.
  await panel.locator('[data-wardrobe-tab="settings"]').click()
  const codeSwitch = panel.locator('[data-wardrobe-setting="code"]')
  assert.equal(await panel.locator('[data-wardrobe-setting="drops"]').getAttribute('aria-checked'), 'true')
  assert.equal(await codeSwitch.getAttribute('aria-checked'), 'true')
  await capture('wardrobe-panel-settings')
  await codeSwitch.click()
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.settings.code === false, 10_000, 'Code drops switched off')
  await codeSwitch.click()
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.settings.code === true, 10_000, 'Code drops switched back on')

  // 5. Role cards: unrevealed ones show the card back and no name.
  await panel.locator('[data-wardrobe-tab="cards"]').click()
  const lit = (await request(page, '/v1/rooms/wardrobe')).wardrobe.roles.length
  assert.equal(await panel.locator('[data-wardrobe-card="unknown"]').count(), 30 - lit, 'Every unlit card is unknown')
  assert.equal(await panel.getByText('宇航员', { exact: true }).count(), 0, 'Unrevealed card names stay hidden')
  await poll(async () => panel.locator('.rooms-wardrobe-card-back img').first().evaluate((image) => image.complete && image.naturalWidth > 0),
    15_000, 'card back art loads')
  await capture('wardrobe-panel-cards')

  // 6. An Agent turn inside the 60-second window is remembered but not counted.
  await openPrivate('小 Kun')
  const roomId = (await request(page, '/v1/agents/chat-entry')).roomId
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  await editor.fill('再说一次')
  await editor.press('Enter')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/messages?limit=20`)).messages.length >= 2, 60_000, 'Agent reply arrives')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/direct`)).activity == null, 30_000, 'Agent turn settles')
  const quiet = await request(page, '/v1/rooms/wardrobe')
  assert.equal(quiet.wardrobe.totalDrops, 1, 'No bottle inside the minimum interval')
  await page.locator('[data-room-tool="wardrobe"]').click()
  await page.locator('[data-wardrobe-panel="ready"]').waitFor()

  // 7. The Agent studio hides unrevealed cards and applies a confirmed look at once.
  const agentId = (await request(page, '/v1/agents?limit=20')).agents.find((agent) => agent.name === '小 Kun').id
  const avatarBefore = (await request(page, `/v1/agents/${agentId}`)).agent.avatar
  const row = page.locator('.sidebar-agent-chat-row').filter({ hasText: '小 Kun' }).first()
  const rowHtml = () => row.locator('.rooms-avatar').first().evaluate((node) => node.innerHTML)
  const rowBefore = await rowHtml()
  await page.locator('.direct-header').getByRole('button', { name: '更多操作', exact: true }).click()
  await page.locator('[data-conversation-action="profile"]').click()
  await page.getByRole('button', { name: '选择头像', exact: true }).first().click()
  const dialog = page.locator('.rooms-init-dialog[data-size="wide"]')
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('button', { name: '宇航员', exact: true }).count(), 0, 'Studio hides unrevealed card names')
  assert(await dialog.getByRole('button', { name: '未知角色', exact: true }).count() >= 20, 'Studio shows unknown cards')
  await capture('wardrobe-studio-unknown-cards')
  await dialog.getByRole('tab', { name: '头饰', exact: true }).click()
  const helmet = dialog.getByRole('button', { name: '宇航头盔', exact: true })
  assert.equal(await helmet.getAttribute('data-locked'), 'true', 'Unowned items stay locked')
  await dialog.getByRole('tab', { name: '套装', exact: true }).click()
  await dialog.getByRole('button', { name: '侦探', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await poll(async () => JSON.stringify((await request(page, `/v1/agents/${agentId}`)).agent.avatar) !== JSON.stringify(avatarBefore),
    10_000, 'confirming the studio saves the Agent avatar')
  await poll(async () => (await rowHtml()) !== rowBefore, 15_000, 'sidebar conversation row follows the new avatar')
  await capture('wardrobe-agent-avatar-applied')
  const result = { native: true, offline: true, threadId, roomId, drop: dropped, assertions: [
    'drops default on, Code tasks included; the first finished Code task of the day drops a bottle under its reply',
    'the Code rail shows a wardrobe icon with the unopened count and opens the wardrobe panel',
    'opening from the panel reveals the item and records it in the log with its Code task label',
    'settings switches start on and persist changes',
    'unrevealed role cards show the card back without names, in the panel and in the studio',
    'an Agent turn inside the 60s interval does not drop; the Agent rail opens the same panel',
    'a confirmed Agent look saves at once and the sidebar icon follows'] }
  await recordDiagnostic('wardrobe-drops', result)
  return result
}

module.exports = { exerciseWardrobeDrops }
