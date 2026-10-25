import { describe, expect, it } from 'vitest'
import type { HarnessDefinition } from '../../contracts/harness.js'
import { allSupportedStatuses } from '../../contracts/harness-capabilities.js'
import { AgentRoster } from '../../delegation/agent-roster.js'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildListSubagentProfilesTool } from './delegation-profile-list-tool.js'

const def = (id: string): HarnessDefinition => BUILTIN_HARNESSES.find((entry) => entry.id === id)!

function rosterRuntime(): DelegationRuntime {
  const defs = [def('kun'), def('codex')]
  const roster = new AgentRoster({
    profiles: () => ({
      reviewer: {
        name: 'Codex Reviewer',
        description: 'Reviews diffs.',
        owns: 'owns code review. Do not review diffs yourself.',
        systemPrompt: 'secret system prompt',
        mode: 'subagent',
        toolPolicy: 'readOnly',
        harnessId: 'codex',
        model: 'gpt-5.5-codex'
      },
      persona: { name: 'Persona', mode: 'primary', toolPolicy: 'inherit' },
      helper: { name: 'Helper', mode: 'subagent', toolPolicy: 'inherit' }
    }),
    honorEngineBinding: () => true,
    defaultParent: () => ({ model: 'deepseek-chat', providerId: 'deepseek' }),
    engines: {
      catalog: { get: (id) => defs.find((entry) => entry.id === id) },
      detector: {
        cachedStatus: (harnessId) => ({ harnessId, installed: 'yes', login: 'signed-in', checkedAt: '2026-01-01T00:00:00.000Z' }),
        status: async (harnessId) => ({ harnessId, installed: 'yes', login: 'signed-in', checkedAt: '2026-01-01T00:00:00.000Z' })
      },
      capabilitiesForRoute: async () => ({
        statuses: { ...allSupportedStatuses(), kunTools: { supported: false, reason: 'upstream' } },
        facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'kun' }
      })
    }
  })
  return {
    enabled: () => true,
    useExistingAgents: true,
    roster,
    listRoutingProfiles: async () => { throw new Error('roster listings must not read the plain catalog') }
  } as unknown as DelegationRuntime
}

const context = { workspace: '/repo', agentSurface: 'code' } as unknown as ToolHostContext

describe('list_subagent_profiles roster listing', () => {
  it('lists dispatchable roles with engine, capability tags, ownership and lane status', async () => {
    const tool = buildListSubagentProfilesTool(rosterRuntime(), true)
    const result = await tool.execute({}, context)
    const output = result.output as { profileCount: number; profiles: Array<Record<string, unknown>>; guidance: string }
    expect(output.profileCount).toBe(2)
    expect(output.profiles.map((profile) => profile.id)).toEqual(['helper', 'reviewer'])
    expect(output.profiles[0]).toMatchObject({ engine: 'inherits main route', lanes: { delegate: 'ok', worker: 'ok', graph: 'ok' } })
    expect(output.profiles[1]).toMatchObject({
      engine: 'codex · gpt-5.5-codex',
      owns: 'owns code review. Do not review diffs yourself.',
      tags: ['read-only', 'resumable', 'live-progress', 'no-kun-tools', 'asks-user'],
      lanes: { delegate: 'ok', worker: 'ok', graph: expect.stringMatching(/^capability_missing: /) }
    })
    expect(output.guidance).toContain('worker_create.profile')
    expect(JSON.stringify(output)).not.toContain('secret system prompt')
  })
})
