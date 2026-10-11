import { expect, it } from 'vitest'
import { collectAgentMemoryEvidence } from './agent-memory-evidence.js'
import { canonicalMemoryHash } from '../memory/memory-record-normalizer.js'
import { revisionSnapshot } from '../memory/memory-revisions.js'
import { MemoryRecord } from '../contracts/memory.js'
import { extractAgentMemories, prepareAgentMemoryCapture } from './agent-memory-extraction.js'
import type { AgentMemoryCapture, AgentMemoryCaptureSnapshot } from './agent-memory-capture-types.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import { memoryEvidenceStatus } from '../memory/memory-consolidation.js'

const at = '2026-10-06T00:00:00.000Z'
function fixture(status = 'completed', verificationStatus = 'passed') {
  const data = new Map<string, unknown>([
    ['request:root', { sourceMessageId: 'user', roomSnapshot: { members: [] } }],
    ['message:user', { authorKind: 'user', body: 'Remember the storage decision.' }],
    ['task:task', { task: { memberSnapshot: { participantAgentId: 'ada' }, latestDeliveryId: 'delivery', status } }],
    ['delivery:delivery', { id: 'delivery', taskId: 'task', attemptId: 'attempt', version: 1,
      baseRevision: 'b'.repeat(40), versionHash: 'a'.repeat(40), pinRef: 'refs/kun/rooms/delivery',
      changedFiles: ['src/main.ts'], diffArtifactId: 'diff-artifact', summary: 'Tests passed and deployment succeeded.',
      incomplete: ['Deployment not checked'], createdAt: at, verification: [{ command: 'npm test', cwd: '/repo',
        startedAt: at, endedAt: at, status: verificationStatus,
        exitCode: verificationStatus === 'passed' ? 0 : 1, logArtifactId: 'test-log' }] }],
    ...Array.from({ length: 6 }, (_, index) => [`message:reply-${index}`, { status: 'final', authorAgentId: 'ada',
      authorLabelSnapshot: 'Ada', body: 'Tests passed.' }] as [string, unknown])
  ])
  const deps = { store: { get: async (kind: string, id: string) => data.has(kind + ':' + id)
    ? { id, roomId: 'room', value: data.get(kind + ':' + id) } : null } } as unknown as RoomRuntimeDeps
  const job: AgentMemoryCapture = { id: 'job', phase: 'capture', roomId: 'room', rootRequestId: 'root',
    participantAgentId: 'ada', memberId: 'member', status: 'pending', attempts: 0,
    messageIds: Array.from({ length: 6 }, (_, index) => 'reply-' + index), taskIds: ['task'], sourceSeq: 1 }
  return { deps, job }
}

it('prioritizes execution receipts over a full assistant-message budget and retains precise identifiers', async () => {
  const f = fixture(), evidence = await collectAgentMemoryEvidence(f.deps, f.job)
  expect(evidence.sources).toHaveLength(8)
  expect(evidence.sources).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool', trust: 'observed',
    receiptId: 'delivery:verification:0', repositorySha: 'a'.repeat(40), artifactIds: ['test-log'], outcome: 'succeeded' })]))
  expect(evidence.sources.find((source) => source.id === 'delivery')).toMatchObject({ trust: 'inferred', artifactIds: ['diff-artifact'] })
  expect(evidence.capturedTasks).toEqual(['task'])
})

it.each([['failed', 'passed'], ['cancelled', 'passed'], ['completed', 'failed']])('does not promote %s work with %s checks to observed success', async (status, checks) => {
  const f = fixture(status, checks), evidence = await collectAgentMemoryEvidence(f.deps, f.job)
  expect(memoryEvidenceStatus(evidence.sources)).not.toBe('observed-success')
})

