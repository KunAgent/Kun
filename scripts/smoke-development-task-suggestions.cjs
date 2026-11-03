'use strict'

const assert = require('node:assert/strict')

/**
 * Suggestion cards end to end: the fixture model calls suggest_tasks, the user
 * starts tasks from the card, task sessions nest under the conversation in the
 * sidebar, finished sessions report back, and a session opens with its banner.
 */
async function runTaskSuggestionFlow({ page, capture, poll, runtimeRequest }) {
  const checks = []
  const composer = page.locator('.ds-composer-textarea')
  await composer.waitFor()
  await composer.fill('[task-smoke-suggest] Why is first paint slow? Split the independent work for me.')
  await page.locator('.ds-composer-primary-action').click()

  let parent
  let card
  await poll(async () => {
    const list = await runtimeRequest(page, '/v1/threads?limit=100')
    parent = list.threads.find((item) => item.relation !== 'task' && item.title)
    if (!parent) return false
    const cards = await runtimeRequest(page, `/v1/task-suggestions?threadId=${encodeURIComponent(parent.id)}`)
    card = cards.taskSuggestions?.[0]
    return Boolean(card)
  }, 90_000, 'suggest_tasks card created')
  assert.equal(card.tasks.length, 3)
  assert.deepEqual(card.tasks.map((task) => task.worktree), [true, false, false])
  const cardLocator = page.locator('[data-task-suggestion-card]').first()
  await cardLocator.waitFor({ timeout: 60_000 })
  await cardLocator.scrollIntoViewIfNeeded()
  await capture('tasks-1-card-suggested')
  checks.push('The model call renders a waiting card with three rows and per-row start controls')

  await cardLocator.locator('[data-task-start="t1"]').click()
  const cardState = async () => (await runtimeRequest(page, `/v1/task-suggestions/${card.intentId}`)).taskSuggestion
  await poll(async () => (await cardState()).tasks[0].state === 'done', 120_000, 'first task session finished')
  let current = await cardState()
  const first = current.tasks[0]
  assert.ok(first.threadId, 'started row records its session')
  assert.ok(first.branch, 'worktree row records its branch')
  assert.match(first.result.summary, /Task finished/u)
  const child = await runtimeRequest(page, `/v1/threads/${first.threadId}`)
  assert.equal(child.relation, 'task')
  assert.equal(child.parentThreadId, parent.id)
  assert.deepEqual(child.taskOrigin, { intentId: card.intentId, taskId: 't1', index: 1, total: 3 })
  assert.ok(child.taskWorkspaceId, 'task session is bound to an isolated worktree')
  checks.push('Starting one row creates a nested task session in its own worktree and settles it from the first turn')

  const nested = page.locator(`[data-task-thread-children="${parent.id}"]`)
  await nested.waitFor({ timeout: 30_000 })
  assert.equal(await nested.locator('[data-task-thread-row]').count(), 1)
  await page.locator('[data-task-report="t1"]').waitFor({ timeout: 30_000 })
  await capture('tasks-2-first-done-report-and-sidebar')
  checks.push('The sidebar nests the session under its parent and the parent timeline shows a report card')

  await cardLocator.locator('[data-task-start-all]').click()
  await poll(async () => (await cardState()).state === 'settled', 120_000, 'every task session finished')
  current = await cardState()
  assert.deepEqual(current.tasks.map((task) => task.state), ['done', 'done', 'done'])
  await poll(async () => await nested.locator('[data-task-thread-row]').count() === 3, 30_000, 'three nested rows')
  await capture('tasks-3-all-settled')
  checks.push('Start all launches the remaining rows; the card settles once every session finished')

  await page.locator('[data-task-report="t2"] button').last().click()
  await poll(async () => (await cardState()).tasks[1].reportAcknowledged === true, 20_000, 'report dismissed')
  checks.push('Dismissing a report acknowledges it on the card')

  await nested.locator(`[data-task-thread-row="${first.threadId}"]`).click()
  await page.locator('[data-task-session-bar]').waitFor({ timeout: 30_000 })
  await capture('tasks-4-session-open')
  await page.locator('[data-task-session-bar] button').last().click()
  await page.locator('[data-task-suggestion-card]').first().waitFor({ timeout: 30_000 })
  checks.push('A nested row opens the task session with its banner, and the banner returns to the parent')

  await page.locator(`[data-task-group-toggle]`).first().click()
  await poll(async () => await nested.count() === 0, 10_000, 'task group collapsed')
  await page.locator('[data-task-group-chip]').first().waitFor()
  await capture('tasks-5-group-collapsed')
  checks.push('Collapsing the group hides the sessions and keeps a count chip on the parent row')
  return { checks, parentThreadId: parent.id, intentId: card.intentId }
}

module.exports = { runTaskSuggestionFlow }
