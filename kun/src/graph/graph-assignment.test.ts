import { describe, expect, it } from 'vitest'
import type { ProjectAgentRegistry } from './project-agent-registry.js'
import { GraphAssignmentResolver, type GraphParentAuthority } from './graph-assignment.js'
import { testGraphPlan } from './graph-test-fixtures.test-support.js'

const parent: GraphParentAuthority = {
  workspaceRoot: '/workspace',
  model: 'parent-model',
  providerId: 'parent-provider',
  accountId: 'account-input-model',
  allowedModelProviderIds: ['parent-provider'],
  allowedModels: ['parent-model'],
  allowedProviderIds: ['builtin', 'mcp:facade', 'extension:com.example.tools'],
  reasoningEffort: 'medium',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
  approvalReviewer: 'agent',
  allowedTools: [
    'read',
    'write',
    'graph_worker_progress',
    'graph_worker_submit_result'
  ],
  blockedTools: ['bash'],
  allowedSkills: ['safe-skill'],
  blockedSkills: [],
  allowedMcpServers: ['safe-mcp', 'other-mcp'],
  blockedMcpServers: [],
  readScopes: ['src'],
  writeScopes: ['src/generated'],
  networkAllowed: false
}

const registry = {
  getProfile: async () => null
} as unknown as ProjectAgentRegistry

describe('GraphAssignmentResolver', () => {
  it('uses a graph-scoped least-authority fallback when a requested profile is missing', async () => {
    const source = testGraphPlan().nodes[0]!
    const node = {
      ...source,
      assignment: {
        kind: 'existing' as const,
        profileId: 'explore'
      }
    }
    const assignment = await new GraphAssignmentResolver({ registry }).resolve({
      projectId: 'project_1',
      node,
      reference: node.assignment,
      parent,
      maxWallTimeMs: 60_000
    })

    expect(assignment).toMatchObject({
      profileOrigin: 'ephemeral',
      requestedProfileId: 'explore',
      name: 'Research fallback',
      toolPolicy: 'readOnly',
      allowedTools: ['read', 'report_to_parent', 'write'],
      readScopes: ['src'],
      writeScopes: []
    })
    expect(assignment.profileId).toMatch(/^ephemeral_/)
    expect(assignment.routingReason).toContain('explore')
    expect(assignment.systemPrompt).toContain(source.objective)
  })

  it('freezes a least-authority assignment and blocks worker delegation controls', async () => {
    const source = testGraphPlan().nodes[0]!
    const node = {
      ...source,
      writeScopes: ['src/generated'],
      assignment: {
        kind: 'ephemeral' as const,
        name: 'Scoped worker',
        systemPrompt: 'Perform the bounded task.',
        toolPolicy: 'inherit' as const,
        allowedTools: ['read', 'write', 'bash', 'delegate_task'],
        blockedTools: [],
        allowedSkills: ['safe-skill', 'unknown-skill'],
        blockedSkills: [],
        allowedMcpServers: ['safe-mcp', 'unknown-mcp'],
        blockedMcpServers: []
      }
    }
    const assignment = await new GraphAssignmentResolver({ registry }).resolve({
      projectId: 'project_1',
      node,
      reference: node.assignment,
      parent,
      maxWallTimeMs: 60_000
    })

    expect(assignment).toMatchObject({
      model: 'parent-model',
      providerId: 'parent-provider',
      accountId: 'account-input-model',
      approvalReviewer: 'agent',
      allowedTools: ['read', 'report_to_parent', 'write'],
      allowedSkills: ['safe-skill'],
      allowedMcpServers: ['safe-mcp'],
      allowedProviderIds: ['builtin', 'mcp:facade', 'extension:com.example.tools'],
      blockedMcpServers: ['other-mcp'],
      readScopes: ['src'],
      writeScopes: ['src/generated'],
      networkAllowed: false
    })
    expect(assignment.blockedTools).toEqual(expect.arrayContaining([
      'bash',
      'delegate_task',
      'generate_subagent',
      'graph_control_run',
      'graph_supervise_node',
      'graph_worker_progress',
      'graph_worker_submit_result',
      'list_subagent_profiles',
      'task_graph'
    ]))
    expect(assignment.blockedTools).not.toContain('report_to_parent')
  })

  it('carries ephemeral harness routing into the resolved snapshot', async () => {
    const node = {
      ...testGraphPlan().nodes[0]!,
      assignment: {
        kind: 'ephemeral' as const,
        name: 'Claude worker',
        systemPrompt: 'Do the task.',
        harnessId: 'claude-code' as const,
        credentialMode: 'native-login' as const,
        toolPolicy: 'readOnly' as const,
        blockedTools: [],
        blockedSkills: [],
        blockedMcpServers: []
      }
    }
    const assignment = await new GraphAssignmentResolver({ registry }).resolve({
      projectId: 'project_1',
      node,
      reference: node.assignment,
      parent,
      maxWallTimeMs: 60_000
    })

    expect(assignment.harnessId).toBe('claude-code')
    expect(assignment.credentialMode).toBe('native-login')
  })

  it('leaves harness routing unset for profile and fallback assignments', async () => {
    const node = {
      ...testGraphPlan().nodes[0]!,
      assignment: { kind: 'existing' as const, profileId: 'explore' }
    }
    const assignment = await new GraphAssignmentResolver({ registry }).resolve({
      projectId: 'project_1',
      node,
      reference: node.assignment,
      parent,
      maxWallTimeMs: 60_000
    })

    expect(assignment.harnessId).toBeUndefined()
    expect(assignment.credentialMode).toBeUndefined()
  })

  it('rejects node scopes that expand the parent authority', async () => {
    const node = {
      ...testGraphPlan().nodes[0]!,
      readScopes: ['secrets'],
      assignment: {
        kind: 'ephemeral' as const,
        name: 'Escalating worker',
        systemPrompt: 'Read outside scope.',
        toolPolicy: 'readOnly' as const,
        blockedTools: [],
        blockedSkills: [],
        blockedMcpServers: []
      }
    }
    await expect(new GraphAssignmentResolver({ registry }).resolve({
      projectId: 'project_1',
      node,
      reference: node.assignment,
      parent,
      maxWallTimeMs: 60_000
    })).rejects.toThrow('expands parent authority')
  })

  it('rejects model and provider overrides outside the captured parent allow-list', async () => {
    const node = {
      ...testGraphPlan().nodes[0]!,
      assignment: {
        kind: 'ephemeral' as const,
        name: 'Routing escalation',
        systemPrompt: 'Try another provider.',
        model: 'unapproved-model',
        providerId: 'unapproved-provider',
        toolPolicy: 'readOnly' as const,
        blockedTools: [],
        blockedSkills: [],
        blockedMcpServers: []
      }
    }
    await expect(new GraphAssignmentResolver({ registry }).resolve({
      projectId: 'project_1',
      node,
      reference: node.assignment,
      parent,
      maxWallTimeMs: 60_000
    })).rejects.toThrow('expands parent authority')
  })
})
