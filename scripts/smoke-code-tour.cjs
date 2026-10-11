'use strict'
const assert = require('node:assert/strict')

// Runs inside smoke-development-direct-chat's disposable profile (--code-tour-only):
// Code's first-open tour. Welcome card → every spotlight step over the real
// sidebar and home composer → ways to begin → the replay hint → replay and Esc.

/** Spot and target in client pixels; the spot must wrap the target's top-left corner. */
async function spotCoversTarget(page, selector) {
  return page.evaluate((targetSelector) => {
    const spot = document.querySelector('.code-tour-spot')?.getBoundingClientRect()
    const target = document.querySelector(targetSelector)?.getBoundingClientRect()
    if (!spot || !target) return { ok: false }
    const ok = spot.left <= target.left + 1 && spot.top <= target.top + 1 &&
      spot.right >= Math.min(target.right, window.innerWidth) - 1
    return { ok, spot: [spot.left, spot.top, spot.width, spot.height], target: [target.left, target.top, target.width, target.height] }
  }, selector)
}

const STEP_TARGETS = {
  newTask: '.sidebar-primary-actions',
  projects: '[data-sidebar-section="projects"]',
  where: '[data-primary-floating-composer] [data-composer-workspace-controls]',
  controls: '[data-primary-floating-composer] .ds-composer-toolbar',
  chats: '.sidebar-agent-chats'
}

async function exerciseCodeTour({ page, capture, resize }) {
  const result = { steps: [] }
  await resize(1440, 900)
  assert.equal(await page.evaluate(() => localStorage.getItem('kun.code.tour.v1')), null, 'tour not seen yet')
  // A profile that skipped first-run setup never greets on its own.
  await page.waitForTimeout(3_000)
  assert.equal(await page.locator('.code-tour-welcome').count(), 0, 'no tour without first-run setup')
  // What finishing first-run setup leaves behind, then the next launch.
  await page.evaluate(() => { localStorage.setItem('kun.code.tour.pending', '1'); location.reload() })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor({ timeout: 60_000 })

  const welcome = page.locator('.code-tour-welcome')
  await welcome.waitFor({ timeout: 60_000 })
  await page.waitForTimeout(700)
  result.welcomeProject = await page.locator('.code-tour-project-name').innerText()
  assert.ok(result.welcomeProject.length > 0, 'welcome names the project')
  await capture('tour-01-welcome')

  await welcome.locator('[data-code-tour-primary]').click()
  for (let index = 0; index < 8; index += 1) {
    const pop = page.locator('.code-tour-pop')
    await pop.waitFor()
    await page.waitForTimeout(600)
    const id = await pop.getAttribute('data-code-tour-step')
    const cover = await spotCoversTarget(page, STEP_TARGETS[id])
    assert.ok(cover.ok, `spot covers the ${id} target: ${JSON.stringify(cover)}`)
    result.steps.push({ id, ...cover })
    await capture(`tour-02-step-${index + 1}-${id}`)
    await pop.locator('[data-code-tour-primary]').click()
    if (await page.locator('.code-tour-done').count()) break
  }
  assert.deepEqual(result.steps.map((step) => step.id), ['newTask', 'projects', 'where', 'controls', 'chats'])

  await page.locator('.code-tour-done').waitFor()
  await page.waitForTimeout(500)
  await capture('tour-03-done')
  await page.locator('[data-code-tour-starter="explain"]').click()
  await page.locator('.code-tour-done').waitFor({ state: 'detached' })
  const composer = page.locator('[data-primary-floating-composer] textarea').first()
  result.prefilled = await composer.inputValue()
  assert.ok(result.prefilled.length > 10, 'the explain starter fills the composer')
  assert.equal(await page.evaluate(() => localStorage.getItem('kun.code.tour.v1')), '1', 'closing remembers the tour')
  await page.locator('.code-tour-hint').waitFor()
  await capture('tour-04-hint')
  await composer.fill('')

  await page.locator('[data-code-tour-replay]').first().click()
  await welcome.waitFor()
  await page.keyboard.press('Escape')
  await welcome.waitFor({ state: 'detached' })
  return result
}

module.exports = { exerciseCodeTour }
