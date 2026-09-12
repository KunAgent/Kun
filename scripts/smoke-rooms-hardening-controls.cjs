'use strict'
const assert = require('node:assert/strict')
const NAME = 'Rooms hardening checks'
const QUESTION = 'ROOM_HARDENING_REQUEST: ask for a choice, then answer without changing files.'
const ANSWER = 'CONFIRMED_HARDENING_ANSWER: use the conservative compatibility option.'
async function exerciseRoomHardening({ page, request, switchMode, poll, capture, fixture }) {
  const { room } = await request(page, '/v1/rooms', 'POST', { clientRequestId: 'hardening-room',
    name: NAME, collaborationMode: 'directed' })
  const seed = await request(page, '/v1/rooms/' + room.id + '/messages', 'POST', {
    clientRequestId: 'long-agreement-source', executionIntent: 'discussion',
    body: 'ROOM_HARDENING_RULE: ' + 'Keep limit 12. Never upload secrets. Exception: local fixtures only. '.repeat(260)
  })
  await poll(async () => (await request(page, '/v1/rooms/' + room.id + '/requests/' + seed.requestId)).request.status === 'completed',
    30000, 'read-only agreement source discussion')
  const { rule } = await request(page, '/v1/rooms/' + room.id + '/rules', 'POST', {
    clientRequestId: 'pin-long-rule', messageId: seed.message.id })
  await page.getByRole('button', { name: new RegExp(NAME) }).click()
  await page.getByRole('heading', { name: NAME, exact: true }).waitFor()
  await page.evaluate(async ({ roomId }) => {
    const { rendererRuntimeClient: client } = await import('/src/agent/runtime-client.ts')
    const original = client.runtimeRequest.bind(client)
    const state = { attempts: 0, failures: 0 }
    globalThis.__roomsHardeningFault = state
    globalThis.__roomsHardeningRestore = () => { client.runtimeRequest = original }
    client.runtimeRequest = async (path, method, ...rest) => {
      if (method === 'GET' && path.startsWith('/v1/rooms/' + roomId + '/requests/')) {
        state.attempts++
        if (!state.failures) {
          state.failures++
          return { ok: false, status: 503, body: '{"message":"Injected transient request detail failure"}' }
        }
      }
      return original(path, method, ...rest)
    }
  }, { roomId: room.id })
  await page.getByLabel('Automatic intent', { exact: true }).selectOption('discussion')
  await page.getByRole('textbox', { name: 'Discuss a question or describe the work to do…' }).fill(QUESTION)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await switchMode(page, 'write')
  let original
  await poll(async () => {
    original = (await request(page, '/v1/rooms/' + room.id + '/requests')).requests.find((item) => item.message.body === QUESTION)
    assert(!original || original.status !== 'failed', original?.error)
    return original?.status === 'needs_input'
  }, 90000, 'automatic compression and request clarification')
  await poll(() => page.evaluate(() => globalThis.__roomsHardeningFault.attempts >= 2), 15000, 'notification retry without a new request event')
  const fault = await page.evaluate(() => ({ ...globalThis.__roomsHardeningFault }))
  assert.equal(fault.failures, 1)
  const snapshot = await request(page, '/v1/rooms/' + room.id + '/requests/' + original.id)
  assert.equal(snapshot.context.agreements.compressed, true)
  assert.equal(snapshot.context.agreements.count, 1)
  assert(fixture.snapshot().compressionRequests > 0)
  const compressionCalls = fixture.snapshot().compressionRequests
  await switchMode(page, 'rooms')
  await page.getByRole('heading', { name: NAME, exact: true }).waitFor()
  const overview = page.getByRole('region', { name: 'Room overview', exact: true })
  await overview.getByRole('button', { name: /^Requests/ }).click()
  const card = overview.locator('article').filter({ hasText: QUESTION })
  await card.getByRole('button', { name: 'Request context and agreements', exact: true }).click()
  await card.getByText('Project agreements automatically compressed', { exact: false }).waitFor()
  await card.getByRole('button', { name: 'View original agreements', exact: true }).click()
  await card.getByText(rule.id + ' · v1', { exact: true }).click()
  await poll(async () => (await card.innerText()).includes('ROOM_HARDENING_RULE'), 10000, 'original agreement text hydration')
  await capture('hardening-compressed-agreements')
  await card.getByRole('button', { name: 'Add information and continue', exact: true }).click()
  await card.getByRole('textbox', { name: 'Discuss a question or describe the work to do…' }).fill(ANSWER)
  await card.getByRole('button', { name: 'Send', exact: true }).click()
  await poll(async () => (await request(page, '/v1/rooms/' + room.id + '/requests/' + original.id)).request.status === 'completed',
    30000, 'continued original request')
  const continued = (await request(page, '/v1/rooms/' + room.id + '/requests/' + original.id)).request
  assert.equal(continued.id, original.id)
  assert.equal(continued.continuation, 1)
  assert(continued.message.body.includes(QUESTION) && continued.message.body.includes(ANSWER))
  assert.equal((await request(page, '/v1/rooms/' + room.id + '/tasks')).tasks.length, 0)
  assert.equal(fixture.snapshot().compressionRequests, compressionCalls)
  await card.getByText('Completed', { exact: true }).first().waitFor({ timeout: 5000 })
  await capture('hardening-request-continued')
  await page.getByRole('textbox', { name: 'Discuss a question or describe the work to do…' }).fill('ROOM_HARDENING_STOP: discuss until explicitly stopped.')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await poll(() => fixture.snapshot().stoppingRequests > 0, 30000, 'live coordination before stop')
  const stoppedCard = overview.locator('article').filter({ hasText: 'ROOM_HARDENING_STOP' })
  await stoppedCard.getByRole('button', { name: 'Stop this coordination', exact: true }).click()
  await poll(async () => (await request(page, '/v1/rooms/' + room.id + '/requests')).requests.some((item) =>
    item.message.body.includes('ROOM_HARDENING_STOP') && ['stopping', 'cancelled', 'recovery_required'].includes(item.status)), 10000, 'persisted stop intent')
  fixture.releaseCoordination()
  await poll(async () => (await request(page, '/v1/rooms/' + room.id + '/requests')).requests.some((item) =>
    item.message.body.includes('ROOM_HARDENING_STOP') && item.status === 'cancelled'), 30000, 'durable coordination stop')
  await capture('hardening-request-stopped')
  await page.evaluate(() => globalThis.__roomsHardeningRestore?.())
  return { roomId: room.id, requestId: original.id, compressionCalls, continuedSameRequest: true,
    cancellationConfirmed: true, notificationDetailAttempts: fault.attempts, injectedReadFailures: fault.failures }
}
module.exports = { exerciseRoomHardening }
