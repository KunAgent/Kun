'use strict'
const assert = require('node:assert/strict')

// Uses only the disposable offline model/profile. Never clicks the external authorization button.
async function exercisePersonalAgentIm({ page, request, poll, capture, openPrivate, resize }) {
  await openPrivate()
  const entry = await request(page, '/v1/agents/chat-entry')
  const editor = page.locator('.rooms-composer .rooms-rich-input')
  const proofs = []
  for (const provider of ['feishu', 'weixin']) {
    process.stdout.write('[personal-im-smoke] Requesting ' + provider + ' proposal\n')
    await editor.fill('IM_CONNECTION_SMOKE_' + provider + ': show the official connection proposal')
    await editor.press('Enter')
    await poll(async () => (await request(page, `/v1/rooms/${entry.roomId}/messages`)).messages
      .some((message) => message.appConnection?.serverId === 'im.' + provider), 60000, provider + ' proposal from actual Agent tool')
    // The durable tool result can arrive before React has rendered its card.
    // Bind the provider identity instead of reusing the previous card's node.
    const card = page.getByRole('region', { name: provider === 'feishu' ? 'Connect Feishu / Lark' : 'Connect WeChat', exact: true }).last()
    await card.waitFor()
    process.stdout.write('[personal-im-smoke] Capturing ' + provider + ' native card\n')
    assert((await card.innerText()).includes('verified scanning account'))
    assert.equal(await card.locator('.rooms-im-qr').count(), 0, 'No QR request before explicit user action')
    for (const width of [1360, 960]) {
      await resize(width, 900)
      await card.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await capture('personal-im-' + provider + '-' + width)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Native card does not overflow')
    }
    await card.getByRole('button', { name: 'Not now', exact: true }).click()
    process.stdout.write('[personal-im-smoke] Waiting for ' + provider + ' Skip continuation\n')
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
  process.stdout.write('[personal-im-smoke] Both provider cards passed\n')
  return { proofs, liveAuthorizationAttempted: false }
}

// Separate launch/evidence from UI smoke: an interactive OS keychain can block
// this probe, but must not prevent retaining successful card screenshots.
async function exercisePersonalAgentImStorage({ application }) {
  const host = await application.evaluate(({ app }) => ({ ready: app.isReady(), processType: process.type, electron: process.versions.electron }))
  process.stdout.write('[personal-im-storage] Main-process state: ' + JSON.stringify(host) + '\n')
  assert(host.ready && host.processType === 'browser', 'Storage must run in the ready Electron main process')
  process.stdout.write('[personal-im-storage] Checking actual OS safeStorage\n')
  const availability = application.evaluate(({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable())
  const responsive = await application.evaluate(() => new Promise((resolve) => setTimeout(() => resolve(true), 10)))
  assert(responsive, 'The Electron main thread remains responsive during Keychain initialization')
  const available = await availability
  process.stdout.write('[personal-im-storage] OS encryption availability: ' + available + '\n')
  assert(available, 'OS credential store is unavailable; real credential protection remains unverified')
  const storage = await application.evaluate(async ({ safeStorage }) => {
    const ciphertext = await safeStorage.encryptStringAsync('isolated-im-credential-fixture')
    const decoded = await safeStorage.decryptStringAsync(ciphertext)
    return { available: true, roundTrip: decoded.result === 'isolated-im-credential-fixture',
      encrypted: !ciphertext.toString().includes('isolated-im-credential-fixture'),
      syncCompatibleEnvelope: ['v10', 'v11'].includes(ciphertext.subarray(0, 3).toString('ascii')) }
  })
  process.stdout.write('[personal-im-storage] OS safeStorage fixture: ' + JSON.stringify(storage) + '\n')
  assert(storage.roundTrip); assert(storage.encrypted); assert(storage.syncCompatibleEnvelope)
  return { storage, liveAuthorizationAttempted: false }
}
module.exports = { exercisePersonalAgentIm, exercisePersonalAgentImStorage }
