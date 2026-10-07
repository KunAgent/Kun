'use strict'

const assert = require('node:assert/strict')

/** Desktop-only visual coverage. The native app's supported minimum is 960px. */
async function runUnifiedCodeVisuals({ page, capture, poll, runtimeRequest, resize }) {
  const composer = page.locator('.ds-composer-textarea')
  await composer.waitFor()
  const modelTrigger = page.locator('[data-composer-model-trigger]').first()
  await poll(() => modelTrigger.isEnabled(), 30_000, 'Code composer ready')
  await page.locator('#chat-empty-hero-title').waitFor()
  for (const [width, height] of [[1360, 900], [1280, 800], [960, 800]]) {
    await resize(width, height)
    await capture(`visual-home-${width}`)
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
    assert(fits, `Desktop document overflows at ${width}px`)
  }

  await modelTrigger.click()
  await page.locator('[data-composer-model-panel]').waitFor()
  assert.equal(await page.locator('[data-model-agent-section]').count(), 0)
  await capture('visual-model-menu-960')
  await page.keyboard.press('Escape')
  await page.locator('[data-agent-mode-trigger]').click()
  const agents = page.locator('[data-agent-mode-menu]')
  await agents.waitFor()
  await agents.locator('[data-agent-mode-option="kun-design"]').waitFor()
  const devinChoice = agents.locator('[data-agent-mode-option="devin"]')
  await poll(() => devinChoice.isEnabled(), 30_000, 'Devin fixture ready for the Agent menu')
  await capture('visual-agent-choices-960')
  await page.keyboard.press('Escape')

  const before = await runtimeRequest(page, '/v1/threads?limit=100')
  await composer.fill('Reply with a brief hello.')
  await page.locator('.ds-composer-primary-action').click()
  await poll(async () => {
    const current = await runtimeRequest(page, '/v1/threads?limit=100')
    return current.threads.length === before.threads.length + 1
  }, 60_000, 'visual fixture creating one Code task')
  await page.getByRole('button', { name: /^(Task settings|当前任务设置)$/u }).click()
  const taskDrawer = page.getByRole('dialog', { name: /^(Task settings|当前任务设置)$/u })
  await taskDrawer.getByRole('spinbutton').first().waitFor()
  await capture('visual-task-settings-960')
  await taskDrawer.getByRole('button', { name: /^(Close|关闭)$/u }).click()

  await page.locator('[data-workbench-left-sidebar]').getByRole('button', { name: /Settings|设置/u }).click()
  await page.locator('[data-settings-category="agents"]').click()
  await page.locator('#agents-settings-tab-harnesses').click()
  const harnessPanel = page.locator('#agents-settings-panel-harnesses')
  await harnessPanel.locator('[data-agent-list-id="claude-code"]').click()
  await harnessPanel.locator('[data-agent-card="claude-code"]').waitFor()
  await capture('visual-agent-center-960')
  await harnessPanel.locator('[data-agent-list-id="devin"]').click()
  const devinCard = harnessPanel.locator('[data-agent-card="devin"]')
  await devinCard.locator('[data-agent-icon="devin"]').waitFor()
  await devinCard.getByRole('button', { name: /^(Log in|Sign in|登录)$/u }).waitFor()
  await capture('visual-devin-settings-960')
  await page.locator('#agents-settings-tab-collaboration').click()
  const collaboration = page.locator('#agents-settings-panel-collaboration')
  await poll(() => collaboration.getByRole('spinbutton').first().isEnabled(), 20_000, 'collaboration settings loaded')
  await capture('visual-collaboration-settings-960')
  await page.locator('#agents-settings-tab-project').click()
  await page.locator('#agents-settings-panel-project').getByRole('checkbox').first().waitFor()
  await capture('visual-project-settings-960')
  return [
    'Code home inspected at 1360, 1280, and minimum 960px native desktop widths',
    'Kun Code/Design and external Agents share the original mode entry; model/source menu remains separate',
    'Task settings, Agent list/detail including Devin login, collaboration defaults, and project defaults rendered at 960px',
    'This run uses isolated offline model and Agent fixtures; it is not a real provider trial or mobile test'
  ]
}

module.exports = { runUnifiedCodeVisuals }
