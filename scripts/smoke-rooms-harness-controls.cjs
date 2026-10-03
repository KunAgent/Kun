'use strict'
const assert = require('node:assert/strict')
const { writeFile, rm } = require('node:fs/promises')
const { assertRoomsHarnessDiscoveryOrder, ROOMS_HARNESS_PROFILE, ROOMS_HARNESS_MODEL } = require('./smoke-rooms-harness-fixture.cjs')
const { openAgentPrivateChat, roomWorkbenchSnapshot } = require('./smoke-agent-chat-workbench.cjs')

/** Revalidate persisted fixture consent through the real local protocol path. */
async function verifyRoomsHarnessReadiness({ page, poll, runtimeRequest }) {
  const row = async () => (await runtimeRequest(page, '/v1/harnesses?usage=code'))
    .harnesses.find((entry) => entry.definition.id === ROOMS_HARNESS_PROFILE.harnessId)
  assert.deepEqual((await row())?.enabledProfiles, [ROOMS_HARNESS_PROFILE], 'Offline Devin profile must have explicit consent')
  // Let startup revalidation finish before requesting a second check, so one
  // real probe cannot supersede the other and invalidate its in-flight proof.
  await poll(async () => !(await row())?.status.detecting, 60_000, 'offline Agent startup revalidation')
  const result = await runtimeRequest(page, '/v1/harnesses/devin/test', 'POST', {
    level: 'handshake', credentialMode: ROOMS_HARNESS_PROFILE.credentialMode, model: ROOMS_HARNESS_MODEL
  })
  assert.equal(result.readiness?.usable, true, JSON.stringify(result))
  assert.equal(result.readiness.authentication, 'unverified', 'A fixture key must not claim verified remote authentication')
  assert.equal(result.handshake?.protocol, 'acp')
  assert.equal(result.handshake?.agent?.name, 'Devin offline fixture')
  assert(result.handshake?.models?.includes(ROOMS_HARNESS_MODEL), 'The real ACP session must expose the pinned fixture model')
  assert.equal(result.trial, undefined, 'Readiness must not run a model trial')
  assert.deepEqual((await row()).readyProfiles.map(({ expiresAt: _expiresAt, ...profile }) => profile), [ROOMS_HARNESS_PROFILE])
  return result
}

