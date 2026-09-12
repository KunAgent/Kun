import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoomMember } from '../contracts/rooms.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { roomEvidenceHistory } from './room-evidence-history.js'
import { roomTurnItems } from './room-item-history.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES } from '../contracts/capabilities-core.js'
import type { SubagentProfileConfig } from '../contracts/capabilities-core.js'

export async function ensureRoomThread(deps: RoomRuntimeDeps, input: {
  id: string; roomId: string; taskId?: string; member: RoomMember;
  kind: NonNullable<ThreadRecord['roomContext']>['kind']; workspace?: string;
  profile?: SubagentProfileConfig | null
}): Promise<ThreadRecord> {
  const old = await deps.threads.getMetadata(input.id)
  if (old) {
    if (old.roomContext?.roomId !== input.roomId || old.roomContext.memberId !== input.member.id ||
      old.roomContext.kind !== input.kind || old.roomContext.taskId !== input.taskId || (input.workspace && old.workspace !== input.workspace)) {
      throw new Error('room execution thread identity mismatch')
    }
    return old
  }
  await deps.assertOwnership()
  const workspace = input.workspace ?? join(deps.dataDir, 'rooms', 'discussion', input.roomId)
  await mkdir(workspace, { recursive: true })
  const profile = input.profile !== undefined ? input.profile ?? undefined : deps.profiles()[input.member.presetId]
  const binding = input.member.modelRef ?? (profile?.model && profile.providerId
    ? { model: profile.model, providerId: profile.providerId } : deps.model())
  if (binding.providerId && deps.unsupportedProviderIds?.().includes(binding.providerId)) {
    throw new Error('Rooms require a native API model; the selected provider uses an unsupported execution engine')
  }
  const overrides = input.member.capabilityOverrides
  const readOnly = input.kind !== 'execution' || profile?.toolPolicy === 'readOnly'
  const resultTool = input.kind === 'coordination' ? 'submit_room_plan' : input.kind === 'review' ? 'submit_room_review' :
    input.kind === 'execution' ? 'declare_room_checks' : undefined
  let allowed = input.kind === 'coordination' ? [] : readOnly ? [...SUBAGENT_READ_ONLY_TOOL_NAMES] : profile?.allowedTools
  for (const ceiling of [profile?.allowedTools, overrides?.allowedTools]) {
    if (ceiling) allowed = allowed ? allowed.filter((name) => ceiling.includes(name)) : [...ceiling]
  }
  const blocked = [...new Set([...(profile?.blockedTools ?? []), ...(overrides?.blockedTools ?? [])])]
  if (allowed) allowed = allowed.filter((name) => !blocked.includes(name))
  // Result submission is a scoped data-only protocol. Host-level denies still win.
  if (resultTool && allowed && !blocked.includes(resultTool)) allowed.push(resultTool)
  return deps.threads.create({
    workspace, title: input.member.displayName, model: binding.model, providerId: binding.providerId,
    ...('accountId' in binding && typeof binding.accountId === 'string' ? { accountId: binding.accountId } : {}),
    mode: readOnly ? 'plan' : 'agent', agentSurface: 'code',
    sandboxMode: readOnly ? 'read-only' : 'workspace-write',
    agentId: input.member.presetId,
    systemPrompt: [profile?.systemPrompt, profile?.promptPreamble, input.member.roleNotes].filter(Boolean).join('\n')
  }, { id: input.id, relation: 'side', roomContext: {
    roomId: input.roomId, taskId: input.taskId, memberId: input.member.id, kind: input.kind,
    allowedToolNames: allowed,
    blockedToolNames: [...new Set(['delegate_task', 'create_goal', ...blocked])],
    blockedProviderIds: [...new Set([...(profile?.blockedMcpServers ?? []), ...(overrides?.blockedMcpServers ?? [])])].map((id) => id.startsWith('mcp:') ? id : 'mcp:' + id),
    blockedSkillIds: [...new Set([...(profile?.blockedSkills ?? []), ...(overrides?.blockedSkills ?? [])])],
    skillsEnabled: profile?.skillsEnabled !== false && overrides?.skillsEnabled !== false
  } })
}

export async function enqueueRoomTurn(deps: RoomRuntimeDeps, threadId: string,
  clientRequestId: string, prompt: string, attachmentIds: string[] = []): Promise<string> {
  await deps.assertOwnership()
  const thread = await deps.threads.getMetadata(threadId)
  if (!thread?.roomContext) throw new Error('room thread not found')
  const existing = thread.turns.find((turn) => turn.clientRequestId === clientRequestId)
  const reuse = (turn: NonNullable<typeof existing>): string => {
    if (turn.prompt !== prompt || JSON.stringify(turn.attachmentIds ?? []) !== JSON.stringify(attachmentIds)) {
      throw new Error('room admission identity belongs to a different request')
    }
    if (turn.status === 'queued') deps.turns.notifyTurnQueued(threadId)
    return turn.id
  }
  if (existing) return reuse(existing)
  try {
    const admitted = await deps.turns.enqueueTurn({ threadId, request: {
      prompt, clientRequestId, attachmentIds, clientSurface: 'gui', agentSurface: 'code',
      mode: thread.mode, sandboxMode: thread.sandboxMode, enqueueIfBusy: true
    } })
    deps.turns.notifyTurnQueued(threadId)
    return admitted.turnId
  } catch (error) {
    // Admission may have committed before its response was lost. Query the
    // original identity before considering recovery, never allocate a new one.
    const after = await deps.threads.getMetadata(threadId)
    const found = after?.turns.find((turn) => turn.clientRequestId === clientRequestId)
    if (found) return reuse(found)
    throw error
  }
}

export async function observeRoomTurn(deps: RoomRuntimeDeps, threadId: string, turnId?: string) {
  const thread = await deps.threads.getMetadata(threadId)
  const turn = thread?.turns.find((candidate) => candidate.id === turnId)
  if (!turn) return { status: 'missing' as const, text: '' }
  if (turn.status === 'queued') {
    return { status: turn.status, text: '', turn }
  }
  const textParts: string[] = []
  let textLength = 0, error: string | undefined, structured: unknown
  const resultName = thread?.roomContext?.kind === 'coordination' ? 'submit_room_plan' :
    thread?.roomContext?.kind === 'review' ? 'submit_room_review' : undefined
  for await (const item of roomTurnItems(deps.sessions, threadId, turn.id)) {
    if (item.kind === 'assistant_text' && textLength < 64000) {
      const text = item.text.slice(-(64000 - textLength))
      textParts.unshift(text)
      textLength += text.length
    }
    if (item.kind === 'error' && !error) error = item.message
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
  return { status: turn.status, text: textParts.join('\n'), turn, structured, error }
}
