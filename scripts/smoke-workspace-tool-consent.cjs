'use strict'
const assert = require('node:assert/strict')
const { observeWorkspaceApproval } = require('./smoke-workspace-approval-events.cjs')

// 08c32b338 made the trusted inline card the tool confirmation. Permission
// changes still use a protected window; tool approvals must not wait for one.
async function allowWorkspaceTool({ page, request, poll, capture, roomId, expected, label, recordDiagnostic }) {
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
  const base = `/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(before.active.runId)}`
  const run = (await request(page, base)).run
  assert.equal(run.id, before.active.runId)
  assert.equal(run.roomId, roomId)
  assert.equal(run.requestId, before.active.id)
  assert.equal(run.threadId, approval.threadId)
  assert.equal(run.turnId, approval.turnId)
  // Approvals are durable events, not materialized message items. Observe the
  // normal public SSE bridge and require explicit, exact lifecycle evidence.
  const observer = await observeWorkspaceApproval(page, approval)
  const matchingEvent = (event) => {
    assert.equal(event.approvalId, approval.id)
    assert.equal(event.threadId, approval.threadId)
    assert.equal(event.turnId, approval.turnId)
    assert.equal(event.toolName, approval.toolName)
    assert.deepEqual(event.action, approval.action)
    assert(Number.isSafeInteger(event.seq) && event.seq > 0)
    return event
  }
  try {
    let pending
    await poll(async () => {
      const state = await observer.read()
      assert.equal(state.error, null)
      assert.equal(state.resolved, null, 'Approval must remain pending before the trusted click')
      if (!state.requested) return false
      pending = matchingEvent(state.requested)
      assert.equal(pending.kind, 'approval_requested')
      assert.equal(pending.status, 'pending')
      return true
    }, 15000, 'the exact pending approval is durably observable')
    const card = page.locator('.room-approval-card:visible')
    assert.equal(await card.count(), 1, 'Never choose the first of multiple approval cards')
    assert.deepEqual(JSON.parse(await card.locator('code').innerText()), expected.arguments)
    const allow = card.getByRole('button', { name: 'Review and allow', exact: true })
    await allow.waitFor()
    // DOM-generated/repeated clicks must not grant consent. Only the real pointer
    // click below may cross the trusted-user activation and signed Main boundary.
    await allow.evaluate((button) => { button.click(); button.click() })
    assert.equal((await observer.read()).resolved, null, 'Synthetic clicks cannot resolve approval')
    if (label) await capture(label)
    const current = await activity()
    assert.equal(current.active?.id, before.active.id)
    assert.equal(current.active?.runId, before.active.runId)
    assert.deepEqual(current.approvals, [approval], 'Request and approval cannot change before consent')
    const ready = await observer.read()
    assert.equal(ready.error, null)
    assert.equal(ready.resolved, null)
    assert.deepEqual(ready.requested, pending, 'Pending evidence cannot change before consent')
    await allow.click()
    await poll(async () => {
      const state = await observer.read()
      assert.equal(state.error, null)
      if (!state.resolved) return false
      const resolved = matchingEvent(state.resolved)
      assert.equal(resolved.kind, 'approval_resolved')
      assert.equal(resolved.status, 'allowed', 'Expected user consent was not allowed')
      assert.equal(resolved.approvalReviewer, 'user', 'The durable resolution must record user consent')
      assert(resolved.seq > pending.seq, 'Resolution must follow the exact pending event')
      return true
    }, 15000, 'the exact inline tool approval is allowed')
    return { label, approvalId: approval.id, requestId: before.active.id, runId: before.active.runId,
      threadId: approval.threadId, turnId: approval.turnId, toolName: approval.toolName,
      syntheticClicksRejected: true, status: 'allowed' }
  } finally {
    try { if (recordDiagnostic) await recordDiagnostic((label || 'workspace-tool') + '-approval-events', await observer.read()) }
    finally { await observer.close() }
  }
}
module.exports = { allowWorkspaceTool }
