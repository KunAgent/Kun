'use strict'

const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const ROLE_PROMPT_MARKER = 'ROSTER-SMOKE-ROLE-PROMPT'

/** Workspace roles the roster must surface: one on the native loop, one bound to the Claude Code stub. */
async function writeRosterWorkspaceRoles(workspaceRoot) {
  const agents = join(workspaceRoot, '.kun', 'agents')
  await mkdir(agents, { recursive: true })
  await writeFile(join(agents, 'repo-reviewer.md'), [
    '---',
    'name: Repo Reviewer',
    'description: Reviews this repository and reports findings.',
    'toolPolicy: readOnly',
    'owns: owns repository review. Do not review the repository yourself.',
    '---',
    `${ROLE_PROMPT_MARKER} You review repositories and report what you found.`
  ].join('\n') + '\n')
  await writeFile(join(agents, 'claude-reviewer.md'), [
    '---',
    'name: Claude Reviewer',
    'description: Reviews diffs on Claude Code.',
    'toolPolicy: readOnly',
    'harness: claude-code',
    'model: claude-sonnet-5',
    '---',
    'You review diffs.'
  ].join('\n') + '\n')
}

/**
 * The agent roster end to end: the runtime lists workspace roles with their
 * engines and lane status, the main agent sees the ownership block and hands
 * the work to the role it names, the child runs that role, and Settings shows
 * the role status, the engine-binding switch and the ownership field.
 */
async function runAgentRosterFlow({ page, capture, poll, runtimeRequest, workspaceRoot, modelFixture }) {
  const checks = []
  const roster = await runtimeRequest(page, `/v1/agent-roster?workspace=${encodeURIComponent(workspaceRoot)}`)
  const byId = new Map(roster.entries.map((entry) => [entry.id, entry]))
  assert.equal(roster.surface, 'code')
  assert.equal(byId.get('repo-reviewer')?.source, 'workspace')
  assert.equal(byId.get('repo-reviewer')?.owns, 'owns repository review. Do not review the repository yourself.')
  assert.deepEqual(byId.get('repo-reviewer')?.engine, { kind: 'lane-default' })
  assert.equal(byId.get('repo-reviewer')?.lanes.delegate.state, 'ok')
  assert.equal(byId.get('claude-reviewer')?.engine.kind, 'bound')
  assert.equal(byId.get('claude-reviewer')?.engine.harnessId, 'claude-code')
  assert.equal(byId.get('explore')?.source, 'builtin')
  for (const entry of roster.entries) {
    for (const lane of ['delegate', 'worker', 'graph', 'conversation']) {
      assert.ok(['ok', 'unchecked', 'blocked'].includes(entry.lanes[lane].state), `${entry.id} ${lane} lane state`)
    }
  }
  checks.push('GET /v1/agent-roster lists built-in and workspace roles with engine bindings and per-lane status')

  const composer = page.locator('.ds-composer-textarea')
  await composer.waitFor()
  await composer.fill('[roster-smoke-delegate] Review the repository for me.')
  await page.locator('.ds-composer-primary-action').click()
  const observations = () => modelFixture.snapshot().observations
  await poll(async () => observations().some((entry) => entry.rosterChild), 120_000, 'delegate_task child request')
  await poll(async () => observations().some((entry) => entry.rosterParentFinal), 120_000, 'parent turn finished')
  const parent = observations().find((entry) => entry.rosterDelegate)
  const child = observations().find((entry) => entry.rosterChild)
  assert.ok(parent?.delegationBlock, 'the main agent request carries the delegation ownership block')
  assert.ok(child?.rolePrompt, 'the delegate_task child runs with the role prompt from .kun/agents')
  assert.ok(!child?.tools.includes('delegate_task'), 'the child cannot delegate further')
  checks.push('The main agent sees which role owns the work, and delegate_task(profile) runs the child as that role')

  await page.locator('[data-workbench-left-sidebar]').getByRole('button', { name: /Settings|设置/u }).click()
  await page.locator('[data-settings-category="subagents"]').click()
  await page.getByText(/Run roles on their bound engine|按角色绑定的引擎运行/u).first().waitFor()
  await capture('roster-0-settings-policy')
  await page.getByRole('tab', { name: /^(Subagent profiles|子代理配置)$/u }).or(
    page.getByRole('button', { name: /^(Subagent profiles|子代理配置)$/u })).first().click()
  await page.getByPlaceholder(/Search names, capabilities, or scenarios|搜索/u).first().fill('Repository Explorer')
  const explore = page.locator('[data-agent-id="explore"]').first()
  await explore.waitFor()
  await explore.locator('button').first().click()
  const status = page.locator('[data-roster-status="explore"]').first()
  await status.waitFor({ timeout: 30_000 })
  assert.equal(await status.locator('[data-roster-lane]').count(), 4)
  await status.scrollIntoViewIfNeeded()
  await capture('roster-1-settings-status')
  await page.locator('[data-testid="subagent-details-panel"]').getByRole('button', { name: /^(Edit|编辑)$/u }).click()
  await page.locator('[data-subagent-owns]').waitFor()
  await capture('roster-2-profile-owns')
  checks.push('Settings shows the engine-binding switch, a role status card per lane and the ownership field')
  return checks
}

module.exports = { ROLE_PROMPT_MARKER, runAgentRosterFlow, writeRosterWorkspaceRoles }
