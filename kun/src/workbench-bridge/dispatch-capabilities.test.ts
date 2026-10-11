import { describe, expect, it, vi } from 'vitest'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import { SubagentProfileConfig } from '../contracts/capabilities-core.js'
import { applyWorkbenchToolPolicy } from '../loop/workbench-turn-policy.js'
import { narrowWorkbenchCapabilities } from './dispatch-capabilities.js'
import { dispatchFixture } from './dispatch-test-support.js'
import { reconcileWorkbench } from './reconcile.js'

vi.mock('../rooms/room-continuation-service.js', () => ({ enqueuePrivateContinuation: vi.fn(async () => 'queued') }))

describe('live dispatch capability restrictions', () => {
  it.each(['countdown', 'queued'] as const)('applies profile revocation while %s before the first turn', async (stage) => {
    const f = await dispatchFixture()
    Object.assign(f.thread.roomContext!, { blockedProviderIds: ['original-mcp'], blockedSkillIds: ['original-skill'] })
    await f.deps.threadStore.upsert(f.thread)
    const created = await f.create()
    if (stage === 'queued') {
      f.clock.now += 60_000
      await f.service.reconcile()
      await reconcileWorkbench(f.bridge)
      expect(f.stub.calls.created).toHaveLength(1)
      expect(f.stub.calls.enqueued).toHaveLength(0)
    }
    const identity = (await f.store.get<AgentIdentity>('agent_identity', 'agent-1'))!.value
    f.deps.profiles = () => ({ [identity.presetId]: SubagentProfileConfig.parse({
      blockedTools: ['write'], blockedMcpServers: ['newly-blocked-mcp'], blockedSkills: ['newly-blocked-skill'], skillsEnabled: false
    }) })
    f.clock.now += 60_000
    await f.start()
    const link = (await f.link(created.linkId)).value
    const target = f.stub.threads.get(link.threadId!)!
    expect(f.stub.calls.enqueued).toHaveLength(1)
    expect(target.workbenchOrigin?.capabilityCeiling).toMatchObject({
      blockedToolNames: ['write'], blockedProviderIds: ['original-mcp', 'newly-blocked-mcp'],
      blockedSkillIds: ['original-skill', 'newly-blocked-skill'], skillsEnabled: false
    })
    const execution = applyWorkbenchToolPolicy({ ...f.context(), workspace: target.workspace, threadId: target.id }, target)
    expect(execution.blockedProviderIds).toEqual(expect.arrayContaining(['mcp:newly-blocked-mcp']))
    expect(execution.blockedToolNames).toEqual(expect.arrayContaining(['write', 'load_skill', 'load_skill_asset']))
    expect(execution.allowedSkillIds).toEqual([])
    expect(execution.blockedSkillIds).toContain('newly-blocked-skill')
  })

  it('retains captured restrictions after a profile is relaxed or removed', async () => {
    const f = await dispatchFixture()
    const identity = (await f.store.get<AgentIdentity>('agent_identity', 'agent-1'))!.value
    f.deps.profiles = () => ({ [identity.presetId]: SubagentProfileConfig.parse({
      blockedMcpServers: ['restricted-mcp'], blockedSkills: ['restricted-skill'], skillsEnabled: false
    }) })
    const restricted = await narrowWorkbenchCapabilities(f.bridge, f.room.id, 'agent-member')
    f.deps.profiles = () => ({ [identity.presetId]: SubagentProfileConfig.parse({ skillsEnabled: true }) })
    expect(await narrowWorkbenchCapabilities(f.bridge, f.room.id, 'agent-member', restricted)).toEqual(restricted)
    f.deps.profiles = () => ({})
    expect(await narrowWorkbenchCapabilities(f.bridge, f.room.id, 'agent-member', restricted)).toEqual(restricted)
  })
})
