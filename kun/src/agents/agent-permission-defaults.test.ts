import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Room } from '../contracts/rooms.js'
import type { SubagentProfileConfig } from '../contracts/capabilities-core.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import { RoomService, putRoomDocument } from '../rooms/room-service.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { quickCreateAgent } from './agent-chat-entry.js'
import { openAgentConversation } from './agent-conversations.js'
import { defaultAgentExecutionPolicy, newAgentExecutionPolicy } from './agent-permission-snapshot.js'

const full = kunToolPermissionModeSettings('full-access')
const restricted = kunToolPermissionModeSettings('ask-for-approval')
const personal = { id: 'agent-default-kun', templateId: 'kun' }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose() })

async function fixture(toolPolicy: SubagentProfileConfig['toolPolicy'] = 'inherit') {
  const root = await mkdtemp(join(tmpdir(), 'kun-personal-permissions-'))
  const store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') })
  cleanup.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }) })
  const agents = new AgentIdentityService(store, () => ({ general: { mode: 'subagent', toolPolicy } }))
  const rooms = new RoomService(store, () => {})
  rooms.setAgentDirectory(agents)
  const created = await quickCreateAgent(agents, { clientRequestId: 'personal' }, true)
  return { store, agents, rooms, created }
}

describe('fresh personal Agent permission defaults', () => {
  it('recognizes only the built-in personal identity and honors profile and directory limits', () => {
    expect(newAgentExecutionPolicy(personal, { toolPolicy: 'inherit' })).toEqual(full)
    for (const agent of [undefined, { id: 'custom', templateId: 'kun' },
      { id: personal.id, templateId: 'reviewer' }, { ...personal, allowedRepositoryRoots: [] },
      { ...personal, allowedRepositoryRoots: ['/project'] }]) {
      expect(newAgentExecutionPolicy(agent, { toolPolicy: 'inherit' })).toEqual(restricted)
    }
    expect(newAgentExecutionPolicy(personal, { toolPolicy: 'readOnly' })).toEqual(restricted)
    expect(newAgentExecutionPolicy(personal)).toEqual(restricted)
    expect(defaultAgentExecutionPolicy()).toEqual(restricted)
  })

  it('persists Full access for fresh built-in quick-create and ordinary conversation creation only', async () => {
    const { store, agents, rooms, created } = await fixture()
    expect((await store.get<Room>('room', created.roomId))!.value.privateExecutionPolicy).toEqual(full)
    expect(await quickCreateAgent(agents, { clientRequestId: 'replay' }, true)).toEqual(created)
    await rooms.update(created.roomId, { clientRequestId: 'delete-empty', expectedRevision: 0, deleted: true })
    const reopened = await openAgentConversation(agents, rooms, created.agentId)
    expect(reopened.room.id).not.toBe(created.roomId)
    expect(reopened.room.privateExecutionPolicy).toEqual(full)

    for (const input of [{ clientRequestId: 'custom', setupMode: 'form' },
      { clientRequestId: 'template', templateId: 'researcher' }]) {
      const other = await quickCreateAgent(agents, input)
      expect((await rooms.get(other.roomId)).privateExecutionPolicy).toEqual(restricted)
    }
    const copy = await agents.create({ clientRequestId: 'copy', copyFromAgentId: created.agentId, name: 'My copy' })
    expect((await openAgentConversation(agents, rooms, copy.agent.id)).room.privateExecutionPolicy).toEqual(restricted)
    expect((await rooms.create({ clientRequestId: 'group', name: 'Team' })).room.privateExecutionPolicy).toBeUndefined()
  })

  it('starts restricted when the built-in profile is read-only or the recreated identity has directory limits', async () => {
    const readOnly = await fixture('readOnly')
    expect((await readOnly.rooms.get(readOnly.created.roomId)).privateExecutionPolicy).toEqual(restricted)
    const { agents, rooms, created } = await fixture()
    await rooms.update(created.roomId, { clientRequestId: 'delete-empty', expectedRevision: 0, deleted: true })
    await agents.update(created.agentId, { clientRequestId: 'limit-directories', expectedRevision: 0, allowedRepositoryRoots: [] })
    expect((await openAgentConversation(agents, rooms, created.agentId)).room.privateExecutionPolicy).toEqual(restricted)
  })

  it.each(['ask-for-approval', 'approve-for-me', 'full-access'] as const)(
    'preserves the saved %s policy when reopening and initializing', async (mode) => {
      const { store, agents, rooms, created } = await fixture()
      const saved = (await store.get<Room>('room', created.roomId))!
      const policy = kunToolPermissionModeSettings(mode)
      await putRoomDocument(store, 'room', saved.id, saved.id, { ...saved.value, privateExecutionPolicy: policy }, saved)
      await agents.initialize()
      expect((await openAgentConversation(agents, rooms, created.agentId)).room.privateExecutionPolicy).toEqual(policy)
      expect((await store.get<Room>('room', saved.id))!.value.privateExecutionPolicy).toEqual(policy)
    }
  )

  it('keeps legacy unset personal permissions restricted during admission and migration without changing accepted requests', async () => {
    const { store, agents, rooms, created } = await fixture()
    const saved = (await store.get<Room>('room', created.roomId))!
    const { privateExecutionPolicy: _policy, ...legacy } = saved.value
    await putRoomDocument(store, 'room', saved.id, saved.id, legacy, saved)
    const reopened = await openAgentConversation(agents, rooms, created.agentId)
    expect(reopened.room.privateExecutionPolicy).toBeUndefined()
    const sent = await rooms.send(created.roomId, { clientRequestId: 'legacy-send', body: 'Explain the project' })
    const accepted = (await store.get<RoomRequestState>('request', sent.requestId))!
    expect(accepted.value.roomSnapshot.privateExecutionPolicy).toEqual(restricted)
    await agents.initialize()
    expect((await rooms.get(created.roomId)).privateExecutionPolicy).toEqual(restricted)
    expect(await store.get('request', sent.requestId)).toEqual(accepted)
  })
})
