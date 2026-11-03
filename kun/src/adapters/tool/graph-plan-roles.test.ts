import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GRAPH_RUNTIME_CONFIG } from '../../config/kun-config.js'
import type { AgentRosterResolution } from '../../delegation/agent-roster.js'
import { compileGraphPlanIntentV2, GraphPlanIntentV2Schema } from '../../graph/index.js'
import { isToolAllowedInOrchestration } from '../../graph/graph-tool-boundary.js'
import { resolveGraphPlanRoles } from './graph-plan-roles.js'
import { graphCreateBudgetDefaults } from './graph-create-run-tool.js'

const reviewer: Extract<AgentRosterResolution, { ok: true }> = {
  ok: true,
  id: 'reviewer',
  source: 'workspace',
  profile: {
    name: 'Codex Reviewer',
    description: 'Reviews diffs.',
    systemPrompt: 'You review diffs for correctness.',
    mode: 'subagent',
    toolPolicy: 'readOnly',
    blockedTools: ['bash'],
    reasoningEffort: 'high'
  },
  engine: { kind: 'bound', harnessId: 'codex', displayName: 'Codex', credentialMode: 'native-login' },
  route: { harnessId: 'codex', model: 'gpt-5.5-codex', credentialMode: 'native-login' }
}

function roster(resolutions: Record<string, AgentRosterResolution>) {
  return { resolve: vi.fn(async (id: string) => resolutions[id] ?? { ok: false as const, code: 'not_found' as const, message: `unknown agent ${id}` }) }
}

const task = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  title: `Task ${key}`,
  objective: `Do ${key}.`,
  kind: 'work',
  dependsOn: [],
  dataFrom: [],
  acceptanceCriteria: ['done'],
  readScopes: ['.'],
  writeScopes: [],
  ...extra
})

describe('resolveGraphPlanRoles', () => {
  it('resolves roles for the graph lane and lets a task pin its own engine', async () => {
    const subject = roster({ reviewer })
    const result = await resolveGraphPlanRoles({
      tasks: [{ profile: 'reviewer', writeScopes: [] }, { profile: 'reviewer', harnessId: 'claude-code', writeScopes: [] }],
      roster: subject,
      workspace: '/repo',
      tasksPath: ['plan', 'tasks']
    })
    expect(result.issues).toEqual([])
    expect(result.roles.get('reviewer')?.route?.harnessId).toBe('codex')
    expect(subject.resolve).toHaveBeenNthCalledWith(1, 'reviewer', expect.objectContaining({ lane: 'graph', engineOverridden: false }))
    expect(subject.resolve).toHaveBeenNthCalledWith(2, 'reviewer', expect.objectContaining({ engineOverridden: true }))
  })

  it('reports unknown, blocked and read-only-with-writes roles at the profile path', async () => {
    const result = await resolveGraphPlanRoles({
      tasks: [
        { profile: 'ghost', writeScopes: [] },
        { profile: 'reviewer', writeScopes: ['src'] },
        { writeScopes: [] }
      ],
      roster: roster({ reviewer }),
      workspace: '/repo',
      tasksPath: ['plan', 'tasks']
    })
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'profile_not_found', path: ['plan', 'tasks', 0, 'profile'] }),
      expect.objectContaining({ code: 'profile_read_only', path: ['plan', 'tasks', 1, 'profile'] })
    ])
  })
})

describe('compileGraphPlanIntentV2 with roster roles', () => {
  it('builds an executor that plays the role on its bound engine and records provenance', async () => {
    const intent = GraphPlanIntentV2Schema.parse({
      tasks: [task('review', { profile: 'reviewer' }), task('plain')]
    })
    const { roles } = await resolveGraphPlanRoles({
      tasks: intent.tasks, roster: roster({ reviewer }), workspace: '/repo', tasksPath: ['plan', 'tasks']
    })
    const plan = compileGraphPlanIntentV2({
      intent,
      goal: 'Review the change',
      workspaceRoot: '/repo',
      nowIso: '2026-10-23T00:00:00.000Z',
      budgetDefaults: graphCreateBudgetDefaults(DEFAULT_GRAPH_RUNTIME_CONFIG),
      config: DEFAULT_GRAPH_RUNTIME_CONFIG,
      roles
    })
    const reviewNode = plan.nodes.find((node) => node.id === 'review')!
    expect(reviewNode.assignment).toMatchObject({
      kind: 'ephemeral',
      name: 'Codex Reviewer',
      harnessId: 'codex',
      model: 'gpt-5.5-codex',
      credentialMode: 'native-login',
      reasoningEffort: 'high',
      toolPolicy: 'readOnly',
      blockedTools: ['bash'],
      rosterProfileId: 'reviewer'
    })
    expect((reviewNode.assignment as { systemPrompt: string }).systemPrompt)
      .toMatch(/^You review diffs for correctness\.[\s\S]*Do review\./)
    expect(plan.nodes.find((node) => node.id === 'plain')!.assignment).toBeUndefined()
  })

  it('refuses to compile a profile that skipped roster resolution', () => {
    const intent = GraphPlanIntentV2Schema.parse({ tasks: [task('review', { profile: 'reviewer' })] })
    expect(() => compileGraphPlanIntentV2({
      intent,
      goal: 'Review',
      workspaceRoot: '/repo',
      nowIso: '2026-10-23T00:00:00.000Z',
      budgetDefaults: graphCreateBudgetDefaults(DEFAULT_GRAPH_RUNTIME_CONFIG),
      config: DEFAULT_GRAPH_RUNTIME_CONFIG
    })).toThrow(/not resolved through the agent roster/)
  })
})

describe('Graph Lead tool boundary', () => {
  it('lets the Lead read the roster without reopening child fan-out', () => {
    const lead = { orchestration: 'graph' as const }
    expect(isToolAllowedInOrchestration({ toolName: 'list_subagent_profiles', providerId: 'delegation', providerKind: 'delegation' }, lead)).toBe(true)
    expect(isToolAllowedInOrchestration({ toolName: 'delegate_task', providerId: 'delegation', providerKind: 'delegation' }, lead)).toBe(false)
  })
})
