'use strict'

// The Office artifact chat panel end to end: the slide on screen travels with
// the message, a file change made while the turn runs shows up as a change
// card and rail badge, and compare and undo work through the version store.

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFile, writeFile } = require('node:fs/promises')

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function checkArtifactChatTurn({ page, capture, poll, diagnostics, timeoutMs, model, deckPath, buildChangedDeck }) {
  const panel = page.locator('[data-artifact-chat-panel="chat"]')
  await panel.waitFor({ timeout: timeoutMs })
  await panel.locator('[data-artifact-chat-empty]').waitFor({ timeout: timeoutMs })
  assert.equal(await panel.locator('[data-artifact-chat-binding="draft"]').count(), 1, 'A deck without a source conversation starts a new one')

  const rail = page.getByRole('navigation', { name: 'Slide thumbnails' })
  // The rail is virtualized and the previous check left it at the last slide.
  await rail.evaluate((node) => { node.scrollTop = 0 })
  await rail.getByRole('button', { name: 'Go to slide 3' }).click()
  await panel.getByText('Looking at: slide 3').waitFor({ timeout: timeoutMs })
  await capture('artifacts-15-chat-empty')

  const original = await readFile(deckPath)
  const composer = panel.locator('[data-floating-composer]').first()
  // Like Work, the panel composer switches between Kun and third-party Agents.
  const agentTrigger = composer.locator('[data-agent-mode-trigger]')
  await agentTrigger.waitFor({ timeout: timeoutMs })
  diagnostics.chatAgent = await agentTrigger.getAttribute('data-composer-agent')
  await agentTrigger.click()
  await page.locator('[data-agent-mode-menu] [data-agent-mode-group="external"]').waitFor({ timeout: timeoutMs })
  await capture('artifacts-15b-chat-agents')
  await page.keyboard.press('Escape')
  await composer.locator('textarea').first().fill('Make the bars on this slide wider')
  await composer.locator('.ds-composer-primary-action').click()
  // The chat turn is the request whose user message carries the attached context (title requests do not).
  const chatTurn = () => model.userTexts().find((text) => text.includes('Make the bars on this slide wider') && text.includes('Attached user context'))
  await poll(async () => Boolean(chatTurn()), timeoutMs, 'the panel message reaching the model')
  const sent = chatTurn()
  diagnostics.chatPrompt = sent.slice(0, 2_000)
  assert(sent.includes('Target file: `presentations/roadmap.pptx`'), 'The message names the artifact file')
  assert(sent.includes('The user is looking at slide 3 of 16'), 'The message carries the slide on screen')
  assert(sent.includes('"work-reference-resource"') && sent.includes('"read-write"'), 'The file travels as a writable resource')
  assert(sent.includes('"office-view-position"'), 'The slide travels as the view position')

  await page.locator('[data-artifact-stage="office"] [aria-busy="true"]').waitFor({ timeout: timeoutMs })
  await capture('artifacts-16-chat-running')
  // Stand-in for Kun's office edit: the deck changes on disk while the turn runs.
  await writeFile(deckPath, await buildChangedDeck())
  await rail.locator('[data-slide-changed="true"]').first().waitFor({ timeout: timeoutMs })
  // The reloaded deck stays on the slide the user was talking about.
  await page.locator('[data-artifact-stage="office"] .kun-pptx-toolbar').getByLabel('Slide 3 of 16', { exact: true }).waitFor({ timeout: timeoutMs })
  await panel.getByText('Looking at: slide 3').waitFor({ timeout: timeoutMs })
  model.release()

  const card = panel.locator('[data-artifact-change="presentation"]')
  await card.waitFor({ timeout: timeoutMs })
  diagnostics.chatChange = await card.innerText()
  assert(diagnostics.chatChange.includes('Kun changed slides 3'), 'The change card names the changed slide')
  assert.equal(await rail.locator('[data-slide-changed="true"]').count(), 1, 'Only slide 3 is badged')
  const transcript = await panel.innerText()
  assert(transcript.includes('Make the bars on this slide wider'), 'The timeline shows the user message')
  assert(!transcript.includes('Target file:'), 'The timeline shows the user words, not the routing line')
  await capture('artifacts-17-chat-changed')

  await card.getByRole('button', { name: 'Compare with before' }).click()
  await page.locator('[data-artifact-compare="true"]').waitFor({ timeout: timeoutMs })
  await capture('artifacts-18-chat-compare')
  await page.getByRole('button', { name: 'Back to current' }).click()
  await poll(async () => (await page.locator('[data-artifact-compare="true"]').count()) === 0, timeoutMs, 'compare closing')

  await panel.locator('[data-artifact-change="presentation"]').getByRole('button', { name: 'Undo' }).click()
  await panel.locator('[data-artifact-notice="restored"]').waitFor({ timeout: timeoutMs })
  await poll(async () => sha(await readFile(deckPath)) === sha(original), timeoutMs, 'the deck restored on disk')
  await page.locator('[data-artifact-chat-panel] [role="tab"]', { hasText: 'Versions' }).click()
  const versions = page.locator('[data-artifact-versions] li')
  await poll(async () => (await versions.count()) === 3, timeoutMs, 'current file plus two kept versions')
  diagnostics.chatVersions = await page.locator('[data-artifact-versions]').innerText()
  await capture('artifacts-19-chat-versions')
  await page.locator('[data-artifact-chat-panel] [role="tab"]', { hasText: 'Chat' }).click()
  return 'The deck chat sends the slide on screen, shows the turn\'s change with badges, compares and undoes through kept versions'
}

module.exports = { checkArtifactChatTurn }
