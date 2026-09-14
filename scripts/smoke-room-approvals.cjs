'use strict'
const assert = require('node:assert/strict')
const { readFile, access } = require('node:fs/promises')
const { join } = require('node:path')
async function exerciseRoomApprovals({ page, application, request, poll, capture, fixture, workspaceRoot, resize, switchRooms }) {
  const globalPolicy = () => page.evaluate(async () => {
    const settings = (await window.kunGui.getSettings()).agents.kun
    return [settings.approvalPolicy, settings.sandboxMode, settings.approvalReviewer]
  })
  const before = await globalPolicy()
  await switchRooms(); await page.locator('.room-permission-picker button').waitFor()
  const { roomId } = await request(page, '/v1/agents/chat-entry')
  const editor = () => page.locator('.rooms-rich-input')
  const mode = () => page.locator('.room-permission-picker button[data-permission-mode]')
  const pending = () => request(page, `/v1/rooms/${roomId}/direct`)
  const send = async (text) => { await editor().fill(text); await editor().press('Enter') }
  const done = async (previous) => poll(async () => {
    const data = await pending(), current = data.requests[0]
    assert(!current || !['failed','recovery_required'].includes(current.status), JSON.stringify(current))
    return current && current.id !== previous && current.status === 'completed'
  }, 60000, 'private tool completion')
  const permission = async (value, confirm = true) => {
    await mode().click()
    const next = application.waitForEvent('window')
    await page.locator('[role="menuitemradio"][data-permission-mode="' + value + '"]').click()
    const consent = await next
    await consent.getByRole('button', { name: 'Apply settings', exact: true }).waitFor()
    await consent.screenshot({ path: join(process.env.KUN_APPROVAL_EVIDENCE || '/tmp', 'kun-permission-' + value + '.png') })
    await consent.getByRole('button', { name: confirm ? 'Apply settings' : 'Cancel', exact: true }).click()
    await poll(async () => !await mode().isDisabled(), 10000, 'permission save')
    return consent
  }
  assert.equal(await mode().getAttribute('data-permission-mode'), 'ask-for-approval')
  await send('CREATE_FILE 请实际创建 hello.txt')
  await page.getByRole('button', { name: 'Review and allow', exact: true }).waitFor()
  await capture('approval-inline-card')
  const waiting = (await pending()).approvals[0]
  const forged = await page.evaluate(async (id) => {
    try { await window.kunGui.resolveKunApproval({ approvalId: id, decision: 'allow', source: 'policy' }); return false } catch { return true }
  }, waiting.id)
  assert(forged, 'Workbench scripts cannot impersonate a policy approval')
  const next = application.waitForEvent('window')
  await page.getByRole('button', { name: 'Review and allow', exact: true }).click()
  const consent = await next
  await consent.getByRole('button', { name: 'Allow once', exact: true }).waitFor()
  assert((await consent.locator('#body').innerText()).includes('hello.txt'))
  assert(!await consent.evaluate(() => Boolean(window.kunGui)))
  assert(await consent.evaluate(() => typeof window.kunProtectedRoom?.confirm === 'function'))
  await consent.evaluate(() => document.getElementById('confirm').click())
  await page.waitForTimeout(120)
  assert.equal((await pending()).approvals.length, 1, 'A scripted click cannot confirm')
  const view = await consent.screenshot()
  // The regular capture helper targets the workbench; retain this separate protected surface too.
  await require('node:fs/promises').writeFile(join(process.env.KUN_APPROVAL_EVIDENCE || '/tmp', 'kun-protected-approval.png'), view)
  const closed = consent.waitForEvent('close', { timeout: 15000 })
  await consent.getByRole('button', { name: 'Allow once', exact: true }).click()
  await closed
  await done()
  const first = (await pending()).requests[0]
  const location = (await pending()).workspace.path
  assert.equal(await readFile(join(location, 'hello.txt'), 'utf8'), 'hello from Kun\n')
  await permission('full-access', false)
  assert.equal(await mode().getAttribute('data-permission-mode'), 'ask-for-approval')
  await permission('approve-for-me')
  await poll(async () => (await mode().getAttribute('data-permission-mode')) === 'approve-for-me', 10000, 'automatic review mode')
  await capture('approval-auto-mode')
  await send('UPDATE_FILE 请修改 hello.txt')
  await done(first.id)
  assert.equal(await readFile(join(location, 'hello.txt'), 'utf8'), 'updated by Kun\n')
  assert(fixture.snapshot().automaticReviews > 0, 'Real runtime automatic-review service called the model fixture')
  assert.equal(application.windows().filter((window) => window.url().startsWith('data:')).length, 0)
  const second = (await pending()).requests[0]
  await permission('full-access')
  await poll(async () => (await mode().getAttribute('data-permission-mode')) === 'full-access', 10000, 'full access mode')
  const external = join(workspaceRoot, 'external.txt')
  await send('请实际写入这个测试文件 ' + external + ' EXTERNAL_FILE_B64:' + Buffer.from(external).toString('base64url'))
  await done(second.id)
  assert.equal(await readFile(external, 'utf8'), 'external verified\n')
  assert.equal((await pending()).approvals.length, 0)
  await capture('approval-full-access')
  assert.deepEqual(await globalPolicy(), before, 'Room choice must not change Code/global permissions')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-workspace-mode-trigger]').first().waitFor()
  if (!await page.locator('[data-rooms-workspace]').count()) await switchRooms()
  await mode().waitFor()
  await poll(async () => (await mode().getAttribute('data-permission-mode')) === 'full-access', 10000, 'persisted permission')
  await permission('ask-for-approval')
  await page.evaluate(async () => {
    await window.kunGui.setSettings({ locale: 'zh', theme: 'dark' })
    const { default: i18n } = await import('/src/i18n.ts'); await i18n.changeLanguage('zh')
    const { applyTheme } = await import('/src/lib/apply-theme.ts'); applyTheme('dark')
  })
  const beforeDeny = (await pending()).requests[0].id
  await send('PROJECT_FILE 请创建一个测试文件')
  await page.getByRole('button', { name: '拒绝', exact: true }).waitFor()
  await capture('approval-zh-dark-inline')
  const denyWindow = application.waitForEvent('window')
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  const deny = await denyWindow
  await deny.getByRole('button', { name: '拒绝执行', exact: true }).waitFor()
  await deny.screenshot({ path: join(process.env.KUN_APPROVAL_EVIDENCE || '/tmp', 'kun-protected-approval-zh-dark.png') })
  await deny.getByRole('button', { name: '拒绝执行', exact: true }).click()
  await done(beforeDeny)
  await assert.rejects(access(join(location, 'project-result.txt')))
  await resize(760, 780)
  await page.waitForTimeout(200)
  await poll(async () => await page.getByRole('button', { name: '停止当前响应', exact: true }).count() === 0, 10000, 'settled composer')
  await capture('approval-narrow-composer')
  return { manual: true, syntheticClickRejected: true, automaticReviews: fixture.snapshot().automaticReviews, fullAccessExternalFile: true, cancelledChangePreserved: true, globalSettingsUnchanged: true, persisted: true, denyPreventsWrite: true, chineseDark: true }
}
module.exports = { exerciseRoomApprovals }
