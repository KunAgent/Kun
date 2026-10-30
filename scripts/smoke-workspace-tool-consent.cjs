'use strict'
const assert = require('node:assert/strict')

// 08c32b338 made the trusted inline card the tool confirmation. Permission
// changes still use a protected window; tool approvals must not wait for one.
async function allowWorkspaceTool({ page, request, poll, capture, roomId, expected, label }) {
  const activity = () => request(page, `/v1/rooms/${roomId}/direct`)
  const before = await activity()
  assert.equal(before.approvals.length, 1, 'Only the expected workspace approval may be pending')
  const approval = before.approvals[0]
  assert(approval.id && approval.threadId && approval.turnId && before.active?.id && before.active.runId,
    'Approval has an admitted request, thread and turn')
  assert.equal(approval.threadId, before.active.threadId)
  assert.equal(approval.turnId, before.active.turnId)
  assert.equal(approval.status, 'pending')
  assert.equal(approval.toolName, expected.toolName)
  assert.deepEqual(approval.action?.arguments, expected.arguments, 'Consent is limited to the exact fixture action')
  // The renderer bridge deliberately excludes /v1/approvals/:id. Read the
  // canonical approval item through the existing, run-scoped inspector instead.
  const base = `/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(before.active.runId)}`
  const run = (await request(page, base)).run
  assert.equal(run.id, before.active.runId)
  assert.equal(run.roomId, roomId)
  assert.equal(run.requestId, before.active.id)
  assert.equal(run.threadId, approval.threadId)
  assert.equal(run.turnId, approval.turnId)
  const itemsPath = base + '/items?limit=100&max_bytes=262144'
  const matchingItem = (result) => {
    assert.equal(result.availability?.status, 'available', 'Canonical approval history must be available')
    const matches = result.items.filter((item) => item.kind === 'approval' && item.approvalId === approval.id)
    assert.equal(matches.length, 1, 'The exact approval item must exist; disappearance is not consent')
    const item = matches[0]
    assert.equal(item.threadId, approval.threadId)
    assert.equal(item.turnId, approval.turnId)
    assert.equal(item.toolName, approval.toolName)
    assert.deepEqual(item.action, approval.action)
    return item
  }
  const pendingItem = matchingItem(await request(page, itemsPath))
  assert.equal(pendingItem.status, 'pending')
  const path = itemsPath + '&item_id=' + encodeURIComponent(pendingItem.id)
  const card = page.locator('.room-approval-card:visible')
  assert.equal(await card.count(), 1, 'Never choose the first of multiple approval cards')
  assert.deepEqual(JSON.parse(await card.locator('code').innerText()), expected.arguments)
  const allow = card.getByRole('button', { name: 'Review and allow', exact: true })
  await allow.waitFor()
  // DOM-generated/repeated clicks must not grant consent. Only the real pointer
  // click below may cross the trusted-user activation and signed Main boundary.
  await allow.evaluate((button) => { button.click(); button.click() })
  assert.deepEqual(matchingItem(await request(page, path)), pendingItem,
    'Synthetic clicks leave the exact approval pending')
  if (label) await capture(label)
  const current = await activity()
  assert.equal(current.active?.id, before.active.id)
  assert.equal(current.active?.runId, before.active.runId)
  assert.deepEqual(current.approvals, [approval], 'Request and approval cannot change before consent')
  await allow.click()
  await poll(async () => {
    const resolved = matchingItem(await request(page, path))
    assert.equal(resolved.id, pendingItem.id)
    assert(['pending', 'allowed'].includes(resolved.status), 'Expected user consent was not denied or expired')
    if (resolved.status === 'pending') return false
    assert.equal(resolved.approvalReviewer, 'user', 'The canonical resolution must record user consent')
    return true
  }, 15000, 'the exact inline tool approval is allowed')
  return { label, approvalId: approval.id, requestId: before.active.id, runId: before.active.runId,
    threadId: approval.threadId, turnId: approval.turnId, toolName: approval.toolName,
    syntheticClicksRejected: true, status: 'allowed' }
}
module.exports = { allowWorkspaceTool }
