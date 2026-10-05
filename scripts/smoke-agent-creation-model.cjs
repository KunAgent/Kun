'use strict'
const assert = require('node:assert/strict')

/** Complete the real explicit model-confirmation step after clicking Define in chat. */
async function confirmAgentCreationModel({ page, request }) {
  const modal = page.getByRole('dialog', { name: 'Choose a model for your new Agent', exact: true })
  const choice = modal.getByRole('combobox', { name: 'Provider, account and model', exact: true })
  await choice.waitFor()
  assert.equal(await modal.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), false,
    'Conversational creation requires an explicit model choice')
  const catalog = await request(page, '/v1/agents/creation-models')
  const selected = catalog.options.find((item) => item.available && item.providerId)
  assert(selected, 'Smoke profile must expose an eligible Agent model connection')
  const key = JSON.stringify([selected.providerId, selected.accountId, selected.model])
  await choice.selectOption(key)
  assert.equal(await choice.inputValue(), key)
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  return JSON.parse(JSON.stringify({ providerId: selected.providerId, accountId: selected.accountId, model: selected.model }))
}
module.exports = { confirmAgentCreationModel }
