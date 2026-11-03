import { describe, expect, it, vi } from 'vitest'
import type { GraphAgentProfileVersionV1 } from '../contracts/graph-agents.js'
import { SubagentProfileConfig } from '../contracts/capabilities.js'
import { createLearnedRosterProfiles } from './graph-learned-roster.js'

function profile(profileId: string, origin: GraphAgentProfileVersionV1['origin'], lifecycle: GraphAgentProfileVersionV1['lifecycle']) {
  return {
    version: 1, profileId, profileVersion: 1, origin, lifecycle, name: `Learned ${profileId}`,
    description: 'Learned from accepted Graph work.', systemPrompt: 'Fix flaky tests.',
    model: 'deepseek-chat', providerId: 'deepseek', reasoningEffort: 'high',
    capabilities: { taskTypes: [], capabilityTags: [], toolPolicy: 'readOnly', allowedTools: [], blockedTools: ['bash'],
      allowedSkills: [], blockedSkills: [], allowedMcpServers: [], blockedMcpServers: [],
      approvalPolicy: 'on-request', sandboxMode: 'read-only', readScopes: [], writeScopes: [], networkAllowed: false,
      maximumRiskClass: 'low' },
    provenanceEpisodeIds: [], createdAt: '2026-10-23T00:00:00.000Z', createdBy: 'learning'
  } as unknown as GraphAgentProfileVersionV1
}

describe('learned Graph profiles on the roster', () => {
  it('offers only trusted learned profiles as valid subagent roles and caches per workspace', async () => {
    let clock = 0
    const registry = {
      identify: vi.fn(async () => ({ projectId: 'project_1' }) as never),
      listProfiles: vi.fn(async () => [
        profile('flaky-fixer', 'learned', 'trusted'),
        profile('candidate', 'learned', 'probation'),
        profile('builtin-reviewer', 'builtin', 'trusted')
      ])
    }
    const learned = createLearnedRosterProfiles(registry, () => clock)
    const first = await learned('/repo')
    expect(first.map((entry) => entry.id)).toEqual(['flaky-fixer'])
    expect(SubagentProfileConfig.parse(first[0]!.profile)).toMatchObject({ toolPolicy: 'readOnly', blockedTools: ['bash'], surfaces: ['code'] })
    await learned('/repo')
    expect(registry.identify).toHaveBeenCalledTimes(1)
    clock += 31_000
    await learned('/repo')
    expect(registry.identify).toHaveBeenCalledTimes(2)
  })

  it('treats an unreadable project as having no learned roles', async () => {
    const learned = createLearnedRosterProfiles({ identify: async () => { throw new Error('not a repo') }, listProfiles: async () => [] })
    expect(await learned('/tmp/nowhere')).toEqual([])
  })
})
