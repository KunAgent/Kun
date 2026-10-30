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
  const path = `/v1/approvals/${encodeURIComponent(approval.id)}`
  assert.deepEqual((await request(page, path)).approval, approval)
  const card = page.locator('.room-approval-card:visible')
  assert.equal(await card.count(), 1, 'Never choose the first of multiple approval cards')
  assert.deepEqual(JSON.parse(await card.locator('code').innerText()), expected.arguments)
  const allow = card.getByRole('button', { name: 'Review and allow', exact: true })
  await allow.waitFor()
  // DOM-generated/repeated clicks must not grant consent. Only the real pointer
  // click below may cross the trusted-user activation and signed Main boundary.
  await allow.evaluate((button) => { button.click(); button.click() })
  assert.deepEqual((await request(page, path)).approval, approval, 'Synthetic clicks leave the exact approval pending')
  if (label) await capture(label)
  const current = await activity()
  assert.equal(current.active?.id, before.active.id)
  assert.equal(current.active?.runId, before.active.runId)
  assert.deepEqual(current.approvals, [approval], 'Request and approval cannot change before consent')
  await allow.click()
  await poll(async () => {
    const resolved = (await request(page, path)).approval
    assert.equal(resolved.id, approval.id)
    assert.equal(resolved.toolName, approval.toolName)
    assert.equal(resolved.threadId, approval.threadId)
    assert.equal(resolved.turnId, approval.turnId)
    assert.deepEqual(resolved.action, approval.action)
    assert(['pending', 'allowed'].includes(resolved.status), 'Expected user consent was not denied or expired')
    return resolved.status === 'allowed'
  }, 15000, 'the exact inline tool approval is allowed')
  return { label, approvalId: approval.id, requestId: before.active.id, runId: before.active.runId,
    threadId: approval.threadId, turnId: approval.turnId, toolName: approval.toolName,
    syntheticClicksRejected: true, status: 'allowed' }
}
module.exports = { allowWorkspaceTool }
