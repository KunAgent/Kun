import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomService } from '../rooms/room-service.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { externalDiscussionApprovalPolicy, EXTERNAL_AGENT_BLOCKED_TOOLS } from './agent-external.js'
import { checkHarnessAdmission } from '../harness/harness-admission.js'
import { usageForTurn } from '../harness/usage-for-turn.js'
import { harnessTurnPermissionMode } from '../harness/harness-turn-permissions.js'
import { ACP_DEFAULT_CAPABILITIES, BUILTIN_HARNESSES, CLAUDE_CODE_CAPABILITIES,
  CODEX_APP_SERVER_CAPABILITIES } from '../harness/builtin-harnesses.js'
import type { AgentExecutor } from '../contracts/agent-executor.js'
import type { HarnessCapabilities } from '../contracts/harness-capabilities.js'
import type { Room } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'

const codex: AgentExecutor = { kind: 'harness', harnessId: 'codex', credentialMode: 'native-login', model: 'gpt-5.5' }
const definition = (id: string) => BUILTIN_HARNESSES.find((entry) => entry.id === id)!
const roomThread = (kind: string) => ({ roomContext: { roomId: 'r', memberId: 'm', kind } }) as unknown as ThreadRecord

const resources: Array<{ store: SqliteRoomStore; dir: string }> = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-agent-external-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
  resources.push({ store, dir })
  const agents = new AgentIdentityService(store, () => ({
    general: { mode: 'subagent', toolPolicy: 'inherit', systemPrompt: 'profile', blockedTools: [] }
  }))
  const validated: AgentExecutor[] = []
  agents.setExecutorValidator(async (executor) => { validated.push(executor); return { ...executor, accountId: 'acct' } })
  const rooms = new RoomService(store, () => {})
  rooms.setAgentDirectory(agents)
  return { store, agents, rooms, validated }
}
afterEach(async () => {
  for (const { store, dir } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) }
})

describe('external coding Agent admission', () => {
  it('admits private chats and discussion with a native sandbox but keeps room work host-enforced', () => {
    for (const kind of ['conversation', 'discussion']) expect(usageForTurn(roomThread(kind), {} as Turn)).toBe('room-conversation')
    for (const kind of ['coordination', 'execution', 'review']) expect(usageForTurn(roomThread(kind), {} as Turn)).toBe('room-execution')
    const cases: Array<[string, HarnessCapabilities]> = [
      ['codex', CODEX_APP_SERVER_CAPABILITIES], ['opencode', ACP_DEFAULT_CAPABILITIES], ['claude-code', CLAUDE_CODE_CAPABILITIES]]
    for (const [id, effective] of cases) {
      const admit = (usage: 'room-conversation' | 'room-execution') => checkHarnessAdmission({ usage, harness: definition(id), effective,
        status: { harnessId: id, installed: 'yes', login: 'signed-in', checkedAt: '2026-10-07T00:00:00.000Z' },
        credentialMode: 'native-login', workspace: { isolated: false }, unattended: false, allowUnattendedFullAccess: false })
      expect(admit('room-conversation').ok).toBe(true)
      if (id !== 'claude-code') expect(admit('room-execution').ok).toBe(false)
    }
  })

  it('pins the strictest native mode for read-only discussion and declines unattended escalations', () => {
    const readOnly = { sandboxMode: 'read-only' as const, unattended: false, allowUnattendedFullAccess: false }
    expect(harnessTurnPermissionMode(definition('codex'), readOnly)).toBe('read-only')
    expect(harnessTurnPermissionMode(definition('opencode'), readOnly)).toBe('plan')
    expect(harnessTurnPermissionMode(definition('claude-code'), readOnly)).toBe('default')
    expect(externalDiscussionApprovalPolicy(codex)).toBe('never')
    expect(externalDiscussionApprovalPolicy({ ...codex, harnessId: 'claude-code' })).toBeUndefined()
    expect(EXTERNAL_AGENT_BLOCKED_TOOLS).toEqual(expect.arrayContaining(['send_im_message', 'send_agent_message', 'create_goal']))
  })
})

describe('external coding Agent identities', () => {
  it('validates the route, drops Kun-only settings and keeps the engine fixed', async () => {
    const { agents, validated } = await fixture()
    const { agent } = await agents.create({ clientRequestId: 'codex', name: 'Codex', executor: codex,
      avatar: { kind: 'harness', harnessId: 'codex' }, modelRef: { providerId: 'native', model: 'kun-model' } })
    expect(validated).toHaveLength(1)
    expect(agent.executor).toEqual({ ...codex, accountId: 'acct' })
    expect(agent.modelRef).toBeUndefined()
    expect(agent.memory).toEqual({ readEnabled: false, captureEnabled: false })
    const renamed = await agents.update(agent.id, { clientRequestId: 'model', expectedRevision: 0,
      executor: { ...agent.executor!, model: 'gpt-5.5-mini' } })
    expect(renamed.agent.executor?.model).toBe('gpt-5.5-mini')
    expect(validated).toHaveLength(2)
    await agents.update(agent.id, { clientRequestId: 'rename', expectedRevision: 1, name: 'Codex (work)' })
    expect(validated).toHaveLength(2)
    await expect(agents.update(agent.id, { clientRequestId: 'engine', expectedRevision: 2,
      executor: { ...agent.executor!, harnessId: 'opencode' } })).rejects.toThrow('engine route cannot change')
    await expect(agents.create({ clientRequestId: 'mark', name: 'Ada', avatar: { kind: 'harness', harnessId: 'codex' } }))
      .rejects.toThrow('engine marks')
    const kun = (await agents.create({ clientRequestId: 'kun', name: 'Ada' })).agent
    await expect(agents.update(kun.id, { clientRequestId: 'review', expectedRevision: 0, reviewerAgentId: agent.id }))
      .rejects.toThrow('cannot review')
  })

  it('requires a Kun lead in groups and freezes the engine route with mention-only attention', async () => {
    const { agents, rooms } = await fixture()
    const external = (await agents.create({ clientRequestId: 'codex', name: 'Codex', executor: codex })).agent
    const kun = (await agents.create({ clientRequestId: 'kun', name: 'Ada' })).agent
    const members = [{ ...agents.asMember(kun), id: 'lead' }, { ...agents.asMember(external), id: 'coder', executor: { ...codex, model: 'forged' } }]
    await expect(rooms.create({ clientRequestId: 'bad', name: 'Team', defaultMemberId: 'coder', members }))
      .rejects.toThrow('a Kun Agent must lead')
    const created = await rooms.create({ clientRequestId: 'good', name: 'Team', defaultMemberId: 'lead', members })
    const stored = (await rooms.store.get<Room>('room', created.room.id))!.value
    expect(stored.members.find((member) => member.id === 'coder')?.executor).toBeUndefined()
    const frozen = await agents.freeze(stored)
    const coder = frozen.members.find((member) => member.id === 'coder')!
    expect(coder.executor?.model).toBe('gpt-5.5')
    expect(coder.attention).toBe('mentions')
    expect(frozen.members.find((member) => member.id === 'lead')?.executor).toBeUndefined()
  })
})
