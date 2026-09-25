import { appendAgentResponseBudget } from '../agents/agent-response-budget.js'
import { agentStableId } from '../agents/agent-identity-service.js'
import { AGENT_COLLABORATION_TOOLS } from '../agents/agent-handoff-tools.js'
import { freezeAgentMemoryInput } from '../agents/agent-memory-input.js'
import { prepareRoomRun, observeRecordedRoomTurn, updateRoomRun, roomRunId, type RoomRunAdmission } from './room-run-recording.js'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoomMember } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { AssistantTextTurnItem } from '../contracts/items.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { roomEvidenceHistory } from './room-evidence-history.js'
import { roomTurnItems } from './room-item-history.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES } from '../contracts/capabilities-core.js'
import type { SubagentProfileConfig } from '../contracts/capabilities-core.js'

export async function ensureRoomThread(deps: RoomRuntimeDeps, input: {
  id: string; roomId: string; taskId?: string; requestId?: string; member: RoomMember;
  rootRequestId?: string; collaborationProtocol?: 'legacy' | 'peer'; handoffId?: string;
  kind: NonNullable<ThreadRecord['roomContext']>['kind']; workspace?: string;
  profile?: SubagentProfileConfig | null
}): Promise<ThreadRecord> {
  const old = await deps.threads.getMetadata(input.id)
  if (old) {
    if (old.roomContext?.roomId !== input.roomId || old.roomContext.memberId !== input.member.id ||
      old.roomContext.kind !== input.kind || old.roomContext.taskId !== input.taskId ||
      old.roomContext.rootRequestId !== input.rootRequestId || old.roomContext.handoffId !== input.handoffId || (input.workspace && old.workspace !== input.workspace)) {
      throw new Error('room execution thread identity mismatch')
    }
    return old
  }
  await deps.assertOwnership()
  const workspace = input.workspace ?? join(deps.dataDir, 'rooms', 'discussion', input.roomId)
  if (input.workspace) {
    if (!(await stat(workspace)).isDirectory()) throw new Error('authorized workspace is unavailable')
  } else await mkdir(workspace, { recursive: true })
  const profile = input.profile !== undefined ? input.profile ?? undefined : (input.member.presetSnapshot !== undefined ? input.member.presetSnapshot ?? undefined : deps.profiles()[input.member.presetId])
  const binding = input.member.modelRef ?? (profile?.model && profile.providerId
    ? { model: profile.model, providerId: profile.providerId } : deps.model())
  if (binding.providerId && deps.unsupportedProviderIds?.().includes(binding.providerId)) {
    throw new Error('Rooms require a native API model; the selected provider uses an unsupported execution engine')
  }
  const invitationRequest = input.requestId ? await deps.store.get<import('./room-runtime-types.js').RoomRequestState>('request', input.requestId) : null
  const pollInvited = input.kind === 'discussion' && invitationRequest?.value.pollInvitation?.memberIds.includes(input.member.id)
  const overrides = input.member.capabilityOverrides
  const readOnly = input.kind !== 'execution' || profile?.toolPolicy === 'readOnly'
  const resultTool = input.kind === 'coordination' ? 'submit_room_plan' : input.kind === 'review' ? 'submit_room_review' :
    input.kind === 'execution' ? 'declare_room_checks' : undefined
  let allowed = input.kind === 'coordination' ? [] : readOnly ? [...SUBAGENT_READ_ONLY_TOOL_NAMES] : profile?.allowedTools
  if (pollInvited) allowed = [...(allowed ?? []), 'vote_room_poll']
  for (const ceiling of [profile?.allowedTools, overrides?.allowedTools]) {
    if (ceiling) allowed = allowed ? allowed.filter((name) => ceiling.includes(name)) : [...ceiling]
  }
  const blocked = [...new Set([...(profile?.blockedTools ?? []), ...(overrides?.blockedTools ?? [])])]
  if (allowed) allowed = allowed.filter((name) => !blocked.includes(name))
  // Result submission is a scoped data-only protocol. Host-level denies still win.
  if (resultTool && allowed && !blocked.includes(resultTool)) allowed.push(resultTool)
  if (allowed && !blocked.includes('read_room_rules')) allowed.push('read_room_rules')
  if (allowed && !blocked.includes('read_room_playbook')) allowed.push('read_room_playbook')
  if (input.kind === 'discussion' && input.collaborationProtocol === 'peer' && allowed) {
    allowed.push(...['read_room_updates', 'send_room_message'].filter((name) => !blocked.includes(name)))
  }
  if (input.member.participantAgentId && allowed) allowed.push(...AGENT_COLLABORATION_TOOLS.filter((name) => !blocked.includes(name)))
  return deps.threads.create({
    workspace, title: input.member.displayName, model: binding.model, providerId: binding.providerId,
    ...('accountId' in binding && typeof binding.accountId === 'string' ? { accountId: binding.accountId } : {}),
    mode: readOnly ? 'plan' : 'agent', agentSurface: 'code',
    sandboxMode: readOnly ? 'read-only' : 'workspace-write',
    agentId: input.member.presetId,
    systemPrompt: [profile?.systemPrompt, profile?.promptPreamble, input.member.agentInstructions, input.member.roleNotes].filter(Boolean).join('\n')
  }, { id: input.id, relation: 'side', roomContext: {
    participantAgentId: input.member.participantAgentId, agentRevision: input.member.agentRevision, taskScopedMemory: input.member.taskScopedMemory, handoffId: input.handoffId,
    roomId: input.roomId, taskId: input.taskId, requestId: input.requestId, memberId: input.member.id, kind: input.kind,
    rootRequestId: input.rootRequestId, collaborationProtocol: input.collaborationProtocol,
    allowedToolNames: allowed,
    blockedToolNames: [...new Set([...(readOnly ? ['delegate_task', 'generate_subagent'] : []), 'create_goal', ...blocked])],
    blockedProviderIds: [...new Set([...(profile?.blockedMcpServers ?? []), ...(overrides?.blockedMcpServers ?? [])])].map((id) => id.startsWith('mcp:') ? id : 'mcp:' + id),
    blockedSkillIds: [...new Set([...(profile?.blockedSkills ?? []), ...(overrides?.blockedSkills ?? [])])],
    skillsEnabled: profile?.skillsEnabled !== false && overrides?.skillsEnabled !== false
  } })
}

