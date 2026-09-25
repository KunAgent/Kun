import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoomContextSnapshot, RoomRule } from '../contracts/rooms-product.js'
import type { RoomMessage } from '../contracts/rooms.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import { ensureRoomThread, enqueueRoomTurn, observeRoomTurn } from './room-execution.js'
import type { RoomRequestState, RoomRuntimeDeps, RoomTaskExecution, RoomWorkspace } from './room-runtime-types.js'
import { putRoomDocument } from './room-service.js'
import { roomHistorySummaryPrompt } from './room-ax-surfaces.js'
import { prepareRoomReviewWorktree, assertRoomTaskWorkspace } from './room-delivery-service.js'
import type { RoomStoredDocument } from './room-store.js'
import { prepareRoomAgreements } from './room-rule-compression.js'

/** UTF-8 bytes are a conservative token upper bound, including CJK and escapes. */
export function boundedRoomText(text: string, budget: number): string {
  if (Buffer.byteLength(text) <= budget) return text
  let result = '', bytes = 0
  for (const char of text) {
    bytes += Buffer.byteLength(char)
    if (bytes > budget) break
    result += char
  }
  return result
}
export function roomBaseContextBudget(deps: RoomRuntimeDeps, request: RoomRequestState): number {
  const windows = request.roomSnapshot.members.filter((member) => member.enabled && !member.removedAt).map((member) => {
    const profile = deps.profiles()[member.presetId]
    return modelCapabilitiesForModel(member.modelRef?.model ??
      (profile?.model && profile.providerId ? profile.model : deps.model().model)).contextWindowTokens ?? 64000
  })
  return Math.min(16000, ...windows.map((window) => Math.floor(window / 4)))
}

export function roomContextBudget(deps: RoomRuntimeDeps, request: RoomRequestState): number {
  const base = roomBaseContextBudget(deps, request)
  return deps.agentMemory && request.roomSnapshot.members.some((member) => member.participantAgentId)
    ? Math.floor(base * .75) : base
}

type Summary = { body: string; coveredSeq: number; threadId?: string; turnId?: string; pendingCoveredSeq?: number; ownerRequestId?: string }
async function historySummary(deps: RoomRuntimeDeps, request: RoomRequestState, beforeSeq: number, budget: number) {
  const row = await deps.store.get<Summary>('summary', request.roomId)
  if (row && row.roomId !== request.roomId) throw new Error('summary belongs to another room')
  let summary = row?.value.body ?? ''
  if (row?.value.threadId && row.value.turnId) {
    const observed = await observeRoomTurn(deps, row.value.threadId, row.value.turnId)
    if (observed.status === 'running' || observed.status === 'queued') return summary
    if (observed.status === 'completed' && observed.text.trim()) summary = boundedRoomText(observed.text, 4000)
    await putRoomDocument(deps.store, 'summary', request.roomId, request.roomId, {
      body: summary, coveredSeq: observed.status === 'completed' && observed.text.trim()
        ? row.value.pendingCoveredSeq ?? row.value.coveredSeq : row.value.coveredSeq
    }, row)
    return summary
  }
  const older = await deps.store.list<RoomMessage>('message', { roomId: request.roomId,
    beforeSeq, afterSeq: row?.value.coveredSeq ?? 0, order: 'asc', limit: 100 })
  if (older.length < 30) return summary
  const messages: Array<{ id: string; author: string; body: string }> = []
  let coveredSeq = row?.value.coveredSeq ?? 0
  for (const message of older) {
    const candidate = { id: message.id, author: message.value.authorLabelSnapshot, body: boundedRoomText(message.value.body, 1500) }
    if (Buffer.byteLength(JSON.stringify({ previousSummary: summary, messages: [...messages, candidate] })) > budget - 512) break
    messages.push(candidate)
    coveredSeq = message.seq
  }
  if (!messages.length) return summary
  const member = request.roomSnapshot.members.find((entry) => entry.id === request.roomSnapshot.defaultMemberId)!
  const threadId = 'room-summary-' + request.roomId + '-' + coveredSeq + '-' + (row?.revision ?? 0)
  await ensureRoomThread(deps, { id: threadId, roomId: request.roomId, requestId: request.id, member, kind: 'discussion' })
  const turnId = await enqueueRoomTurn(deps, threadId, threadId,
    roomHistorySummaryPrompt({ previousSummary: summary, messages }))
  await putRoomDocument(deps.store, 'summary', request.roomId, request.roomId,
    { body: summary, coveredSeq: row?.value.coveredSeq ?? 0, pendingCoveredSeq: coveredSeq, threadId, turnId, ownerRequestId: request.id }, row)
  return summary
}

