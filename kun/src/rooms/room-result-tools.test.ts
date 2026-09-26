import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeAssistantTextItem, makeToolResultItem } from '../domain/item.js'
import { roomResultProvider, RoomChecksSchema, RoomReviewResultSchema } from './room-result-tools.js'
import { ensureRoomThread, observeRoomTurn } from './room-execution.js'
import { applyRoomToolPolicy } from '../loop/room-turn-policy.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import type { RoomMember } from '../contracts/rooms.js'
import { makeFakeModel, makeHarness } from '../../tests/loop-test-harness.js'

const cleanup: string[] = []
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }) })
function rawContext(threadId: string): ToolHostContext {
  return { threadId, turnId: 'turn', workspace: '/workspace', sandboxMode: 'read-only', approvalPolicy: 'auto', threadMode: 'plan',
    abortSignal: new AbortController().signal, awaitApproval: async () => 'allow' }
}

describe('scoped Room result tools', () => {
  it('advertises only the current step, rejects fabricated scope and preserves the active turn catalog across reload', async () => {
    const threads = new InMemoryThreadStore()
    const provider = roomResultProvider(threads)
    const host = new LocalToolHost({ registry: new CapabilityRegistry([provider]) })
    const thread = createThreadRecord({ id: 'coord', title: 'Coordinator', workspace: '/workspace', model: 'test',
      roomContext: { roomId: 'room', memberId: 'coordinator', kind: 'coordination', blockedToolNames: [], blockedSkillIds: [], blockedProviderIds: [] } })
    thread.turns.push(createTurnRecord({ id: 'turn', threadId: thread.id, prompt: 'Discuss' }))
    await threads.upsert(thread)
    expect(await host.listTools(rawContext('normal'))).toEqual([])
    const context = applyRoomToolPolicy(rawContext(thread.id), thread)
    expect((await host.listTools(context)).map((tool) => tool.name)).toEqual(['read_room_rules', 'read_room_playbook', 'submit_room_plan'])
    host.replaceRuntimeComponents({ registry: new CapabilityRegistry([roomResultProvider(threads)]) })
    const result = await host.execute({ callId: 'valid', toolName: 'submit_room_plan', arguments: { kind: 'answer', response: 'Done' } }, context)
    expect(result.item).toMatchObject({ isError: false, output: { accepted: true, value: { kind: 'answer' } } })
    await expect(host.execute({ callId: 'wrong', toolName: 'submit_room_review', arguments: {} }, context)).rejects.toThrow()
    const forged = await provider.tools.find((tool) => tool.name === 'submit_room_plan')!.execute({ kind: 'answer', response: 'Forged' }, { ...rawContext('normal'), roomStepKind: 'coordination' })
    expect(forged.isError).toBe(true)
    const unknownTurn = await provider.tools.find((tool) => tool.name === 'submit_room_plan')!.execute({ kind: 'answer', response: 'Forged' }, { ...context, turnId: 'unknown' })
    expect(unknownTurn.isError).toBe(true)
  })

  it('validates reviews using the persisted review rules and explicit check identities', () => {
    expect(RoomReviewResultSchema.safeParse({ verdict: 'passed', findings: [{ severity: 'blocking', description: 'Unsafe' }], limitations: [] }).success).toBe(false)
    expect(RoomReviewResultSchema.safeParse({ verdict: 'changes_requested', findings: [{ severity: 'major', file: '../outside', description: 'Unsafe path' }], limitations: [] }).success).toBe(false)
    expect(RoomChecksSchema.safeParse({ checks: [{ id: 'test', command: 'npm test' }, { id: 'test', command: 'other' }] }).success).toBe(false)
    expect(RoomChecksSchema.safeParse({ checks: [{ id: 'test', command: 'npm test', purpose: 'Verify cancellation races' }] }).success).toBe(true)
  })

  it('retrieves an accepted result older than one page while rejecting an unaccepted or wrong-step result', async () => {
    const sessions = new InMemorySessionStore()
    const threads = new InMemoryThreadStore()
    const thread = createThreadRecord({ id: 'coord', title: 'Coordinator', workspace: '/workspace', model: 'test',
      roomContext: { roomId: 'room', memberId: 'coordinator', kind: 'coordination', blockedToolNames: [], blockedSkillIds: [], blockedProviderIds: [] } })
    thread.turns.push(createTurnRecord({ id: 'turn', threadId: thread.id, prompt: 'Discuss', status: 'completed' }))
    await threads.upsert(thread)
    const result = { kind: 'answer', response: 'Actual accepted plan' }
    await sessions.appendItem(thread.id, makeToolResultItem({ id: 'accepted', threadId: thread.id, turnId: 'turn', callId: 'plan',
      toolName: 'submit_room_plan', output: { accepted: true, value: result } }))
    for (let i = 0; i < 220; i += 1) await sessions.appendItem(thread.id, makeAssistantTextItem({
      id: 'text-' + i, threadId: thread.id, turnId: 'turn', text: 'ordinary final text', status: 'completed' }))
    await sessions.appendItem(thread.id, makeToolResultItem({ id: 'wrong-step', threadId: thread.id, turnId: 'turn', callId: 'review',
      toolName: 'submit_room_review', output: { accepted: true, value: { verdict: 'passed' } } }))
    await sessions.appendItem(thread.id, makeToolResultItem({ id: 'rejected', threadId: thread.id, turnId: 'turn', callId: 'invalid',
      toolName: 'submit_room_plan', output: { accepted: false, value: { kind: 'execute' } } }))
    const deps = { sessions, threads: { getMetadata: (id: string) => threads.get(id) } } as unknown as RoomRuntimeDeps
    expect((await observeRoomTurn(deps, thread.id, 'turn')).structured).toEqual(result)
  })

  it('freezes capability intersections and rejects an SDK provider before creating a room thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'room-capability-'))
    cleanup.push(root)
    const h = makeHarness(makeFakeModel([]))
    const member: RoomMember = { id: 'dev', displayName: 'Developer', presetId: 'custom', role: 'developer',
      roleNotes: '', enabled: true, revision: 0, allowedRepositoryIds: [],
      capabilityOverrides: { allowedTools: ['read', 'write'], blockedTools: ['read'], blockedMcpServers: ['private'], blockedSkills: ['private'], skillsEnabled: true } }
    const deps = { threads: h.threads, dataDir: root, assertOwnership: async () => {}, model: () => ({ model: 'test', providerId: 'native' }),
      profiles: () => ({ custom: { allowedTools: ['read', 'bash'], skillsEnabled: false } }), unsupportedProviderIds: () => ['sdk'] } as unknown as RoomRuntimeDeps
    const thread = await ensureRoomThread(deps, { id: 'execution', roomId: 'room', member, kind: 'execution' })
    expect(thread.roomContext).toMatchObject({ allowedToolNames: ['declare_room_checks', 'read_room_rules', 'read_room_playbook'], blockedToolNames: expect.arrayContaining(['read']),
      blockedProviderIds: ['mcp:private'], blockedSkillIds: ['private'], skillsEnabled: false })
    await expect(ensureRoomThread(deps, { id: 'sdk', roomId: 'room', member: { ...member, modelRef: { model: 'sdk-model', providerId: 'sdk' } }, kind: 'execution' })).rejects.toThrow('native API model')
    expect(await h.threadStore.get('sdk')).toBeNull()
  })
})