export async function enqueueRoomTurn(deps: RoomRuntimeDeps, threadId: string,
  clientRequestId: string, prompt: string, attachmentIds: string[] = [], runInput: RoomRunAdmission = {}): Promise<string> {
  await deps.assertOwnership()
  const thread = await deps.threads.getMetadata(threadId)
  if (!thread?.roomContext) throw new Error('room thread not found')
  if (thread.roomContext.participantAgentId && thread.roomContext.kind === 'discussion' &&
    thread.roomContext.collaborationProtocol !== 'peer' && !thread.roomContext.handoffId && thread.roomContext.requestId) {
    const request = await deps.store.get<import('./room-runtime-types.js').RoomRequestState>('request', thread.roomContext.requestId)
    if (request) {
      const rootId = request.value.rootRequestId ?? request.id
      const root = await deps.store.get<import('./room-runtime-types.js').RoomRequestState>('request', rootId)
      const commit: import('./room-store.js').RoomStoreCommit = { requestId: agentStableId('legacy-agent-response', threadId, clientRequestId) }
      await appendAgentResponseBudget(deps, commit, { sourceRoomId: thread.roomContext.roomId, rootRequestId: rootId,
        agentId: thread.roomContext.participantAgentId, generation: root?.value.continuation ?? 0, clientRequestId })
      if (commit.puts?.length) await deps.store.commit(commit)
    }
  }
  prompt = await freezeAgentMemoryInput(deps, thread, clientRequestId, prompt)
  const run = await prepareRoomRun(deps, thread, clientRequestId, prompt, attachmentIds, runInput)
  const existing = thread.turns.find((turn) => turn.clientRequestId === clientRequestId)
  const reuse = async (turn: NonNullable<typeof existing>): Promise<string> => {
    if (turn.prompt !== prompt || JSON.stringify(turn.attachmentIds ?? []) !== JSON.stringify(attachmentIds)) {
      throw new Error('room admission identity belongs to a different request')
    }
    await updateRoomRun(deps.store, run.id, { turnId: turn.id })
    if (turn.status === 'queued') deps.turns.notifyTurnQueued(threadId)
    return turn.id
  }
  if (existing) return reuse(existing)
  if (run.admissionAttempted) {
    await updateRoomRun(deps.store, run.id, { status: 'recovery_required' })
    throw new Error('Original room run admission requires reconciliation')
  }
  await updateRoomRun(deps.store, run.id, { admissionAttempted: true })
  try {
    const admitted = await deps.turns.enqueueTurn({ threadId, request: {
      prompt, clientRequestId, attachmentIds, clientSurface: 'gui', agentSurface: 'code',
      mode: thread.mode, sandboxMode: thread.sandboxMode, enqueueIfBusy: true
    } })
    await updateRoomRun(deps.store, run.id, { turnId: admitted.turnId })
    deps.turns.notifyTurnQueued(threadId)
    return admitted.turnId
  } catch (error) {
    // Admission may have committed before its response was lost. Query the
    // original identity before considering recovery, never allocate a new one.
    const after = await deps.threads.getMetadata(threadId)
    const found = after?.turns.find((turn) => turn.clientRequestId === clientRequestId)
    if (found) return reuse(found)
    await updateRoomRun(deps.store, run.id, { status: 'recovery_required', error: String(error).slice(0, 4000) })
    throw error
  }
}