export async function roomContext(deps: RoomRuntimeDeps, request: RoomRequestState): Promise<RoomContextSnapshot> {
  const id = request.contextId ?? 'context-' + request.id
  const previous = await deps.store.get<RoomContextSnapshot>('context', id)
  if (previous) {
    if (previous.roomId !== request.roomId || previous.value.roomId !== request.roomId) throw new Error('context belongs to another room')
    request.contextState = 'ready'
    return previous.value
  }
  const source = await deps.store.get<RoomMessage>('message', request.sourceMessageId)
  if (!source || source.roomId !== request.roomId) throw new Error('room request source message unavailable')
  const recent = await deps.store.list<RoomMessage>('message', { roomId: request.roomId, limit: 30, beforeSeq: source.seq })
  const budget = roomContextBudget(deps, request)
  const summary = recent.length ? await historySummary(deps, request, recent.at(-1)!.seq, budget) : ''
  const rules: RoomRule[] = []
  let beforeSeq: number | undefined
  do {
    const page = await deps.store.list<RoomRule>('rule', { roomId: request.roomId, beforeSeq, limit: 100 })
    rules.push(...page.map((row) => row.value).filter((rule) => rule.active !== false))
    if (page.length < 100) break
    beforeSeq = page.at(-1)!.seq
  } while (beforeSeq !== undefined)
  const prepared = await prepareRoomAgreements(deps, request, rules, budget)
  const reply = request.message.replyToMessageId ? await deps.store.get<RoomMessage>('message', request.message.replyToMessageId) : null
  if (reply && reply.roomId !== request.roomId) throw new Error('reply refers to a different room')
  const related: RoomStoredDocument<RoomMessage>[] = []
  const stopWords = new Set(['continue', 'please', 'the', 'this', 'that', 'with', '继续', '刚才', '一下'])
  const terms = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(request.message.body)]
    .filter((part) => part.isWordLike && part.segment.length >= 2 && !stopWords.has(part.segment.toLocaleLowerCase()))
    .map((part) => part.segment).slice(0, 4)
  for (const term of terms) {
    related.push(...await deps.store.list<RoomMessage>('message', { roomId: request.roomId,
      beforeSeq: recent.at(-1)?.seq ?? source.seq, limit: 3, search: term.slice(0, 40) }))
  }
  const snapshot: RoomContextSnapshot = { id, roomId: request.roomId, coveredSeq: source.seq,
    summary: '', messages: [], rules: prepared.rules, agreements: prepared.agreements, truncated: false }
  const fits = () => Buffer.byteLength(JSON.stringify(snapshot)) <= budget
  // Explicit replies outrank all background. Current user input is passed separately, unchanged.
  const addMessage = (row: RoomStoredDocument<RoomMessage>, maxBytes: number) => {
    if (snapshot.messages.some((message) => message.id === row.id)) return
    const item = { id: row.id, author: row.value.authorLabelSnapshot, body: boundedRoomText(row.value.body, maxBytes) }
    snapshot.messages.push(item)
    while (!fits() && item.body.length) item.body = boundedRoomText(item.body, Math.max(0, Buffer.byteLength(item.body) - 256))
    if (!fits()) snapshot.messages.pop()
    if (item.body !== row.value.body) snapshot.truncated = true
  }
  if (reply) addMessage(reply, Math.floor(budget / 3))
  snapshot.summary = boundedRoomText(summary, Math.min(4000, Math.floor(budget / 4)))
  while (!fits() && snapshot.summary) snapshot.summary = boundedRoomText(snapshot.summary, Buffer.byteLength(snapshot.summary) - 256)
  for (const row of [...recent.slice(0, 5), ...related, ...recent.slice(5)]) addMessage(row, 1500)
  snapshot.truncated ||= related.length > 0 || Boolean(summary) || recent.length === 30
  snapshot.messages.sort((a, b) => {
    const seq = (id: string) => [...recent, ...related, ...(reply ? [reply] : [])].find((row) => row.id === id)?.seq ?? 0
    return seq(a.id) - seq(b.id)
  })
  await deps.store.commit({ requestId: id, checks: [{ kind: 'context', id, expectedRevision: null }],
    puts: [{ kind: 'context', id, roomId: request.roomId, value: snapshot }], result: { id } })
  return snapshot
}

export async function roomDiscussionWorkspace(deps: RoomRuntimeDeps, request: RoomRequestState): Promise<string | undefined> {
  if (!request.referencedTask) return undefined
  const task = request.referencedTask.task
  const row = await deps.store.get<RoomWorkspace>('workspace', task.workspaceId)
  if (!row || row.roomId !== request.roomId) throw new Error('referenced task workspace is unavailable')
  if (request.referencedTask.delivery) {
    const destination = join(deps.dataDir, 'rooms', 'discussions', request.referencedTask.delivery.id)
    await mkdir(dirname(destination), { recursive: true })
    return (await prepareRoomReviewWorktree({ delivery: request.referencedTask.delivery,
      repository: row.value.repository, destination, assertOwnership: deps.assertOwnership })).path
  }
  if (row.value.state === 'reserved') return undefined
  await assertRoomTaskWorkspace({ taskId: task.id, workspacePath: row.value.path, workspaceBranch: row.value.branch,
    baseRevision: row.value.baseRevision, repository: row.value.repository })
  return row.value.path
}

/** Frozen background remains reference data; explicit user adoptions define the current rule authority. */
export function roomTaskContext(execution: RoomTaskExecution, audience: 'execution' | 'review' = execution.task.stage === 'review' ? 'review' : 'execution') {
  const agreements = execution.agreements ?? execution.contextSnapshot?.agreements
  const sources = agreements ? { bundleId: agreements.bundleId, count: agreements.count,
    compressed: agreements.compressed, model: agreements.model, policyVersion: agreements.policyVersion } : undefined
  return {
    reference: execution.contextSnapshot ? { ...execution.contextSnapshot, rules: [], agreements: undefined,
      ...(audience === 'review' && execution.reviewer?.taskScopedMemory ? { summary: '', messages: execution.contextSnapshot.messages.filter((message) => message.id === execution.task.sourceMessageId) } : {}) } : undefined,
    currentProjectAgreements: agreements?.compressed ? agreements.summary :
      execution.rulesSnapshot ?? execution.contextSnapshot?.rules ?? [],
    agreementSources: sources,
    ruleAdoptions: execution.ruleAdoptions ?? []
  }
}
