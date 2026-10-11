'use strict'

const assert = require('node:assert/strict')

/** Exercise the real isolated approval window; never call its bridge or mint consent tokens. */
async function confirmFixtureApproval({ application, page, capture, poll, runtimeRequest,
  allow, approvalId, workerId, timeoutMs = 60_000 }) {
  const pending = async () => {
    const current = await runtimeRequest(page, `/v1/approvals?threadId=${workerId}`)
    return current.approvals.some((entry) => entry.approvalId === approvalId)
  }
  const open = async () => {
    const created = application.waitForEvent('window', { timeout: timeoutMs })
    await allow.click()
    const dialog = await created
    await dialog.locator('[data-protected-confirmation]').waitFor()
    assert(dialog.url().startsWith('data:text/html'), 'Approval must use a host-authored document')
    const contents = await dialog.locator('body').innerText()
    assert.match(contents, /smoke-worker\.txt/u)
    assert.match(contents, /Allow once|允许一次/u)
    assert.doesNotMatch(contents, /Approval reference|Direct DOM|sha256:/u)
    assert.equal(await dialog.evaluate(() => typeof window.kunGui), 'undefined',
      'The approval window must not expose the workbench bridge')
    assert.equal(await dialog.evaluate(() => document.activeElement?.id), 'cancel',
      'Cancel must receive initial focus')
    return dialog
  }

  const cancelled = await open()
  await capture('15b-protected-tool-approval', cancelled)
  // DOM-generated clicks are not a user decision on this protected surface.
  await cancelled.locator('#confirm').evaluate((button) => button.click())
  assert(await pending(), 'Synthetic DOM input must not authorize the file operation')
  await cancelled.keyboard.press('Tab')
  assert.equal(await cancelled.evaluate(() => document.activeElement?.id), 'confirm')
  await cancelled.keyboard.press('Tab')
  assert.equal(await cancelled.evaluate(() => document.activeElement?.id), 'body')
  await cancelled.keyboard.press('Shift+Tab')
  assert.equal(await cancelled.evaluate(() => document.activeElement?.id), 'confirm')
  await cancelled.keyboard.press('Shift+Tab')
  assert.equal(await cancelled.evaluate(() => document.activeElement?.id), 'cancel')
  const dismissed = cancelled.waitForEvent('close')
  await Promise.all([dismissed, cancelled.keyboard.press('Escape').catch(async (error) => {
    // Main handles Escape before key-up; the target can already be closed
    // when Playwright finishes dispatching the physical key sequence.
    await dismissed
    if (!cancelled.isClosed()) throw error
  })])
  assert(await pending(), 'Cancel must leave the request pending')
  await poll(() => allow.isEnabled(), 10_000, 'cancelled approval returning to its pending card')

  const accepted = await open()
  const details = accepted.locator('details')
  if (await details.count()) {
    await details.locator('summary').click()
    await capture('15c-protected-approval-details', accepted)
  }
  await Promise.all([accepted.waitForEvent('close'), accepted.locator('#confirm').click()])
  await poll(async () => !await pending(), timeoutMs, 'protected approval reaching the real Runtime gate')
}

async function runProtectedApprovalFlow({ application, page, capture, poll, runtimeRequest }) {
  const created = () => application.waitForEvent('window', { timeout: 30_000 })
  let opening = created()
  await page.evaluate(() => {
    window.__dialogResult = 'pending'
    void window.kunGui.setSettings({ agents: { kun: { approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access', approvalReviewer: 'user' } } })
      .then((value) => { window.__dialogResult = value.agents.kun.approvalPolicy })
  })
  const permission = await opening
  await permission.locator('[data-protected-confirmation]').waitFor()
  assert.match(await permission.locator('body').innerText(), /完全访问|Full access/u)
  await capture('approval-permission-change', permission)
  await Promise.all([permission.waitForEvent('close'), permission.locator('#cancel').click()])
  await poll(async () => await page.evaluate(() => window.__dialogResult === 'always'),
    10_000, 'cancel preserving the original execution permissions')

  opening = created()
  await page.evaluate(() => {
    window.__dialogResult = 'pending'
    void window.kunGui.confirmDialog({ message: '删除这条测试记录？',
      detail: '这是隔离测试中的示例确认。取消后记录会保留。', confirmLabel: '删除', cancelLabel: '取消' })
      .then((value) => { window.__dialogResult = value })
  })
  const confirmation = await opening
  await confirmation.locator('[data-protected-confirmation]').waitFor()
  await capture('approval-general-confirm', confirmation)
  await Promise.all([confirmation.waitForEvent('close'), confirmation.locator('#cancel').click()])
  await poll(async () => await page.evaluate(() => window.__dialogResult === false), 10_000, 'business confirmation cancellation')

  opening = created()
  await page.evaluate(() => {
    window.__dialogResult = 'pending'
    void window.kunGui.alertDialog({ message: '设置已保存', detail: '新的设置将在下一次任务中使用。', buttonLabel: '知道了' })
      .then(() => { window.__dialogResult = 'done' })
  })
  const notice = await opening
  await notice.locator('[data-protected-confirmation]').waitFor()
  assert(await notice.locator('#cancel').isHidden())
  assert.equal(await notice.evaluate(() => document.activeElement?.id), 'confirm')
  await capture('approval-general-notice', notice)
  await Promise.all([notice.waitForEvent('close'), notice.locator('#confirm').click()])

  const composer = page.locator('.ds-composer-textarea')
  await composer.fill('[ade-smoke-worker-file] Create the isolated smoke-worker.txt fixture file.')
  await page.locator('.ds-composer-primary-action').click()
  let threadId, approvalId
  await poll(async () => {
    const current = await runtimeRequest(page, '/v1/approvals')
    const approval = current.approvals.find((entry) => entry.toolName === 'write' && /smoke-worker\.txt/u.test(entry.summary))
    if (!approval) return false
    threadId = approval.threadId
    approvalId = approval.approvalId
    return true
  }, 60_000, 'a real file operation waiting for user approval')
  const allow = page.getByLabel(/^(Approval required|需要审批)$/u).getByRole('button', { name: /^(Allow|允许)$/u })
  await allow.waitFor()
  await confirmFixtureApproval({ application, page, capture, poll, runtimeRequest,
    allow, approvalId, workerId: threadId })
  await poll(async () => {
    const thread = await runtimeRequest(page, `/v1/threads/${threadId}`)
    const result = thread.turns.flatMap((turn) => turn.items ?? [])
      .find((item) => item.kind === 'tool_result' && item.callId === 'smoke-worker-write')
    return result?.isError !== true && result?.output?.bytes_written > 0 && thread.turns.at(-1)?.status === 'completed'
  }, 60_000, 'approved fixture file actually written')
  await capture('approval-turn-complete')
  return [
    'Permission changes use the app dialog and cancellation preserves the original execution policy',
    'General business confirmation and single-action notices use the same app UI',
    'Synthetic DOM clicks do not authorize tools; Escape keeps the request pending',
    'A real trusted UI click approves exactly one action and the file tool writes its fixture'
  ]
}

module.exports = { confirmFixtureApproval, runProtectedApprovalFlow }
