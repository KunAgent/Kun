'use strict'

const assert = require('node:assert/strict')
const { confirmFixtureApproval } = require('./smoke-development-protected-approval.cjs')

async function runWorkerFlow({ page, capture, poll, runtimeRequest, application, nativeApprovalTimeoutMs = 180_000 }) {
  if (await page.locator('[data-terminal-open="true"]').count()) {
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  }
  const header = page.locator('[data-active-thread-id]').first()
  const managerId = await header.getAttribute('data-active-thread-id')
  assert(managerId, 'Expected the Code task to remain selected')
  const originalManager = await runtimeRequest(page, `/v1/threads/${managerId}`)
  const parentDraft = 'Unsent parent draft must survive worker preview.'
  const composer = page.locator('.ds-composer-textarea')
  await composer.fill('[ade-smoke-create-worker] Create one isolated Smoke worker that writes a fixture file.')
  await page.locator('.ds-composer-primary-action').click()
  let overview
  await poll(async () => {
    try { overview = await runtimeRequest(page, `/v1/teams/by-manager/${managerId}`) }
    catch { overview = null }
    if (overview?.team.workers.length === 1) return true
    const detail = await runtimeRequest(page, `/v1/threads/${managerId}`)
    const last = detail.turns.at(-1)
    assert(!(last?.status === 'completed' && JSON.stringify(last).includes('[ade-smoke-create-worker]')),
      'The manager completed the fixture request without creating its worker; inspect model observations and thread snapshot')
    return false
  }, 60_000, 'real worker_create tool creating a team worker')
  const worker = overview.team.workers[0]
  assert(worker.taskWorkspaceId, 'The worker must have an isolated task workspace')
  const owned = await runtimeRequest(page, `/v1/task-workspaces?ownerThreadId=${managerId}`)
  assert.equal(owned.records.length, 2, 'The manager and its worker must each own exactly one workspace')
  assert.equal(owned.records.filter((record) => record.workspaceId === worker.taskWorkspaceId).length, 1)
  assert.equal(await page.locator('[data-workers-panel]').count(), 0,
    'Dispatching a worker must not automatically open or focus the team panel')
  await composer.fill(parentDraft)
  await page.locator('[data-workers-pill]').click()
  const panel = page.locator('[data-workers-panel]')
  await panel.locator(`[data-worker-row="${worker.workerId}"]`).getByRole('button', { name: 'Smoke worker', exact: true }).click()
  const inspector = page.locator(`[data-worker-inspector="${worker.workerId}"]`)
  await inspector.waitFor()
  await inspector.locator('[data-worker-preview-timeline]').getByText(/smoke-worker\.txt/u).first().waitFor()
  assert.equal(await page.locator('[data-worktree-prep="failed"]').count(), 0,
    'Worker workspace events must not invalidate the parent workspace')
  assert.equal((await runtimeRequest(page, `/v1/threads/${managerId}`)).taskWorkspaceId, originalManager.taskWorkspaceId)
  assert.equal(await header.getAttribute('data-active-thread-id'), managerId)
  assert.equal(await composer.inputValue(), parentDraft)
  await capture('14-worker-preview-keeps-parent')

  // Only this known fixture file operation is approved, through the real UI.
  // Opening a full worker is explicit, unlike the preview above.
  await poll(async () => {
    const detail = await runtimeRequest(page, `/v1/threads/${worker.workerId}`)
    return detail.pendingApprovalIds?.length > 0 || detail.turns.some((turn) => turn.status === 'completed')
  }, 30_000, 'worker file tool reaching its approval or completion boundary')
  const pending = await runtimeRequest(page, `/v1/approvals?threadId=${worker.workerId}`)
  if (pending.approvals.length) {
    assert.equal(pending.approvals.length, 1)
    assert.equal(pending.approvals[0].toolName, 'write')
    assert.match(pending.approvals[0].summary, /smoke-worker\.txt/u)
    await inspector.locator('[data-worker-full-open]').click()
    await poll(async () => await header.getAttribute('data-active-thread-id') === worker.workerId,
      15_000, 'explicit full-open selecting the worker')
    const allow = page.getByRole('button', { name: 'Allow', exact: true })
    await allow.waitFor()
    assert.equal(await allow.count(), 1, 'Only the fixture write may be approved')
    const approval = allow.locator('..').locator('..')
    assert.match(await approval.innerText(), /Approval required/u)
    assert.match(await approval.innerText(), /smoke-worker\.txt/u)
    await capture('15-worker-file-approval')
    await confirmFixtureApproval({ application, page, capture, poll, runtimeRequest, allow,
      approvalId: pending.approvals[0].approvalId, workerId: worker.workerId,
      timeoutMs: nativeApprovalTimeoutMs })
    await page.getByTestId('subagent-return-bar').click()
    await poll(async () => await header.getAttribute('data-active-thread-id') === managerId,
      15_000, 'returning to the same manager task')
  }
  await poll(async () => {
    overview = await runtimeRequest(page, `/v1/teams/by-manager/${managerId}`)
    return overview.dispatches.some((dispatch) => dispatch.workerId === worker.workerId && dispatch.state === 'completed')
  }, 60_000, 'worker fixture completing its real write tool')
  const completedWorker = await runtimeRequest(page, `/v1/threads/${worker.workerId}`)
  const writeResult = completedWorker.turns.flatMap((turn) => turn.items ?? [])
    .find((item) => item.kind === 'tool_result' && item.callId === 'smoke-worker-write')
  assert(writeResult && writeResult.isError !== true && writeResult.output?.bytes_written > 0,
    `Worker write must actually succeed: ${JSON.stringify(writeResult?.output)}`)
  if (!(await panel.isVisible().catch(() => false))) await page.locator('[data-workers-pill]').click()
  await panel.locator(`[data-worker-row="${worker.workerId}"]`).getByRole('button', { name: 'Smoke worker', exact: true }).click()
  assert.equal(await composer.inputValue(), parentDraft, 'Returning from the worker must restore the parent draft')
  const message = '[ade-smoke-worker-message] Confirm receipt of this worker-only follow-up.'
  await inspector.locator('[data-worker-draft]').fill(message)
  await inspector.locator('[data-worker-control-action]').click()
  await poll(async () => {
    const value = await runtimeRequest(page, `/v1/teams/workers/${worker.workerId}`)
    return value.worker.control === 'user'
  }, 20_000, 'explicitly taking over the worker')
  await inspector.locator('[data-worker-send]').click()
  await poll(async () => {
    const detail = await runtimeRequest(page, `/v1/threads/${worker.workerId}`)
    return JSON.stringify(detail).includes(message)
  }, 30_000, 'the follow-up arriving on the worker thread')
  const manager = await runtimeRequest(page, `/v1/threads/${managerId}`)
  assert(!JSON.stringify(manager).includes(message), 'Worker input must not be sent to the manager')
  assert.equal(await header.getAttribute('data-active-thread-id'), managerId)
  assert.equal(await composer.inputValue(), parentDraft)
  await capture('16-worker-input-keeps-parent')

  await page.getByRole('button', { name: 'Changes', exact: true }).click()
  const changes = page.locator('[data-code-changes-panel]')
  await changes.getByRole('combobox').selectOption(worker.taskWorkspaceId)
  await changes.locator(`[data-review-workspace-id="${worker.taskWorkspaceId}"]`).waitFor()
  await changes.getByText('smoke-worker.txt', { exact: true }).first().waitFor()
  await poll(async () => (await changes.innerText()).includes('Worker smoke ready'),
    30_000, 'the selected worker file diff content rendering')
  assert.equal(await header.getAttribute('data-active-thread-id'), managerId)
  await capture('17-worker-workspace-review')
  assert.equal(await page.locator('[data-worktree-prep="failed"]').count(), 0)
  const continued = 'The parent task can continue after worker review.'
  await composer.fill(continued)
  await page.locator('.ds-composer-primary-action').click()
  await poll(async () => {
    const detail = await runtimeRequest(page, `/v1/threads/${managerId}`)
    return detail.turns.some((turn) => turn.status === 'completed' && turn.items?.some((item) =>
      item.kind === 'user_message' && item.text === continued))
  }, 30_000, 'parent task continuing on its existing workspace')
  assert.equal((await runtimeRequest(page, `/v1/threads/${managerId}`)).taskWorkspaceId, originalManager.taskWorkspaceId)
  const after = await runtimeRequest(page, `/v1/task-workspaces?ownerThreadId=${managerId}`)
  assert.equal(after.records.length, 2, 'Continuing the parent must not create another workspace')
  await capture('18-parent-continues-after-worker')
  return [
    'Real worker_create tool creates an isolated worker without auto-opening the team panel',
    'Worker preview preserves the parent thread and unsent parent draft; full-open is explicit',
    'The protected app dialog ignores synthetic clicks, keeps cancellation pending, and allows one real worker file write',
    'Explicit takeover and local send target only the worker while preserving the parent draft',
    'The existing Changes panel reviews the selected worker workspace without changing the main conversation',
    'The parent resumes after worker review with its original workspace and no duplicate checkout'
  ]
}

module.exports = { runWorkerFlow }
