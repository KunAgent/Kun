'use strict'
const assert = require('node:assert/strict')

// Part of smoke-wardrobe-drops: the full-page wardrobe opened from the sidebar account card's menu.
// `shelf` runs on a Code task with 12 bottles waiting; `dress` runs from an Agent chat whose
// right rail shows the wardrobe panel.
async function exerciseWardrobePage({ page, request, poll, capture, stage }) {
  const card = page.locator('[data-kun-account-card]')
  const close = page.locator('[data-wardrobe-page] [data-wardrobe-close]')
  const view = page.locator('[data-wardrobe-page]')
  const profile = async () => (await request(page, '/v1/rooms/user-profile')).profile.avatar
  const imagesLoaded = (selector) => page.locator(selector).evaluateAll((images) =>
    images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0))

  if (stage === 'dress') {
    await page.locator('[data-wardrobe-panel="ready"] [data-wardrobe-dress]').click()
    await view.waitFor({ timeout: 30_000 })
    const face = page.locator('[data-kun-account-card] .kun-account-card-face')
    const faceBefore = await face.evaluate((node) => node.innerHTML)
    await view.locator('[data-wardrobe-tab="cards"]').click()
    const lit = view.locator('[data-wardrobe-card="detective"]')
    await (await lit.count() ? lit : view.locator('[data-wardrobe-card]:not([data-wardrobe-card="unknown"])').first()).click()
    await view.locator('[data-wardrobe-sheet] .kun-wardrobe-sheet-action').click()
    await poll(async () => (await face.evaluate((node) => node.innerHTML)) !== faceBefore, 15_000, 'sidebar Kun face follows the set worn on the page')
    await poll(async () => (await profile())?.kind === 'composed', 10_000, 'the set is saved as my avatar')
    await capture('wardrobe-page-set-worn')
    await close.click()
    await view.waitFor({ state: 'detached' })
    await page.locator('.rooms-composer').waitFor()
    return
  }

  // Open from the account card's menu: the page takes the stage and the card shows it is selected.
  await card.locator('[data-kun-account-login]').click()
  await page.locator('.kun-account-panel [data-kun-account-nav="items"]').click()
  await view.waitFor({ timeout: 30_000 })
  await page.locator('.kun-account-panel').waitFor({ state: 'detached' })
  assert.equal(await card.getAttribute('data-active'), 'true')
  await view.locator('[data-wardrobe-shelf="12"]').waitFor()
  assert.equal(await view.locator('[data-shelf-open="ten"]').isDisabled(), false, 'Twelve bottles allow a ten-pull')
  const ten = await view.locator('[data-shelf-open="ten"]').boundingBox()
  assert(ten && ten.height < 40, `The ten-pull button stays on one line: ${JSON.stringify(ten)}`)
  assert(await view.locator('[data-wardrobe-item="unknown"]').count() > 30, 'Unowned items show as unknown')
  assert.equal(await view.getByText('宇航头盔', { exact: true }).count(), 0, 'Unowned item names stay hidden')
  const overflow = await view.locator('.kun-wardrobe-body').evaluate((node) => node.scrollWidth - node.clientWidth)
  assert(overflow <= 1, `The page never scrolls sideways: ${overflow}`)
  await poll(() => imagesLoaded('[data-wardrobe-page] .kun-wardrobe-tile-well img'), 15_000, 'item art loads')
  await capture('wardrobe-page-items')

  // Hover tries on; a click wears it at once and syncs; undo puts the old look back.
  const before = JSON.stringify(await profile())
  const tile = view.locator('[data-wardrobe-item]:not([data-wardrobe-item="unknown"]):not([data-worn])').first()
  const key = await tile.getAttribute('data-wardrobe-item')
  await tile.hover()
  await view.locator('.kun-wardrobe-trying').waitFor()
  await poll(() => imagesLoaded('[data-wardrobe-figure]'), 15_000, 'the fitting room shows the try-on')
  await capture('wardrobe-page-try-on')
  await tile.click()
  const [category, id] = key.split('/')
  await poll(async () => (await profile())?.parts?.[category] === id, 10_000, 'a click wears the item as my avatar')
  await view.locator(`[data-wardrobe-item="${key}"][data-worn]`).waitFor()
  await page.locator('.kun-wardrobe-toast [data-wardrobe-undo]').waitFor()
  await page.mouse.move(10, 10)
  await capture('wardrobe-page-worn')
  await page.locator('.kun-wardrobe-toast [data-wardrobe-undo]').click()
  await poll(async () => JSON.stringify(await profile()) === before, 10_000, 'undo restores the previous look')

  // The other tabs and the drop settings popover.
  await view.locator('[data-wardrobe-tab="cards"]').click()
  assert(await view.locator('[data-wardrobe-card="unknown"]').count() >= 20, 'Unrevealed role cards stay face down')
  assert.equal(await view.getByText('宇航员', { exact: true }).count(), 0, 'Unrevealed card names stay hidden')
  await poll(() => imagesLoaded('[data-wardrobe-page] .kun-holo-back img'), 15_000, 'card backs load')
  await capture('wardrobe-page-cards')
  await view.locator('[data-wardrobe-tab="look"]').click()
  await view.locator('[data-wardrobe-look="scene-sunset-bay"]').hover()
  await view.locator('.kun-wardrobe-trying').waitFor()
  await poll(() => imagesLoaded('[data-wardrobe-page] .kun-wardrobe-scenes img'), 15_000, 'scene thumbnails load')
  await capture('wardrobe-page-look')
  await view.locator('[data-wardrobe-tab="log"]').click()
  await view.locator('[data-wardrobe-settings]').click()
  const settings = view.locator('.kun-wardrobe-popover')
  assert.equal(await settings.locator('[data-wardrobe-setting="drops"]').getAttribute('aria-checked'), 'true')
  await capture('wardrobe-page-settings')
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'detached' })

  // Dark theme, then back.
  await page.locator('button[title="切换到深色主题"]').first().click()
  await view.locator('[data-wardrobe-tab="items"]').click()
  await page.waitForTimeout(300)
  await capture('wardrobe-page-dark')
  await page.locator('button[title="切换到浅色主题"]').first().click()

  // The page's close button goes back to the Code task.
  await close.click()
  await view.waitFor({ state: 'detached' })
  assert.equal(await card.getAttribute('data-active'), null)
  await page.locator('.ds-composer-textarea').waitFor()
}

module.exports = { exerciseWardrobePage }
