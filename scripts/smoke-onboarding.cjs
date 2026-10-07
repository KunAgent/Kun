'use strict'

// Walk the first-run guide in the real Electron renderer and capture each step.
// The profile starts with initialSetupCompleted=false; the DeepSeek key typed
// here is an offline fixture value, the save goes through a keyless local
// provider, and no Agent readiness check is started. The full-access default
// goes through Main's protected consent window: it is cancelled once (the
// guide must keep the stored mode and say so) and then confirmed for real.
const assert = require('node:assert/strict')

const STEP_TIMEOUT_MS = 120_000

async function exerciseOnboarding({ page, application, capture, recordDiagnostic }) {
  const settle = (ms = 900) => page.waitForTimeout(ms)
  const step = (name) => page.locator(`[data-onboarding-step="${name}"]`).waitFor({ timeout: STEP_TIMEOUT_MS })
  const primary = () => page.locator('[data-onboarding-primary]').click()

  await step('welcome')
  await settle(1200)
  await capture('onboarding-01-welcome')
  const localeChecked = await page.locator('[data-onboarding-locale][aria-checked="true"]').count()
  assert.equal(localeChecked, 1, 'Exactly one language is selected')

  await primary()
  await step('model')
  await settle()
  await capture('onboarding-02-model-featured')
  await page.locator('[data-onboarding-provider-tab="plan"]').click()
  await settle(600)
  await capture('onboarding-02-model-plans')
  await page.locator('[data-onboarding-provider-search]').fill('ollama')
  await settle(500)
  await capture('onboarding-02-model-search')
  await page.locator('[data-onboarding-provider="ollama-local"]').click()
  await primary()
  await page.locator('[data-onboarding-base-url]').waitFor()
  await settle()
  await capture('onboarding-03-model-local')
  await page.locator('[data-onboarding-change-provider]').click()
  await page.locator('[data-onboarding-provider-search]').fill('')
  await page.locator('[data-onboarding-provider-tab="login"]').click()
  await page.locator('[data-onboarding-provider="codex"]').click()
  await primary()
  await page.locator('[data-onboarding-login="codex"]').waitFor()
  await settle()
  await capture('onboarding-03-model-login')
  await page.locator('[data-onboarding-change-provider]').click()
  await page.locator('[data-onboarding-provider-tab="featured"]').click()
  await page.locator('[data-onboarding-provider="xiaomi"]').click()
  await primary()
  await page.locator('[data-onboarding-mode="token-plan"]').click()
  await settle()
  await capture('onboarding-03-model-token-plan')
  await page.locator('[data-onboarding-change-provider]').click()
  await page.locator('[data-onboarding-provider="deepseek"]').click()
  await primary()
  await page.locator('[data-onboarding-key]').fill('sk-onboarding-offline-fixture')
  await settle()
  await capture('onboarding-03-model-key')
  await page.locator('[data-onboarding-key]').fill('')
  // Saving a typed key writes the OS secret store, which cannot run under the
  // isolated HOME; finish the walk with a keyless local server instead.
  await page.locator('[data-onboarding-change-provider]').click()
  await page.locator('[data-onboarding-provider-search]').fill('ollama')
  await page.locator('[data-onboarding-provider="ollama-local"]').click()
  await primary()
  await page.locator('[data-onboarding-manual-model]').fill('qwen3:8b')
  await page.locator('[data-onboarding-manual-model]').press('Tab')

  await primary()
  await step('permission')
  await settle()
  await capture('onboarding-04-permission')
  const fullAccess = await page.locator('[data-onboarding-permission="full-access"]').getAttribute('aria-checked')
  assert.equal(fullAccess, 'true', 'Full access is the first-run default')

  const consent = async () => {
    const opened = application.waitForEvent('window', { timeout: STEP_TIMEOUT_MS })
    await primary()
    const dialog = await opened
    await dialog.locator('[data-protected-confirmation]').waitFor()
    await page.waitForTimeout(400)
    return dialog
  }
  const declined = await consent()
  const prompt = await declined.evaluate(() => ({
    rows: document.querySelectorAll('#changes .change').length,
    brandHidden: document.getElementById('brand')?.hidden === true,
    gap: Math.round(document.querySelector('footer').getBoundingClientRect().top -
      document.getElementById('action-card').getBoundingClientRect().bottom),
    height: window.innerHeight
  }))
  assert(prompt.rows >= 1, 'The prompt lists the permission changes as rows')
  assert(prompt.gap < 48, `The prompt fits its content (gap ${prompt.gap}px)`)
  await capture('onboarding-04b-permission-consent', declined)
  await Promise.all([declined.waitForEvent('close'), declined.locator('#cancel').click()])
  await page.locator('[data-onboarding-permission-declined]').waitFor({ timeout: STEP_TIMEOUT_MS })
  const kept = await page.locator('[data-onboarding-permission="ask-for-approval"]').getAttribute('aria-checked')
  assert.equal(kept, 'true', 'A cancelled prompt keeps the stored mode selected')
  await settle(500)
  await capture('onboarding-04c-permission-declined')
  await page.locator('[data-onboarding-permission="full-access"]').click()
  const accepted = await consent()
  await Promise.all([accepted.waitForEvent('close'), accepted.locator('#confirm').click()])
  await step('agents')
  // Detection is real (PATH lookups); give it a moment to settle.
  await page.waitForFunction(() => !document.querySelector('.kun-onb-radar-sweep'), null, { timeout: 45_000 }).catch(() => undefined)
  await settle(1500)
  await capture('onboarding-05-agents')
  const agents = await page.locator('[data-onboarding-agent]').evaluateAll((nodes) =>
    nodes.map((node) => ({ id: node.getAttribute('data-onboarding-agent'), state: node.getAttribute('data-state') })))

  await primary()
  await step('ready')
  await settle(1400)
  await capture('onboarding-06-ready')
  const summary = await page.locator('[data-onboarding-summary]').allInnerTexts()
  await recordDiagnostic('onboarding', { agents, summary, prompt })
  return { agents, summary, prompt }
}

module.exports = { exerciseOnboarding }
