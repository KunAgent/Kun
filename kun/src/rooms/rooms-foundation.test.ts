import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RoomSchema, SendRoomMessageSchema } from '../contracts/rooms.js'
import { RoomTaskSchema } from '../contracts/room-tasks.js'
import { RoomVerificationEvidenceSchema } from '../contracts/room-deliveries.js'
import { resolveRoomRecipients, resolveRoomRepository, roomRouteMessage, isRoomRouteReason } from './room-router.js'
import { currentReviewCoversDelivery, mayAutomaticallyRework, transitionRoomTask } from './task-state-machine.js'
import { RoomCommitJournal, roomRequestFingerprint } from './room-commit-journal.js'

const now = '2026-09-11T12:00:00.000Z'
function room() {
  return RoomSchema.parse({
    schemaVersion: 1, id: 'room_1', name: 'Development', defaultMemberId: 'coordinator',
    revision: 0, createdAt: now, updatedAt: now,
    members: [
      { id: 'coordinator', displayName: 'Coordinator', presetId: 'general', role: 'coordinator', revision: 0 },
      { id: 'developer', displayName: 'Developer', presetId: 'general', role: 'developer', revision: 0,
        defaultRepositoryId: 'repo_1', allowedRepositoryIds: ['repo_1'] }
    ],
    repositories: [{ id: 'repo_1', displayName: 'Project', displayPath: '/project', canonicalRoot: '/project',
      gitCommonDir: '/project/.git', availability: 'available' }]
  })
}
function task() {
  return RoomTaskSchema.parse({
    id: 'task_1', roomId: 'room_1', requestId: 'req_1', sourceMessageId: 'msg_1', title: 'Fix',
    ownerMemberId: 'developer', memberSnapshot: room().members[1], repositoryId: 'repo_1',
    workspaceId: 'workspace_1', executionThreadId: 'thread_1', status: 'queued', stage: 'develop',
    requirementRevision: 0, revision: 0, updatedAt: now
  })
}

describe('room addressing and configuration', () => {
  it('routes ordinary and quoted mentions only to the default member', () => {
    const message = SendRoomMessageSchema.parse({ clientRequestId: 'req_1', body: 'Example: `@developer`' })
    expect(resolveRoomRecipients({ room: room(), message })).toEqual({ kind: 'respond', memberIds: ['coordinator'] })
  })
  it('honors structured mentions without broadcasting', () => {
    const message = SendRoomMessageSchema.parse({ clientRequestId: 'req_1', body: 'Please inspect', mentionMemberIds: ['developer'] })
    expect(resolveRoomRecipients({ room: room(), message })).toEqual({ kind: 'respond', memberIds: ['developer'] })
  })
  it('rejects cross-room task references', () => {
    const message = SendRoomMessageSchema.parse({ clientRequestId: 'req_1', body: 'Change it', taskId: 'task_1' })
    expect(resolveRoomRecipients({ room: room(), message, referencedTask: {
      id: 'task_1', roomId: 'room_other', ownerMemberId: 'developer'
    } })).toEqual({ kind: 'clarify', reason: 'invalid_task_reference' })
  })
  it('blocks archived rooms and unavailable members', () => {
    const value = room()
    value.archivedAt = now
    expect(resolveRoomRecipients({ room: value, message: SendRoomMessageSchema.parse({
      clientRequestId: 'req_1', body: 'Hello'
    }) }).kind).toBe('clarify')
  })
  it('does not fall back from explicitly denied repositories', () => {
    expect(resolveRoomRepository({ room: room(), memberId: 'developer', explicitRepositoryId: 'repo_other' }))
      .toEqual({ ok: false, reason: 'repository_denied' })
    expect(resolveRoomRepository({ room: room(), memberId: 'developer' }))
      .toEqual({ ok: true, repositoryId: 'repo_1' })
    expect(resolveRoomRepository({ room: room(), memberId: 'coordinator' }))
      .toEqual({ ok: false, reason: 'repository_required' })
    expect(isRoomRouteReason('repository_required')).toBe(true)
    expect(roomRouteMessage('repository_required')).toContain('仓库')
    expect(roomRouteMessage('repository_denied')).toContain('授权')
  })
  it('rejects invalid default members and unauthorized defaults', () => {
    expect(RoomSchema.safeParse({ ...room(), defaultMemberId: 'unknown' }).success).toBe(false)
    const value = room()
    value.members[1]!.allowedRepositoryIds = []
    expect(RoomSchema.safeParse(value).success).toBe(false)
  })
})

