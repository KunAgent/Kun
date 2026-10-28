'use strict'
const assert = require('node:assert/strict')

// Runs inside smoke-development-direct-chat's disposable profile (--guided-tours-only):
// the overview tour after first-run setup → pick Work on its last card → the Work tour →
// switching to 对话 starts its tour → the ? list replays the Code tour → Esc.
// Every card must sit next to a real control, with the spotlight around that control.

/** Spot and target in client pixels; the spot must wrap the target's top-left corner. */
async function spotCoversTarget(page) {
  return page.evaluate(() => {
    const pop = document.querySelector('.guided-tour-pop')
    const spot = document.querySelector('.guided-tour-spot')?.getBoundingClientRect()
    const id = pop?.getAttribute('data-guided-tour-step')
    const tour = pop?.getAttribute('data-guided-tour')
    return { tour, id, spot: spot ? [spot.left, spot.top, spot.width, spot.height] : null }
  })
}

async function walkTour({ page, capture, tour, prefix }) {
  const steps = []
  const pop = page.locator(`.guided-tour-pop[data-guided-tour="${tour}"]`)
  for (let index = 0; index < 14; index += 1) {
    await pop.waitFor({ timeout: 30_000 })
    await page.waitForTimeout(650)
    const state = await spotCoversTarget(page)
    assert.ok(state.spot, `${tour} ${state.id} has a spotlight`)
    const hidden = await pop.evaluate((node) => getComputedStyle(node).visibility === 'hidden')
    assert.equal(hidden, false, `${tour} ${state.id} card is placed`)
    steps.push(state.id)
    await capture(`${prefix}-${String(index + 1).padStart(2, '0')}-${state.id}`)
    if (await pop.evaluate((node) => node.classList.contains('is-last'))) break
    await pop.locator('[data-guided-tour-primary]').click()
  }
  return steps
}

async function exerciseGuidedTours({ page, capture, resize }) {
  const result = {}
  await resize(1440, 900)
  // A profile that skipped first-run setup never greets on its own.
  await page.waitForTimeout(3_500)
  assert.equal(await page.locator('.guided-tour-pop').count(), 0, 'no tour without first-run setup')
  // What finishing first-run setup leaves behind, then the next launch.
  await page.evaluate(() => { localStorage.setItem('kun.tour.overview.pending', '1'); location.reload() })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor({ timeout: 60_000 })

  result.overview = await walkTour({ page, capture, tour: 'overview', prefix: 'tour-a-overview' })
  assert.deepEqual(result.overview.slice(0, 4), ['intro', 'code', 'work', 'chats'])
  assert.equal(result.overview.at(-1), 'help')

  // Pick Work on the overview's last card: the app switches and the Work tour starts there.
  await page.locator('[data-guided-tour-pick="work"]').click()
  result.work = await walkTour({ page, capture, tour: 'work', prefix: 'tour-b-work' })
  assert.equal(result.work[0], 'intro')
  assert.ok(['sessions', 'files', 'composer'].every((id) => result.work.includes(id)), `work steps ${result.work}`)
  await page.locator('.guided-tour-pop [data-guided-tour-primary]').click()
  await page.locator('.guided-tour-pop').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => localStorage.getItem('kun.work.tour.v1')), '1', 'closing remembers the Work tour')
  await page.locator('[data-guided-tour-hint]').waitFor()
  await capture('tour-c-hint')

  // First visit to 对话: its own tour starts.
  await page.locator('.kun-mode-tab[data-workspace-mode="chats"]').click()
  result.chats = await walkTour({ page, capture, tour: 'chats', prefix: 'tour-d-chats' })
  assert.equal(result.chats.at(-1), 'bot')
  assert.ok(await page.locator('.guided-tour-compare').isVisible(), 'the last card compares 对话 with an IM bot')
  await page.keyboard.press('Escape')
  await page.locator('.guided-tour-pop').waitFor({ state: 'detached' })

  // The ? list shows what was seen and replays the Code tour in Code.
  await page.locator('[data-guided-tours-button] button').click()
  const hub = page.locator('[data-guided-tour-hub]')
  await hub.waitFor()
  await page.waitForTimeout(300)
  await capture('tour-e-hub')
  result.hubSeen = await hub.locator('[data-seen="true"]').count()
  assert.equal(result.hubSeen, 3, 'overview, Work and 对话 are marked seen')
  await hub.locator('[data-guided-tour-run="code"]').click()
  await page.locator('.guided-tour-pop[data-guided-tour="code"]').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)
  await capture('tour-f-code-intro')
  await page.keyboard.press('Escape')
  await page.locator('.guided-tour-pop').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => localStorage.getItem('kun.code.tour.v2')), '1', 'Esc remembers the Code tour')
  return result
}

module.exports = { exerciseGuidedTours }
