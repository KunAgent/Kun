'use strict'

const assert = require('node:assert/strict')
const { join } = require('node:path')
const { writeFile } = require('node:fs/promises')
const { runWorkerFlow } = require('./smoke-development-ade-workers.cjs')

/** UI flow for the unified Code workbench, using only the isolated smoke profile. */
async function runUnifiedCodeFlow({
  page, capture, poll, runtimeRequest, expectedSetupCommand,
  claudeStubUpdated, acpStub, temporaryRoot, application, nativeApprovalTimeoutMs
}) {
  const assertions = []
  await page.locator('[data-workspace-mode-trigger][data-workspace-mode="chat"]').first().waitFor()
  await page.locator('.ds-composer-textarea').waitFor()
  assert.equal(await page.locator('[role="menuitemradio"][data-workspace-mode="ade"]').count(), 0,
    'The unified workbench must not offer a separate ADE mode')
  assert.equal(await page.locator('[data-workers-panel]').count(), 0,
    'A new Code task must not open an empty team panel')
  await capture('1-code-home')
  assertions.push('Code opens directly with no ADE mode or empty collaboration panel')

  const modelTrigger = () => page.locator('[data-composer-model-trigger]').first()
  const agentSection = page.locator('[data-agent-mode-menu]')
  const ensureModelMenuOpen = async () => {
    if (await modelTrigger().getAttribute('aria-expanded') !== 'true') await modelTrigger().click()
    await page.locator('[data-composer-model-panel]').waitFor()
  }
  const openModelAgentList = async () => {
    if (!(await agentSection.isVisible().catch(() => false))) await page.locator('[data-agent-mode-trigger]').click()
    await agentSection.waitFor()
  }
  await openModelAgentList()
  const claudeRow = agentSection.locator('[data-agent-mode-option="claude-code"]')
  await claudeRow.waitFor()
  await poll(async () => claudeRow.isEnabled(), 60_000,
    'Claude Code becoming selectable in the existing model menu')
  const acpRow = agentSection.locator('[data-agent-mode-option="smoke-acp"]')
  await acpRow.waitFor()
  await poll(async () => acpRow.isEnabled(), 60_000,
    'custom ACP agent completing its readiness handshake')
  assert.equal(await agentSection.locator('[data-agent-mode-option="smoke-term"]').count(), 0,
    'A terminal-only agent must not appear as a structured turn Agent')
  await claudeRow.locator('[data-agent-icon="claude-code"]').waitFor()
  const modelMenu = agentSection
  assert(await modelMenu.evaluate((node) => node.parentElement === document.body),
    'The model menu must render through a body portal')
  assert((await agentSection.locator('[data-agent-mode-repair]').count()) > 0,
    'An unavailable Agent needs an enabled repair action')
  await capture('2-code-model-agents')
  assertions.push('Existing Code/Design entry shows Kun modes and external Agents with repair actions and branded icons')

  await agentSection.locator('[data-agent-mode-repair="gemini-cli"]').click()
  await page.locator('#agents-settings-panel-harnesses [data-agent-card="gemini-cli"]').waitFor()
  await capture('2b-agent-repair-target')
  assertions.push('An unavailable Agent repair action opens that exact Agent in connection settings')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await openModelAgentList()
  await agentSection.locator('[data-agent-mode-manage]').click()
  const harnessPanel = page.locator('#agents-settings-panel-harnesses')
  await harnessPanel.waitFor()
  await harnessPanel.locator('[data-agent-list-id="claude-code"]').click()
  const claudeCard = harnessPanel.locator('[data-agent-card="claude-code"]')
  await claudeCard.waitFor()
  await capture('3-agent-connection-settings')
  await claudeCard.locator('button[aria-expanded]').first().click()
  await claudeCard.locator('input').first().fill(claudeStubUpdated)
  await poll(async () => {
    const probe = await runtimeRequest(page, '/v1/harnesses/claude-code/probe', 'POST')
    return probe.status?.resolvedCommand === claudeStubUpdated
  }, 30_000, 'runtime receiving a changed Agent command path')
  await capture('4-agent-command-path-applied')
  assertions.push('Agent settings command path reaches the effective runtime catalog')

  await harnessPanel.locator('[data-agent-list-id="cursor"]').click()
  const cursorCard = harnessPanel.locator('[data-agent-card="cursor"]')
  await cursorCard.waitFor()
  assert.equal(await cursorCard.getByRole('button', { name: 'Sign in', exact: true }).count(), 0)
  assert.equal(await cursorCard.getByRole('button', { name: 'Set command path', exact: true }).count(), 0)
  await cursorCard.getByRole('button', { name: 'Configure model source', exact: true }).click()
  await page.locator('[data-settings-category="providers"][aria-current="page"]').waitFor()
  await capture('4b-cursor-model-source-settings')
  await page.locator('[data-settings-category="agents"]').click()
  await page.locator('#agents-settings-tab-harnesses').click()
  await harnessPanel.waitFor()
  assertions.push('Cursor SDK connects through model source settings without a CLI login or command-path prompt')

  await harnessPanel.locator('[data-agent-add-open]').click()
  const wizard = page.locator('[data-agent-add-wizard]')
  await wizard.waitFor()
  await wizard.locator('[data-agent-add-custom]').click()
  const customForm = wizard.locator('[data-agent-custom-form]')
  await customForm.getByPlaceholder(/Display name/u).fill('Smoke Form Agent')
  await customForm.getByPlaceholder(/Command path/u).fill(acpStub)
  await customForm.getByPlaceholder('ENV_NAME').fill('SMOKE_KEY')
  await customForm.getByPlaceholder('Secret value').fill('smoke-secret-value')
  await customForm.getByRole('button', { name: 'Bind', exact: true }).click()
  await customForm.locator('[data-secret-env-chip="SMOKE_KEY"]').waitFor()
  const addButton = customForm.getByRole('button', { name: 'Add agent', exact: true })
  assert(await addButton.isDisabled(), 'An untested custom ACP agent must not be added as ready')
  await customForm.getByRole('button', { name: 'Test connection', exact: true }).click()
  await customForm.locator('[data-probe-result="ok"]').waitFor({ timeout: 60_000 })
  await addButton.click()
  await poll(async () => {
    const catalog = await runtimeRequest(page, '/v1/harnesses')
    return (catalog.harnesses ?? []).some((row) => row.definition.id === 'custom-smoke-form-agent')
  }, 30_000, 'saved custom ACP agent reaching the catalog')
  await wizard.locator('[data-agent-add-done]').click()
  await harnessPanel.locator('[data-agent-list-id="custom-smoke-form-agent"]').waitFor()

  const importFile = join(temporaryRoot, 'import-agent.json')
  await writeFile(importFile, JSON.stringify({
    displayName: 'Imported Agent', command: acpStub, args: ['--acp']
  }))
  await harnessPanel.locator('[data-agent-add-open]').click()
  await wizard.locator('[data-agent-add-custom]').click()
  await customForm.locator('input[type="file"]').setInputFiles(importFile)
  await poll(async () => (await customForm.getByPlaceholder(/Display name/u).inputValue()) === 'Imported Agent',
    10_000, 'imported Agent definition filling the form')
  assert(await addButton.isDisabled(), 'Imported definitions need a fresh connection test')
  await customForm.getByRole('button', { name: 'Test connection', exact: true }).click()
  await customForm.locator('[data-probe-result="ok"]').waitFor({ timeout: 60_000 })
  await addButton.click()
  await wizard.locator('[data-agent-add-done]').click()
  await harnessPanel.locator('[data-agent-list-id="custom-imported-agent"]').waitFor({ timeout: 30_000 })
  await capture('5-custom-agents')
  assertions.push('Custom ACP probe, protected secret reference, import, and list/detail all work')

  await page.locator('#agents-settings-tab-collaboration').click()
  const collaboration = page.locator('#agents-settings-panel-collaboration')
  await collaboration.waitFor()
  const softLimit = collaboration.getByRole('spinbutton', { name: 'Suggested workers' })
  await softLimit.waitFor()
  await poll(async () => softLimit.isEnabled(), 20_000, 'collaboration revision loading')
  const before = await page.evaluate(() => window.kunGui.getAdeCollaborationSettings())
  await softLimit.fill('5')
  const unsaved = await page.evaluate(() => window.kunGui.getAdeCollaborationSettings())
  assert.equal(unsaved.revision, before.revision,
    'Editing collaboration defaults must not use the legacy 450 ms autosave')
  await collaboration.getByRole('button', { name: 'Save changes' }).click()
  await poll(async () => {
    const current = await page.evaluate(() => window.kunGui.getAdeCollaborationSettings())
    return current.value.limits.softWorkers === 5 && current.revision !== before.revision
  }, 30_000, 'conditional collaboration settings save')
  await capture('6-collaboration-defaults')
  assertions.push('Global collaboration defaults save only on click and return an object revision')

  await page.locator('#agents-settings-tab-harnesses').click()
  const catalog = await runtimeRequest(page, '/v1/harnesses')
  const geminiRow = (catalog.harnesses ?? []).find((row) => row.definition.id === 'gemini-cli')
  assert(geminiRow, 'Gemini CLI must be in the builtin catalog')
  const command = expectedSetupCommand(geminiRow.definition, process.platform, 'install')
  assert(command, 'Missing Gemini CLI install command')
  await harnessPanel.locator('[data-agent-add-open]').click()
  await wizard.locator('[data-agent-add-select="gemini-cli"]').click()
  await wizard.locator('[data-agent-add-connect]').getByRole('button', { name: /Install.*terminal/iu }).click()
  await page.locator('[data-workbench-left-sidebar]').waitFor()
  await page.locator('[data-terminal-open="true"]').waitFor()
  await poll(async () => (await page.locator('.xterm-rows').innerText()).includes(command.command),
    30_000, 'terminal showing the reviewed setup command')
  await capture('7-setup-command-terminal')
  assertions.push('Repair command opens a prefilled terminal without executing it')

  await poll(async () => {
    const list = await runtimeRequest(page, '/v1/harnesses')
    const row = (list.harnesses ?? []).find((entry) => entry.definition.id === 'smoke-term')
    return row?.definition.transport === 'terminal' && row?.status.installed === 'yes'
  }, 30_000, 'terminal Agent reaching the catalog')
  await page.getByRole('button', { name: 'New terminal tab', exact: true }).click()
  const newTabMenu = page.locator('[role="menu"][aria-label="New terminal tab"]')
  await newTabMenu.waitFor()
  await newTabMenu.getByRole('menuitem', { name: /^Smoke Term/u }).click()
  await page.getByRole('tab', { name: /Smoke Term/u }).waitFor({ timeout: 30_000 })
  await poll(async () => (await page.locator('.xterm-rows').innerText()).includes('Welcome to Node.js'),
    30_000, 'seeded terminal Agent starting in its own tab')
  await capture('8-terminal-agent')
  assertions.push('Terminal-only Agent stays out of turn choices but launches from terminal menu')

  await openModelAgentList()
  await agentSection.locator('[data-agent-mode-option="claude-code"]').click()
  const confirmation = page.locator('[data-agent-mode-confirm]')
  if (await confirmation.isVisible().catch(() => false)) {
    await confirmation.locator('[data-agent-mode-confirm-yes]').click()
  }
  const groups = await runtimeRequest(page, '/v1/harnesses/claude-code/models?credential_mode=kun-gateway')
  const gatewayGroup = (groups.groups ?? []).find((group) => group.providerId === 'deepseek')
  assert(gatewayGroup && gatewayGroup.models?.length > 0,
    'Claude Code should expose the configured Kun gateway model group')
  await ensureModelMenuOpen()
  await page.getByText(/Kun gateway/iu).first().waitFor()
  await capture('9-model-gateway-group')
  await page.keyboard.press('Escape')
  assertions.push('The left Agent choice and right model source menu stay separate while exposing compatible gateway models')

  await openModelAgentList()
  await agentSection.locator('[data-agent-mode-option="kun-code"]').click()
  const beforeDraft = await runtimeRequest(page, '/v1/threads?limit=100')
  await page.locator('button[aria-controls="floating-composer-action-menu"]').click()
  const actionMenu = page.locator('#floating-composer-action-menu')
  await actionMenu.waitFor()
  await actionMenu.locator('[data-composer-collaboration-menu-item]').click()
  const afterDraft = await runtimeRequest(page, '/v1/threads?limit=100')
  assert.equal(afterDraft.threads.length, beforeDraft.threads.length,
    'Choosing collaboration on a new task must not create a thread before first send')
  assert.equal(await page.locator('[data-workers-panel]').count(), 0,
    'Enabling collaboration without workers must not open an empty panel')
  await capture('10-collaboration-draft')
  assertions.push('Collaboration opt-in stays in the Code draft without creating a task or empty team')

  const workspaceTrigger = page.locator('[data-composer-launch-settings-trigger]')
  if (await workspaceTrigger.getAttribute('data-composer-launch-mode') !== 'worktree') {
    await workspaceTrigger.click()
    await page.locator('[data-composer-worktree-mode-toggle]').click()
  }
  assert.equal(await workspaceTrigger.getAttribute('data-composer-launch-mode'), 'worktree')
  await page.keyboard.press('Escape')
  await page.locator('.ds-composer-textarea').fill('Reply with a brief hello.')
  await page.locator('.ds-composer-primary-action').click()
  await poll(async () => {
    const list = await runtimeRequest(page, '/v1/threads?limit=100')
    return list.threads.length === beforeDraft.threads.length + 1
  }, 60_000, 'first send creating exactly one Code task')
  const threadId = await page.locator('[data-active-thread-id]').first().getAttribute('data-active-thread-id')
  await poll(async () => {
    const { records } = await runtimeRequest(page, `/v1/task-workspaces?ownerThreadId=${threadId}`)
    return records.some((record) => record.state === 'ready')
  }, 60_000, 'Code first-send managed worktree becoming ready')
  const { records } = await runtimeRequest(page, `/v1/task-workspaces?ownerThreadId=${threadId}`)
  assert.equal(records.length, 1, 'One Code execution unit must allocate exactly one managed workspace')
  assert.equal(records[0].isolation, 'worktree')
  const sentThread = await runtimeRequest(page, `/v1/threads/${threadId}`)
  assert.equal(sentThread.taskWorkspaceId, records[0].workspaceId)
  assert.equal(sentThread.workspace, records[0].path)
  await capture('11-code-task-sent')
  assertions.push('First send creates one Code task and one managed worktree using the existing Git control')

  await page.getByRole('button', { name: 'Task settings' }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Task settings' }).click()
  const taskDrawer = page.getByRole('dialog', { name: 'Task settings' })
  await taskDrawer.waitFor()
  await taskDrawer.getByRole('spinbutton', { name: 'Maximum workers' }).fill('9')
  await capture('12-task-settings-draft')
  await taskDrawer.getByRole('button', { name: 'Save changes' }).click()
  await poll(async () => (await taskDrawer.innerText()).includes('Saved for this task'),
    30_000, 'task settings saving an active-worker limit')
  await capture('13-task-settings-saved')
  await taskDrawer.getByRole('button', { name: 'Close' }).click()
  assert.equal(await page.locator('.ds-composer-textarea').count(), 1,
    'Closing task settings must leave the Code conversation visible')
  assertions.push('Task settings drawer saves a per-task worker limit and returns to the same Code conversation')
  assertions.push(...await runWorkerFlow({ page, capture, poll, runtimeRequest, application, nativeApprovalTimeoutMs }))
  return assertions
}

module.exports = { runUnifiedCodeFlow }
