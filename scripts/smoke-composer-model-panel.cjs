'use strict'

const assert = require('node:assert/strict')

/** The Code composer offers one model and reasoning control that opens one panel. */
async function exerciseComposerModelPanel({ page, poll, capture, prefix }) {
  const picker = page.locator('.ds-composer-model-picker').first()
  const trigger = picker.locator('[data-composer-model-trigger]')
  await trigger.waitFor()
  assert.equal(await picker.locator('button').count(), 1, 'Model and reasoning share one composer button')
  await capture(`${prefix}-model-trigger`)

  await trigger.click()
  const panel = page.locator('[data-composer-model-panel]')
  await panel.waitFor()
  const panelBox = await panel.boundingBox()
  const triggerBox = await trigger.boundingBox()
  assert(panelBox && triggerBox && panelBox.y + panelBox.height <= triggerBox.y + 1, 'The panel opens above the composer button')
  assert.equal(await panel.locator('[role="menuitemradio"][aria-checked="true"]').count(), 1, 'The current model is checked in the panel')
  const segments = panel.locator('[role="radiogroup"] [role="radio"]')
  if (await segments.count() > 1) {
    const target = segments.nth(1)
    const effort = await target.getAttribute('data-reasoning-effort')
    await target.click()
    await poll(async () => await trigger.getAttribute('data-reasoning-effort') === effort, 5000,
      'The reasoning segment updates the composer button')
    assert(await panel.isVisible(), 'Changing reasoning keeps the panel open for a model pick')
    assert.deepEqual(await panel.locator('.ds-composer-reasoning-segment.is-checked').evaluateAll((items) =>
      items.map((item) => item.dataset.reasoningEffort)), [effort], 'Exactly the chosen reasoning segment is selected')
    // Let the segment colour transition settle before the evidence screenshot.
    await page.waitForTimeout(300)
  }
  await capture(`${prefix}-model-panel`)
  await page.keyboard.press('Escape')
  await panel.waitFor({ state: 'detached' })
  assert(await trigger.evaluate((element) => element === document.activeElement), 'Escape returns focus to the composer button')
  return ['The composer shows one model and reasoning button whose panel sets effort and lists models']
}

module.exports = { exerciseComposerModelPanel }