/** Real rendered conversation -> catalog -> confirmation -> ACP -> durable result. */
async function runRoomsHarnessFlow({ page, capture, poll, runtimeRequest, resize, workspaceRoot, releaseFile, modelFixture }) {
  await openAgentPrivateChat({ page, switchCode: async () => {
    await page.locator('[data-workspace-mode-trigger]').first().click()
    await page.locator('[data-workspace-mode-option="chat"]').click()
  } })
  const entry = await runtimeRequest(page, '/v1/agents/chat-entry')
  assert(entry.initialized && entry.roomId)
  await runtimeRequest(page, '/v1/workbench/directory', 'PUT', { workRoots: [], codeProjects: [workspaceRoot] })
  // Show localized production UI while keeping fixture markers out of normal copy.
  await page.evaluate(async () => { const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh') })
  const send = async (text) => {
    const editor = page.locator('.rooms-composer .rooms-rich-input')
    await editor.fill(text)
    await editor.press('Enter')
  }
  await send('请用 Code 中可用的 Agent 检查任务卡片的布局 [rooms-harness-smoke]')
  const card = page.locator('.rooms-workbench-card').last()
  await card.waitFor({ timeout: 90_000 })
  await poll(async () => await card.getAttribute('data-status') === 'awaiting_confirmation', 90_000, 'Agent proposal')
  let links = (await runtimeRequest(page, `/v1/rooms/${entry.roomId}/workbench-links`)).links
  const proposed = links.find((link) => link.status === 'awaiting_confirmation')
  assert(proposed && !proposed.threadId, 'A proposal must not start an external task')
  assert.equal(proposed.request.execution.model.harnessId, 'devin')
  assertRoomsHarnessDiscoveryOrder(modelFixture.snapshot().observations)
  await card.locator('[data-workbench-agent="devin"]').waitFor()
  await poll(async () => !(await page.locator('.rooms-composer .rooms-rich-input').innerText()).trim(), 20_000, 'acknowledged composer cleared')
  await capture('rooms-01-agent-proposal')

  await card.locator('.rooms-workbench-option-summary').click()
  await card.locator('[data-composer-harness-picker]').click()
  const menu = page.locator('[data-harness-picker-menu]')
  await menu.waitFor()
  await poll(() => menu.locator('[data-harness-id="devin"]').isEnabled(), 30_000, 'available Agent in the shared picker')
  assert.equal(await menu.locator('[data-harness-id="smoke-term"]').count(), 0, 'Terminal-only entries cannot execute turns')
  await capture('rooms-02-shared-agent-picker')
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  await card.locator('button[aria-pressed="false"]:disabled').first().waitFor()
  await card.locator('.rooms-workbench-agent-picker').scrollIntoViewIfNeeded()
  assert.equal(await card.locator('.rooms-workbench-agent-warning').count(), 0, 'Native-only discovery must not request unsupported provider catalogs')
  await capture('rooms-03-execution-options')
  // Cancel must discard local edits and the selection must stay on this card only.
  await card.getByRole('button', { name: /^(Cancel editing|Cancel|取消编辑)$/u }).click()
  const before = await roomWorkbenchSnapshot(page)
  await card.locator('.rooms-workbench-actions .is-primary').click()
  const linkPath = `/v1/rooms/${entry.roomId}/workbench-links/${proposed.id}`
  await poll(async () => (await runtimeRequest(page, linkPath)).link.status === 'running', 90_000, 'ACP task running')
  await poll(async () => await card.getAttribute('data-status') === 'running', 20_000, 'rendered progress')
  assert.deepEqual(await roomWorkbenchSnapshot(page), before, 'Starting a task must preserve the selected conversation')
  await capture('rooms-04-task-running')
  await resize(960, 800)
  await capture('rooms-05-narrow-progress')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No desktop horizontal overflow')
  await writeFile(releaseFile, 'complete fixture\n')
  await poll(async () => (await runtimeRequest(page, linkPath)).link.status === 'completed', 90_000, 'durable ACP result')
  await poll(async () => await card.getAttribute('data-status') === 'completed', 20_000, 'rendered result')
  await card.locator('.rooms-workbench-result').waitFor()
  await poll(async () => (await card.locator('.rooms-workbench-result').innerText()).includes('离线验收完成'), 20_000, 'visible final outcome')
  await card.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await capture('rooms-06-task-result')
  const completed = (await runtimeRequest(page, linkPath)).link
  const thread = await runtimeRequest(page, `/v1/threads/${completed.threadId}`)
  assert.equal(thread.harnessId, 'devin')
  assert.equal(thread.agentSurface, 'code')
  assert.equal(thread.turns.length, 1, 'Single accepted proposal creates one task turn')
  assert.match(completed.result.finalExcerpt, /devin-fixture-model/u)
  assert.equal(await card.getByRole('button', { name: /^(Stop|停止)$/u }).count(), 0)
  await page.evaluate(async () => { const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark') })
  await capture('rooms-07-dark-result')
  await rm(releaseFile, { force: true })
  return [
    'Private Agent discovers the same live Code catalog before proposing an external task',
    'The real card shows persisted Agent, model, and native authentication through proposal, running, and completed states',
    'Shared Agent picker excludes terminal-only engines; Escape dismisses it; cancelling edits preserves the proposal',
    'Confirmation starts one real ACP fixture subprocess with the pinned model and preserves the conversation',
    'Actual production components render at 1360px and 960px with light/dark screenshots and no document overflow',
    'Offline model/ACP fixtures only; no paid provider or real account execution and no project modifications'
  ]
}
module.exports = { verifyRoomsHarnessReadiness, runRoomsHarnessFlow }
