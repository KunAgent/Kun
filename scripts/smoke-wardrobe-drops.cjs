'use strict'
const assert = require('node:assert/strict')

// Runs only inside smoke-development-direct-chat's isolated Electron + Kun
// profile with the offline model fixture and a debug shelf of 11 bottles. The
// day's first finished Code task drops the 12th; it goes on the shelf; a real
// ten-pull and a single opening play the stage; settings default on; the
// studio hides unrevealed role cards; a confirmed Agent look applies at once.
// node scripts/smoke-development-direct-chat.cjs --wardrobe-only --evidence .cache/kun-wardrobe
async function exerciseWardrobeDrops({ page, request, poll, capture, recordDiagnostic, fixture, workspaceRoot, switchCode, openPrivate }) {
  assert.equal(fixture.snapshot().real, false, 'Wardrobe evidence must use the disposable offline fixture')
  await switchCode()
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  const before = await request(page, '/v1/rooms/wardrobe')
  assert.equal(before.wardrobe.pending.length, 11, 'The debug shelf starts with 11 bottles')
  assert(before.wardrobe.pending.every((drop) => drop.stashedAt), 'Seeded bottles are already on the shelf')
  assert.deepEqual(before.wardrobe.settings, { drops: true, code: true, notice: 'card' }, 'Drops are on by default, Code tasks included')

  // 1. The day's first finished Code task drops a bottle; the card keeps its rarity secret.
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
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.length === 12, 90_000, 'Code task drops a bottle')
  const dropped = (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.find((drop) => drop.threadId === threadId)
  assert.equal(dropped.source, 'code')
  const card = page.locator(`.rooms-wardrobe-drop[data-wardrobe-drop="${dropped.id}"]`)
  await card.waitFor({ timeout: 30_000 })
  assert.equal(await card.getAttribute('data-rarity'), null, 'The chat card does not hint the rarity')
  await page.locator('[data-sidebar-wardrobe="12"]').waitFor()
  await capture('wardrobe-code-drop')

  // 2. "Put on shelf" keeps it unopened and the card goes away.
  await card.locator('[data-drop-stash]').click()
  await card.waitFor({ state: 'hidden' })
  assert((await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.find((drop) => drop.id === dropped.id).stashedAt, 'stashed')

  // 3. The sidebar shelf opens the idle stage; the rail opens the panel with the shelf.
  await page.locator('[data-sidebar-wardrobe="12"]').click()
  const stage = page.locator('dialog.kun-gacha')
  await stage.waitFor()
  assert.equal(await stage.getAttribute('data-phase'), 'idle')
  // The app zooms <body>; the stage must still cover the whole window.
  const cover = await stage.evaluate((node) => { const rect = node.getBoundingClientRect(); return [rect.width, rect.height, innerWidth, innerHeight] })
  assert(Math.abs(cover[0] - cover[2]) < 2 && Math.abs(cover[1] - cover[3]) < 2, `Stage covers the window: ${cover}`)
  await capture('wardrobe-stage-idle')
  await stage.locator('.kun-gacha-close').click()
  await stage.waitFor({ state: 'detached' })
  const railEntry = page.locator('[data-rail-entry="builtin:right-panel-wardrobe"]')
  await railEntry.locator('[data-rail-badge="12"]').waitFor()
  await railEntry.click()
  const panel = page.locator('[data-wardrobe-panel="ready"]')
  await panel.waitFor({ timeout: 30_000 })
  await panel.locator('[data-wardrobe-shelf="12"]').waitFor()
  assert(await panel.locator('[data-wardrobe-item="unknown"]').count() > 30, 'Unowned items show as unknown')
  assert.equal(await panel.getByText('宇航头盔', { exact: true }).count(), 0, 'Unowned item names stay hidden')
  await capture('wardrobe-panel-shelf')

  // 4. A real ten-pull: shake, light, burst, ten flipped cards and a summary.
  const oldest = (await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 10).map((drop) => drop.id)
  await panel.locator('[data-shelf-open="ten"]').click()
  await stage.waitFor()
  await poll(async () => (await stage.getAttribute('data-phase')) === 'charge', 10_000, 'bottles light up')
  await capture('wardrobe-ten-charge')
  await poll(async () => (await stage.getAttribute('data-phase')) === 'reveal', 10_000, 'cards start flipping')
  await page.waitForTimeout(700)
  await capture('wardrobe-ten-reveal')
  await poll(async () => (await stage.getAttribute('data-phase')) === 'done', 15_000, 'ten-pull finishes')
  assert.equal(await stage.locator('[data-gacha-card]').count(), 10)
  await stage.locator('[data-gacha-summary]').waitFor()
  await poll(async () => stage.locator('[data-gacha-card] img').evaluateAll((images) => images.length >= 10 && images.every((image) => image.complete && image.naturalWidth > 0)),
    15_000, 'result art loads')
  await capture('wardrobe-ten-done')
  const afterTen = await request(page, '/v1/rooms/wardrobe')
  assert.equal(afterTen.wardrobe.pending.length, 2, 'Ten bottles left the shelf')
  assert.deepEqual(afterTen.wardrobe.history.slice(0, 10).map((drop) => drop.id).sort(), oldest.slice().sort(), 'The oldest ten were opened')
  assert(afterTen.wardrobe.history.slice(0, 10).some((drop) => drop.rarity !== 'common'), 'A ten-pull always holds a rare or better')
  assert.equal(await stage.locator('[data-gacha-again]').isDisabled(), true, 'Two left is not enough for another ten-pull')
  await stage.locator('[data-gacha-keep]').click()
  await stage.waitFor({ state: 'detached' })

  // 5. Opening one from the shelf plays the single stage.
  await panel.locator('[data-shelf-open="one"]').click()
  await stage.waitFor()
  await poll(async () => (await stage.getAttribute('data-phase')) === 'done', 10_000, 'single bottle opens')
  await poll(async () => stage.locator('[data-gacha-card] img').evaluateAll((images) => images.length >= 1 && images.every((image) => image.complete && image.naturalWidth > 0)),
    15_000, 'single result art loads')
  await capture('wardrobe-single-done')
  await stage.locator('[data-gacha-keep]').click()
  await stage.waitFor({ state: 'detached' })
  assert.equal((await request(page, '/v1/rooms/wardrobe')).wardrobe.pending.length, 1)
  await panel.locator('[data-wardrobe-tab="log"]').click()
  await panel.getByText('Debug shelf', { exact: false }).first().waitFor()

  // 6. Settings: both switches start on; switching Code drops off persists.
  await panel.locator('[data-wardrobe-tab="settings"]').click()
  const codeSwitch = panel.locator('[data-wardrobe-setting="code"]')
  assert.equal(await panel.locator('[data-wardrobe-setting="drops"]').getAttribute('aria-checked'), 'true')
  assert.equal(await codeSwitch.getAttribute('aria-checked'), 'true')
  await capture('wardrobe-panel-settings')
  await codeSwitch.click()
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.settings.code === false, 10_000, 'Code drops switched off')
  await codeSwitch.click()
  await poll(async () => (await request(page, '/v1/rooms/wardrobe')).wardrobe.settings.code === true, 10_000, 'Code drops switched back on')

  // 7. Role cards: unrevealed ones show the card back and no name.
  await panel.locator('[data-wardrobe-tab="cards"]').click()
  const lit = (await request(page, '/v1/rooms/wardrobe')).wardrobe.roles.length
  assert.equal(await panel.locator('[data-wardrobe-card="unknown"]').count(), 30 - lit, 'Every unlit card is unknown')
  assert.equal(await panel.getByText('宇航员', { exact: true }).count(), 0, 'Unrevealed card names stay hidden')
  await poll(async () => panel.locator('.rooms-wardrobe-card-back img').first().evaluate((image) => image.complete && image.naturalWidth > 0),
    15_000, 'card back art loads')
  await capture('wardrobe-panel-cards')

  // 8. An Agent turn inside the 60-second window is remembered but not counted.
  await openPrivate('小 Kun')
  const roomId = (await request(page, '/v1/agents/chat-entry')).roomId
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  await editor.fill('再说一次')
  await editor.press('Enter')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/messages?limit=20`)).messages.length >= 2, 60_000, 'Agent reply arrives')
  await poll(async () => (await request(page, `/v1/rooms/${roomId}/direct`)).activity == null, 30_000, 'Agent turn settles')
  const quiet = await request(page, '/v1/rooms/wardrobe')
  assert.equal(quiet.wardrobe.totalDrops, 12, 'No bottle inside the minimum interval')
  await page.locator('[data-room-tool="wardrobe"]').click()
  await page.locator('[data-wardrobe-panel="ready"]').waitFor()

  // 8b. Dressing my own avatar in the wardrobe updates the sidebar Kun face at once.
  const footerFace = page.locator('.ds-sidebar-kun-status .ds-sidebar-kun-face')
  const faceHtml = () => footerFace.evaluate((node) => node.innerHTML)
  const faceBefore = await faceHtml()
  await page.locator('[data-wardrobe-panel="ready"] [data-wardrobe-dress]').click()
  const mine = page.locator('.rooms-init-dialog[data-size="wide"][aria-label="我的头像"]')
  await mine.waitFor()
  await mine.getByRole('tab', { name: '套装', exact: true }).click()
  await mine.getByRole('button', { name: '侦探', exact: true }).click()
  await mine.getByRole('button', { name: '保存', exact: true }).click()
  await mine.waitFor({ state: 'hidden' })
  await poll(async () => (await faceHtml()) !== faceBefore, 15_000, 'sidebar Kun face follows my avatar')
  await capture('wardrobe-my-avatar-footer')

  // 9. The Agent studio hides unrevealed cards and applies a confirmed look at once.
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
  assert.equal(await dialog.getByRole('button', { name: '宇航头盔', exact: true }).count(), 0, 'Studio hides unowned item names')
  const unknownItems = dialog.getByRole('button', { name: '未知装备', exact: true })
  assert(await unknownItems.count() >= 5, 'Studio shows unowned items as unknown')
  assert.equal(await unknownItems.first().getAttribute('data-locked'), 'true', 'Unknown items stay locked')
  await dialog.getByRole('tab', { name: '套装', exact: true }).click()
  await dialog.getByRole('button', { name: '侦探', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await poll(async () => JSON.stringify((await request(page, `/v1/agents/${agentId}`)).agent.avatar) !== JSON.stringify(avatarBefore),
    10_000, 'confirming the studio saves the Agent avatar')
  await poll(async () => (await rowHtml()) !== rowBefore, 15_000, 'sidebar conversation row follows the new avatar')
  await capture('wardrobe-agent-avatar-applied')
  const result = { native: true, offline: true, threadId, roomId, drop: dropped, assertions: [
    'drops default on, Code tasks included; the first finished Code task of the day drops a bottle without hinting its rarity',
    'put on shelf keeps it unopened; the sidebar shelf opens the idle stage; the rail badge counts the shelf',
    'a real ten-pull opens the oldest ten through shake, light, burst and flip, with a summary and at least one rare',
    'opening one from the shelf plays the single stage and records it in the log',
    'settings switches start on and persist changes',
    'unrevealed role cards show the card back without names, in the panel and in the studio',
    'unowned items show as unknown, with no art or name, in the panel and in the studio',
    'an Agent turn inside the 60s interval does not drop; the Agent rail opens the same panel',
    'dressing my own avatar updates the sidebar Kun face at once',
    'a confirmed Agent look saves at once and the sidebar icon follows'] }
  await recordDiagnostic('wardrobe-drops', result)
  return result
}

module.exports = { exerciseWardrobeDrops }