export type ObservedRoomTurn = {
  status: Turn['status'] | 'missing'
  text: string
  turn?: Turn
  structured?: unknown
  error?: string
  resultError?: string
  segments?: Array<{ itemId: string; text: string; createdAt: string; status: AssistantTextTurnItem['status'] }>
}

export async function observeRoomTurn(deps: RoomRuntimeDeps, threadId: string, turnId?: string): Promise<ObservedRoomTurn> {
  const thread = await deps.threads.getMetadata(threadId)
  const turn = thread?.turns.find((candidate) => candidate.id === turnId)
  if (!turn) return { status: 'missing' as const, text: '', segments: [] }
  await observeRecordedRoomTurn(deps, thread!, turn)
  if (turn.status === 'queued') {
    return { status: turn.status, text: '', turn, segments: [] }
  }
  const textParts: string[] = []
  const segmentParts: Array<{ itemId: string; text: string; createdAt: string; status: AssistantTextTurnItem['status'] }> = []
  let textLength = 0, error: string | undefined, structured: unknown, resultError: string | undefined
  const resultName = thread?.roomContext?.kind === 'coordination' ? 'submit_room_plan' :
    thread?.roomContext?.kind === 'review' ? 'submit_room_review' :
      thread?.roomContext?.kind === 'discussion' && thread.roomContext.collaborationProtocol === 'peer' ? 'send_room_message' : undefined
  for await (const item of roomTurnItems(deps.sessions, threadId, turn.id)) {
    if (item.kind === 'assistant_text') {
      segmentParts.push({ itemId: item.id, text: item.text.slice(0, 64000), createdAt: item.createdAt, status: item.status })
      if (textLength < 64000) {
        const text = item.text.slice(-(64000 - textLength))
        textParts.unshift(text)
        textLength += text.length
      }
    }
    if (item.kind === 'error' && !error) error = item.message
    if (item.kind === 'tool_result' && item.toolName === resultName && item.isError) {
      resultError = 'The scoped room result was rejected; no message was submitted.'
    }
    if (structured === undefined && item.kind === 'tool_result' && !item.isError && item.toolName === resultName &&
      typeof item.output === 'object' && item.output !== null && 'accepted' in item.output && item.output.accepted === true) {
      structured = (item.output as { value?: unknown }).value
    }
  }
  if (turn.status === 'completed' && resultName) {
    const exact = (await roomEvidenceHistory(deps.sessions, threadId, turn.id)).items.find(({ item }) =>
      item.kind === 'tool_result' && !item.isError && item.toolName === resultName &&
      typeof item.output === 'object' && item.output !== null && 'accepted' in item.output && item.output.accepted === true)?.item
    if (exact && 'output' in exact) structured = (exact.output as { value?: unknown }).value
  }
  if (error && thread?.roomContext && turn.clientRequestId) await updateRoomRun(deps.store,
    roomRunId(thread.roomContext.roomId, turn.clientRequestId), { error: error.slice(0, 4000) })
  return { status: turn.status, text: textParts.join('\n'), turn, structured, error, resultError,
    segments: segmentParts.reverse().filter((segment) => segment.text.trim()) }
}