describe('task evidence and independent outcomes', () => {
  it('requires actual admission and stops before claiming cancellation', () => {
    const running = transitionRoomTask({ task: task(), expectedRevision: 0, next: 'running',
      evidence: { kind: 'admitted', turnId: 'turn_1' }, now })
    const stopping = transitionRoomTask({ task: running, expectedRevision: 1, next: 'stopping',
      evidence: { kind: 'cancel_requested' }, now })
    expect(() => transitionRoomTask({ task: stopping, expectedRevision: 2, next: 'cancelled',
      evidence: { kind: 'cancel_requested' }, now })).toThrow('missing authoritative evidence')
    expect(transitionRoomTask({ task: stopping, expectedRevision: 2, next: 'cancelled',
      evidence: { kind: 'stopped', executionConfirmedStopped: true }, now }).status).toBe('cancelled')
  })
  it('does not accept stale revisions or late deliveries after cancellation', () => {
    expect(() => transitionRoomTask({ task: task(), expectedRevision: 1, next: 'running',
      evidence: { kind: 'admitted', turnId: 'turn_1' }, now })).toThrow('stale task revision')
    expect(() => transitionRoomTask({ task: { ...task(), status: 'cancelled' }, expectedRevision: 0,
      next: 'awaiting_acceptance', evidence: { kind: 'delivery', deliveryId: 'delivery_1', requiredReviewSatisfied: true }, now }))
      .toThrow('invalid task transition')
  })
  it('accepts only the latest delivery without changing application status', () => {
    const pending = { ...task(), status: 'awaiting_acceptance' as const, latestDeliveryId: 'delivery_2' }
    expect(() => transitionRoomTask({ task: pending, expectedRevision: 0, next: 'completed',
      evidence: { kind: 'accepted', deliveryId: 'delivery_1' }, now })).toThrow('missing authoritative evidence')
    const accepted = transitionRoomTask({ task: pending, expectedRevision: 0, next: 'completed',
      evidence: { kind: 'accepted', deliveryId: 'delivery_2' }, now })
    expect(accepted.applicationStatus).toBe('not_applied')
    expect(accepted.acceptedDeliveryId).toBe('delivery_2')
  })
  it('does not reuse old review evidence or run unauthorized/unbounded rework', () => {
    expect(currentReviewCoversDelivery({ deliveryId: 'v1', versionHash: 'abc', verdict: 'passed' },
      { id: 'v2', versionHash: 'def' })).toBe(false)
    expect(mayAutomaticallyRework({ explicitlyAuthorized: false, completedRounds: 0, maximumRounds: 2 })).toBe(false)
    expect(mayAutomaticallyRework({ explicitlyAuthorized: true, completedRounds: 2, maximumRounds: 2 })).toBe(false)
    expect(mayAutomaticallyRework({ explicitlyAuthorized: true, completedRounds: 0, maximumRounds: 3 })).toBe(false)
    expect(mayAutomaticallyRework({ explicitlyAuthorized: true, completedRounds: 1, maximumRounds: 2 })).toBe(true)
  })
  it('rejects false passing verification', () => {
    expect(RoomVerificationEvidenceSchema.safeParse({ command: 'test', cwd: '/project',
      startedAt: now, endedAt: now, status: 'passed', exitCode: 1, logArtifactId: 'log_1' }).success).toBe(false)
  })
})

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function journal() {
  const path = await mkdtemp(join(tmpdir(), 'kun-room-journal-'))
  temporary.push(path)
  return { path, store: new RoomCommitJournal(path, async () => {}) }
}
function command() {
  return { roomId: 'room_1', commandId: 'cmd_1', expectedSequence: 0,
    fingerprint: roomRequestFingerprint({ body: 'Hello' }), payload: { message: 'Hello', outbox: ['message.created'] } }
}

describe('room journal durability primitive', () => {
  it('recovers a committed message and outbox after losing the response', async () => {
    const { path, store } = await journal()
    const committed = await store.append(command())
    const reopened = new RoomCommitJournal(path, async () => {})
    expect(await reopened.append(command())).toEqual(committed)
    expect(await reopened.readAll('room_1')).toHaveLength(1)
  })
  it('deduplicates concurrent commands and rejects a changed fingerprint', async () => {
    const { store } = await journal()
    const results = await Promise.all([store.append(command()), store.append(command())])
    expect(results[0]).toEqual(results[1])
    await expect(store.append({ ...command(), fingerprint: roomRequestFingerprint({ body: 'Other' }) }))
      .rejects.toThrow('different content')
    await expect(store.append({ ...command(), commandId: 'cmd_2' })).rejects.toThrow('stale journal revision')
  })
  it('fails closed on a corrupted or incomplete commit without rewriting it', async () => {
    const { path, store } = await journal()
    await store.append(command())
    const file = join(path, 'room_1', '000000000001.json')
    await writeFile(file, '{"partial":')
    await expect(store.readAll('room_1')).rejects.toThrow('invalid room commit')
    await expect(store.append({ ...command(), commandId: 'cmd_2', expectedSequence: 1 })).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{"partial":')
  })
  it('checks ownership and rejects path traversal', async () => {
    const { path, store } = await journal()
    await expect(store.readAll('../escape')).rejects.toThrow()
    const fenced = new RoomCommitJournal(path, async () => { throw new Error('stale owner') })
    await expect(fenced.append(command())).rejects.toThrow('stale owner')
    expect(await store.readAll('room_1')).toEqual([])
  })
})