it('rejects tool execution from the extraction model', async () => {
  const deps = { peerModels: { client: { async *stream() {
    yield { kind: 'tool_call_complete', callId: 'malicious', toolName: 'shell', arguments: { command: 'echo not allowed' } }
  } } } } as unknown as RoomRuntimeDeps
  const snapshot = { model: 'fixture', input: '{}', observedAt: at, sources: [], comparisonRecords: [] } as unknown as AgentMemoryCaptureSnapshot
  expect(await extractAgentMemories(deps, snapshot, 'run', new AbortController().signal)).toMatchObject({
    candidates: [], error: 'memory extraction attempted a tool call'
  })
})


it.each(['revoked', 'deleted', 'disabled', 'superseded'])('rechecks a %s canonical comparison after retrieval before sending extraction input', async (change) => {
  const f = fixture()
  const visible = MemoryRecord.parse({ id: 'prior', content: 'PRIVATE PRIOR COMPARISON', scope: 'user',
    createdAt: at, updatedAt: at, agentContext: { schemaVersion: 1, agentId: 'ada', sourceConversationId: 'room' } })
  const canonical = MemoryRecord.parse({ ...visible,
    ...(change === 'revoked' ? { agentContext: { ...visible.agentContext!, sourceConversationId: 'private-room' } } :
      change === 'deleted' ? { deletedAt: at } : change === 'disabled' ? { disabledAt: at } : { supersededAt: at }) })
  const deps = { ...f.deps, profiles: () => ({}), model: () => ({ model: 'fixture' }), agentMemory: {
    context: async () => ({ records: [visible], text: '' }), find: async () => canonical
  } } as unknown as RoomRuntimeDeps
  const snapshot = await prepareAgentMemoryCapture(deps, f.job)
  expect(snapshot.comparisonRecords).toEqual([])
  expect(snapshot.input).not.toContain('PRIVATE PRIOR COMPARISON')
})


it.each([{ oversized: false, historyCharacter: 'x' }, { oversized: false, historyCharacter: '\u4e2d' },
  { oversized: true, historyCharacter: 'x' }])('budgets current comparison separately from history %j', async ({ oversized, historyCharacter }) => {
  const f = fixture()
  const current = MemoryRecord.parse({ id: 'mature', content: oversized ? 'x'.repeat(13_000) : 'Storage decision: use SQLite.',
    scope: 'user', createdAt: at, updatedAt: at,
    agentContext: { schemaVersion: 1, agentId: 'ada', sourceConversationId: 'room' } })
  const mature = MemoryRecord.parse({ ...current, revision: 7, history: Array.from({ length: 6 }, (_, index) => ({
    revision: index + 1, changedAt: at, operation: 'update',
    snapshot: { ...revisionSnapshot(current), content: 'ARCHIVED_ONLY_' + index + ': ' + historyCharacter.repeat(5_000) }
  })) })
  expect(Buffer.byteLength(JSON.stringify(mature))).toBeGreaterThan(12_000)
  if (historyCharacter !== 'x') expect(Buffer.byteLength(JSON.stringify(mature))).toBeGreaterThan(76_000)
  const deps = { ...f.deps, profiles: () => ({}), model: () => ({ model: 'fixture' }), agentMemory: {
    context: async () => ({ records: [current], text: '' }), find: async () => mature
  } } as unknown as RoomRuntimeDeps
  const snapshot = await prepareAgentMemoryCapture(deps, f.job)
  expect(Buffer.byteLength(snapshot.input)).toBeLessThanOrEqual(16_000)
  expect(snapshot.input).not.toContain('ARCHIVED_ONLY_')
  if (oversized) {
    expect(snapshot.comparisonRecords).toEqual([])
    expect(JSON.parse(snapshot.input).existing).toEqual([])
  } else {
    expect(snapshot.comparisonRecords).toEqual([mature])
    expect(snapshot.comparisonRecords[0]!.history).toHaveLength(6)
    expect(canonicalMemoryHash(snapshot.comparisonRecords[0]!)).toBe(canonicalMemoryHash(mature))
    expect(JSON.parse(snapshot.input).existing[0].id).toBe(mature.id)
  }
})
