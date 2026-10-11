'use strict'

// Show the post-update "what's new" dialog in the real Electron renderer.
// The runner sets KUN_RELEASE_NOTICE_FROM, so the development build reports an
// upgrade from that version through Main's release-notice IPC.
const assert = require('node:assert/strict')

const OPEN_TIMEOUT_MS = 60_000

async function exerciseWhatsNew({ page, capture }) {
  const settle = (ms = 700) => page.waitForTimeout(ms)
  const dialog = page.locator('[data-whats-new-dialog]')

  await dialog.waitFor({ timeout: OPEN_TIMEOUT_MS })
  await settle()
  const variant = await dialog.getAttribute('data-whats-new-dialog')
  const title = (await dialog.locator('h2').innerText()).trim()
  await capture('whats-new-01-open')
  const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-whats-new-primary') ?? false)
  assert(focused, 'The primary action takes focus when the dialog opens')

  const fixes = dialog.locator('[data-whats-new-fixes]')
  const fixRows = await fixes.count()
  if (fixRows) {
    await fixes.click()
    await settle()
    assert.equal(await fixes.getAttribute('aria-expanded'), 'true')
    await capture('whats-new-02-fixes')
  }

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  await page.locator('[data-whats-new-hint]').waitFor()
  await settle(400)
  await capture('whats-new-03-hint')

  await page.locator('[data-whats-new-reopen]').click()
  await dialog.waitFor()
  await page.locator('[data-whats-new-primary]').click()
  await dialog.waitFor({ state: 'detached' })
  return { variant, title, fixRows }
}

module.exports = { exerciseWhatsNew }
