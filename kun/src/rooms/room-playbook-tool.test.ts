import { describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { roomPlaybookTool } from './room-playbook-tool.js'
import { ROOM_PLAYBOOKS, type RoomPlaybookId } from './room-playbooks.js'

const kinds = ['coordination', 'discussion', 'execution', 'review', 'conversation'] as const
async function fixture() {
  const threads = new InMemoryThreadStore()
  const thread = createThreadRecord({ id: 'room-thread', title: 'Member', workspace: '/workspace', model: 'test',
    roomContext: { roomId: 'room', memberId: 'member', kind: 'discussion',
      blockedToolNames: [], blockedSkillIds: [], blockedProviderIds: [] } })
  thread.turns.push(createTurnRecord({ id: 'turn', threadId: thread.id, prompt: 'Discuss', status: 'running' }))
  await threads.upsert(thread)
  const context = (overrides: Partial<ToolHostContext> = {}): ToolHostContext => ({
    threadId: thread.id, turnId: 'turn', workspace: '/workspace', sandboxMode: 'read-only', approvalPolicy: 'auto',
    threadMode: 'plan', abortSignal: new AbortController().signal, awaitApproval: async () => 'allow',
    roomStepKind: 'discussion', ...overrides })
  return { threads, tool: roomPlaybookTool(threads), context }
}

describe('read_room_playbook', () => {
  it('advertises on every room step kind and nowhere else', async () => {
    const f = await fixture()
    expect(f.tool.shouldAdvertise?.(f.context({ roomStepKind: undefined }))).toBe(false)
    for (const kind of kinds) expect(f.tool.shouldAdvertise?.(f.context({ roomStepKind: kind }))).toBe(true)
  })

  it('returns the playbook index without bodies when called with no id', async () => {
    const f = await fixture()
    const result = await f.tool.execute({}, f.context())
    expect(result.isError).toBeFalsy()
    const output = result.output as { playbooks: Array<{ id: string; title: string; triggers: string[]; body?: string }> }
    expect(output.playbooks.map((entry) => entry.id).sort()).toEqual(Object.keys(ROOM_PLAYBOOKS).sort())
    for (const entry of output.playbooks) {
      expect(entry.title).toBe(ROOM_PLAYBOOKS[entry.id as RoomPlaybookId].title)
      expect(entry.triggers).toEqual(ROOM_PLAYBOOKS[entry.id as RoomPlaybookId].triggers)
      expect(entry.body).toBeUndefined()
      expect(Buffer.byteLength(ROOM_PLAYBOOKS[entry.id as RoomPlaybookId].body)).toBeLessThanOrEqual(6000)
    }
  })

  it('returns the full body for a known id', async () => {
    const f = await fixture()
    const result = await f.tool.execute({ id: 'evidence-handoff' }, f.context())
    expect(result).toMatchObject({ output: { id: 'evidence-handoff',
      title: ROOM_PLAYBOOKS['evidence-handoff'].title, body: ROOM_PLAYBOOKS['evidence-handoff'].body } })
  })

  it('rejects an unknown id with an error result and the available index', async () => {
    const f = await fixture()
    const result = await f.tool.execute({ id: 'not-a-playbook' }, f.context())
    expect(result.isError).toBe(true)
    const output = result.output as { error: string; available: Array<{ id: string }> }
    expect(output.error).toContain('unknown')
    expect(output.available.map((entry) => entry.id).sort()).toEqual(Object.keys(ROOM_PLAYBOOKS).sort())
  })

  it('rejects calls outside a room step scope or turn binding', async () => {
    const f = await fixture()
    expect((await f.tool.execute({}, f.context({ roomStepKind: undefined }))).isError).toBe(true)
    expect((await f.tool.execute({}, f.context({ threadId: 'unknown' }))).isError).toBe(true)
    expect((await f.tool.execute({}, f.context({ turnId: 'unknown' }))).isError).toBe(true)
    expect((await f.tool.execute({ id: 'discuss-then-propose' }, f.context({ roomStepKind: 'execution' }))).isError).toBeFalsy()
  })
})
