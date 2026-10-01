'use strict'
const assert = require('node:assert/strict')

// Uses only the disposable offline model/profile. Never clicks the external authorization button.
async function exercisePersonalAgentIm({ page, request, poll, capture, openPrivate, resize, application }) {
  await openPrivate()
  const entry = await request(page, '/v1/agents/chat-entry')
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  const proofs = []
  for (const provider of ['feishu', 'weixin']) {
    await editor.fill('IM_CONNECTION_SMOKE_' + provider + ': show the official connection proposal')
    await editor.press('Enter')
    await poll(async () => (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
      .some((message) => message.appConnection?.serverId === 'im.' + provider), 60000, provider + ' proposal from actual Agent tool')
    const card = page.locator('.rooms-im-connection-card').last()
    await card.waitFor()
    assert((await card.innerText()).includes('verified scanning account'))
    assert.equal(await card.locator('.rooms-im-qr').count(), 0, 'No QR request before explicit user action')
    for (const width of [1360, 960]) {
      await resize(width, 900)
      await card.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await capture('personal-im-' + provider + '-' + width)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Native card does not overflow')
    }
    await card.getByRole('button', { name: 'Not now', exact: true }).click()
    await poll(async () => (await card.innerText()).includes('Connection skipped'), 10000, 'skip persisted')
    await capture('personal-im-' + provider + '-skipped')
    const messages = (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
    const saved = messages.findLast((message) => message.appConnection?.serverId === 'im.' + provider)
    assert.equal(saved.appConnection.status, 'skipped')
    assert(!/deviceCode|appSecret|ownerId|qrcode/.test(JSON.stringify(saved)), 'Transcript contains only a proposal')
    await poll(async () => {
      const direct = await request(page, `/v1/rooms/${entry.roomId}/direct`)
      assert(!direct.requests.some((item) => ['failed', 'recovery_required'].includes(item.status)), JSON.stringify(direct.requests))
      return !direct.active && direct.requests.every((item) => item.status === 'completed')
    }, 60000, provider + ' skip continuation completes before the next request')
    proofs.push(provider + ': real Agent proposal, no implicit registration, durable skip, native wide/narrow screenshots')
  }
  const storage = await application.evaluate(({ safeStorage }) => {
    const available = safeStorage.isEncryptionAvailable()
    if (!available) return { available: false, plaintextFallback: false }
    const ciphertext = safeStorage.encryptString('isolated-im-credential-fixture')
    return { available: true, roundTrip: safeStorage.decryptString(ciphertext) === 'isolated-im-credential-fixture',
      encrypted: !ciphertext.toString().includes('isolated-im-credential-fixture') }
  })
  if (storage.available) { assert(storage.roundTrip); assert(storage.encrypted) }
  return { proofs, storage, liveAuthorizationAttempted: false }
}
module.exports = { exercisePersonalAgentIm }
