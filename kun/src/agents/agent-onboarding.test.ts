import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { agentOnboardingState, updateAgentOnboarding } from './agent-onboarding.js'
import { DEFAULT_AGENT_TEMPLATES } from './agent-defaults.js'
import { RoomService } from '../rooms/room-service.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-onboarding-')), store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ dir, store }); const agents = new AgentIdentityService(store, () => ({}))
  return { store, agents }
}
afterEach(async () => { for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) } })
it('atomically seeds distinct identities and empty conversations without work or memory', async () => {
  const { store, agents } = await fixture()
  expect((await agentOnboardingState(agents)).fresh).toBe(true)
  const commit = vi.spyOn(store, 'commit')
  const request = { clientRequestId: 'first', action: 'initialize', expectedRevision: null }
  const result = await updateAgentOnboarding(agents, request)
  expect(result.completed).toBe(true)
  expect(Object.keys(result.bindings!)).toEqual(DEFAULT_AGENT_TEMPLATES.map((template) => template.templateId))
  expect(new Set(Object.values(result.bindings!)).size).toBe(5)
  expect((await store.list('room')).length).toBe(6)
  for (const kind of ['message', 'request', 'agent_memory_job'] as const) expect(await store.list(kind)).toEqual([])
  const mutation = commit.mock.calls.find(([input]) => input.requestId === 'agent-onboarding:first')![0]
  expect(mutation.puts).toHaveLength(12)
  expect((await agents.get(result.bindings!.developer)).reviewerAgentId).toBe(result.bindings!.reviewer)
  expect((await updateAgentOnboarding(agents, request)).bindings).toEqual(result.bindings)
  expect((await agentOnboardingState(new AgentIdentityService(store, () => ({})))).bindings).toEqual(result.bindings)
})
it('retains a dismissed setup and reuses selected exact identities without modifying them', async () => {
  const { store, agents } = await fixture()
  const old = (await agents.create({ clientRequestId: 'old', name: 'My developer', instructions: 'Keep my rules', modelRef: { model: 'custom', providerId: 'test' } })).agent
  const state = await agentOnboardingState(agents)
  expect(state.fresh).toBe(false)
  await updateAgentOnboarding(agents, { action: 'dismiss', expectedRevision: null, clientRequestId: 'dismiss' })
  const dismissed = await agentOnboardingState(agents)
  expect(dismissed.dismissed).toBe(true)
  const result = await updateAgentOnboarding(agents, { action: 'complete', expectedRevision: dismissed.revision, clientRequestId: 'complete',
    selections: state.slots.map((slot) => ({ templateId: slot.templateId, agentId: slot.templateId === 'developer' ? old.id : null,
      ...(slot.templateId === 'developer' ? { revision: old.revision } : {}) })) })
  expect(await agents.get(old.id)).toEqual(old)
  expect(result.bindings!.developer).toBe(old.id)
  expect((await store.list('agent_identity')).length).toBe(5)
})
it('recovers a failed atomic commit and rejects reuse of changed request bodies', async () => {
  const { agents, store } = await fixture()
  await agentOnboardingState(agents)
  const commit = vi.spyOn(store, 'commit').mockRejectedValueOnce(new Error('disk unavailable'))
  const request = { action: 'initialize', expectedRevision: null, clientRequestId: 'retry' }
  await expect(updateAgentOnboarding(agents, request)).rejects.toThrow('unavailable')
  expect(await store.list('agent_identity')).toEqual([])
  commit.mockRestore()
  expect((await updateAgentOnboarding(agents, request)).completed).toBe(true)
  await expect(updateAgentOnboarding(agents, { ...request, action: 'dismiss' })).rejects.toThrow('changed')
})
it('gives templates with the same execution role different room memberships', async () => {
  const { agents, store } = await fixture()
  await agents.defaultMembers([])
  const state = await agentOnboardingState(agents)
  expect(state.fresh).toBe(false)
  expect(new Set(state.slots.map((slot) => slot.agent?.id)).size).toBe(5)
  const service = new RoomService(store, () => {}); service.setAgentDirectory(agents)
  const room = (await service.create({ clientRequestId: 'group', name: 'Team' })).room
  expect(new Set(room.members.map((member) => member.id)).size).toBe(5)
  expect(new Set(room.members.map((member) => member.participantAgentId)).size).toBe(5)
})
it('concurrent identical initialization returns the same completed team', async () => {
  const { agents, store } = await fixture()
  await agentOnboardingState(agents)
  const input = { action: 'initialize', expectedRevision: null, clientRequestId: 'concurrent' }
  const [a, b] = await Promise.all([updateAgentOnboarding(agents, input), updateAgentOnboarding(agents, input)])
  expect(a.bindings).toEqual(b.bindings)
  expect(await store.list('room')).toHaveLength(6)
})
it('does not restore archived defaults and rejects a changed selected profile before writing', async () => {
  const { agents, store } = await fixture()
  await agents.defaultMembers([])
  const state = await agentOnboardingState(agents)
  const developer = state.slots.find((slot) => slot.templateId === 'developer')!.agent!
  await agents.update(developer.id, { clientRequestId: 'archive', expectedRevision: developer.revision, archived: true })
  await expect(updateAgentOnboarding(agents, { action: 'complete', expectedRevision: null, clientRequestId: 'old-selection',
    selections: state.slots.map((slot) => ({ templateId: slot.templateId, agentId: slot.agent!.id, revision: slot.agent!.revision })) })).rejects.toThrow('archived')
  expect(await store.list('room')).toEqual([])
  const current = await agentOnboardingState(agents)
  const result = await updateAgentOnboarding(agents, { action: 'complete', expectedRevision: null, clientRequestId: 'new-developer',
    selections: current.slots.map((slot) => ({ templateId: slot.templateId, agentId: slot.agent?.id ?? null, revision: slot.agent?.revision })) })
  expect(result.bindings!.developer).not.toBe(developer.id)
  expect((await agents.get(developer.id)).archivedAt).toBeTruthy()
})
