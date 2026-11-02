import { isDeepStrictEqual } from 'node:util'
import type { NativeFollowUpRequest } from '../contracts/native-followup-requests.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { StartTurnRequest, Turn } from '../contracts/turns.js'
import { CommitmentExecutionSchema, CommitmentEffectSchema } from '../contracts/collaboration-effects.js'
import { CommitmentControlSchema, CommitmentLinkSchema, CollaborationPolicySchema } from '../contracts/collaboration-followup.js'
import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { retainNativeFollowUpRequests } from '../domain/native-followup-requests.js'
import { fingerprintStartTurnRequest } from '../domain/turn-request-fingerprint.js'
import { followUpPolicyCurrent } from '../agents/followup/state.js'
import { resolveDesignTurnAdmission } from '../services/turn-service-design-admission.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { SessionStore } from '../ports/session-store.js'
import { assertFollowUpArbitrationFence, type ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { NativeFollowUpPermitError, type NativeFollowUpWriteScope } from './native-followup-write-scope.js'
import type { ServiceManagerState } from './service-manager-state.js'
import type { ThreadAdmissionWriteGuard } from './thread-admission-context.js'

type AdmissionChange = { turn: Turn; row?: NativeFollowUpRequest; stage: 'enqueue' | 'promote' }
const active = (turn: Turn | undefined) => turn?.status === 'queued' || turn?.status === 'running'
const immutableTurnFields = ['clientRequestId', 'clientRequestFingerprint', 'paperContext', 'paperContextSha256',
  'messageSource', 'subagentResume', 'interruptedResume', 'model', 'providerId', 'harnessId', 'credentialMode',
  'harnessAgentId', 'harnessSettings', 'gatewayBinding', 'accountId', 'reasoningEffort',
  'collaborationEnabled', 'serviceTier', 'clientSurface', 'approvalPolicy', 'sandboxMode', 'approvalReviewer', 'attachmentIds',
  'composerContexts', 'guiPlan', 'guiDesignCanvas', 'guiExcalidrawCanvas', 'guiDesignMode',
  'agentSurface', 'designProfile', 'designDocumentTarget', 'writeContext', 'persona', 'guiDesignArtifact',
  'mode', 'orchestration', 'disableUserInput', 'imContext', 'planBuild', 'workspaceCheckpointRequestId'] as const

// These are resolved by the runtime after a turn starts, but must not be
// injected into a pending queue entry or changed during its promotion.
const queuedOnlyTurnFields = ['activeSkillIds', 'gatewayAliasGrants', 'workspaceCheckpointId'] as const

// Pure request fields must match even when omitted: otherwise a metadata
// writer can add authority or instructions without changing the fingerprint.
const exactRequestFields = ['paperContext', 'messageSource', 'subagentResume', 'interruptedResume',
  'harnessAgentId', 'harnessSettings', 'reasoningEffort', 'serviceTier', 'clientSurface',
  'guiPlan', 'guiDesignCanvas', 'guiExcalidrawCanvas', 'guiDesignMode', 'writeContext',
  'persona', 'guiDesignArtifact', 'orchestration', 'disableUserInput', 'imContext',
  'planBuild', 'workspaceCheckpointId', 'workspaceCheckpointRequestId'] as const

const nonBlank = (value: string | undefined): string | undefined => value?.trim() || undefined

/** Match the settings TurnService resolves when it constructs a native turn. */
function assertInitialNativeSettings(thread: ThreadRecord | null | undefined, request: StartTurnRequest, turn: Turn): void {
  const fail = (message: string): never => { throw new NativeFollowUpPermitError(message) }
  if (!thread || turn.threadId !== thread.id) return fail('native target thread does not match')
  const model = nonBlank(request.model) ?? nonBlank(thread.model)
  // If an old thread has no model, the host must pin its resolved default;
  // the Manager cannot safely infer a runtime-specific default.
  if (!model) return fail('native model must be pinned')
  const requestedProviderId = nonBlank(request.providerId)
  const threadProviderId = nonBlank(thread.providerId)
  const providerId = requestedProviderId ?? threadProviderId ?? 'default'
  const accountId = nonBlank(request.accountId) ??
    (!requestedProviderId || requestedProviderId === threadProviderId ? thread.accountId : undefined)
  const inheritedHarness = request.harnessId ?? thread.harnessId ?? thread.executionConfig?.route.harnessId
  const credentialMode = request.credentialMode ??
    (thread.executionConfig?.route.harnessId === 'kun' ? thread.executionConfig.route.credentialMode : undefined) ?? 'provider'
  if ((inheritedHarness && inheritedHarness !== 'kun') ||
    (thread.harnessId && thread.harnessId !== 'kun') ||
    (thread.executionConfig?.route.harnessId && thread.executionConfig.route.harnessId !== 'kun') ||
    turn.harnessId !== 'kun' || credentialMode !== 'provider' || turn.credentialMode !== credentialMode ||
    request.gatewayBinding !== undefined || turn.gatewayBinding !== undefined || turn.gatewayAliasGrants !== undefined) {
    return fail('native follow-up requires the Kun harness and provider credentials')
  }
  // These are host-derived after admission, never authority supplied by a
  // native queue writer. Attachment aliases require a separate host grant.
  if (turn.activeSkillIds.length || turn.attachmentAliases !== undefined) {
    return fail('native queue contains ungranted runtime-derived settings')
  }
  const expected = {
    model, providerId, accountId,
    approvalPolicy: request.approvalPolicy ?? thread.approvalPolicy,
    sandboxMode: request.sandboxMode ?? thread.sandboxMode,
    approvalReviewer: request.approvalReviewer ?? thread.approvalReviewer,
    mode: request.mode ?? thread.mode,
    collaborationEnabled: thread.collaboration?.enabled ?? thread.workspaceMode === 'ade'
  }
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (!isDeepStrictEqual(expected[key], turn[key])) return fail('native inherited setting does not match: ' + key)
  }
  let design: ReturnType<typeof resolveDesignTurnAdmission>
  try { design = resolveDesignTurnAdmission({ thread, request, turnId: turn.id }) }
  catch { return fail('native design context is not valid for this thread') }
  if (!isDeepStrictEqual(turn.agentSurface, design.effectiveSurface) ||
    !isDeepStrictEqual(turn.designProfile, design.effectiveProfile) ||
    !isDeepStrictEqual(turn.designDocumentTarget, design.effectiveDocumentTarget)) {
    return fail('native design context does not match its reserved request')
  }
}

/** Compare real transitions, not a caller-supplied native flag or thread.status. */
export function nativeFollowUpAdmissionChanges(prior: ThreadRecord | null | undefined, next: ThreadRecord): AdmissionChange[] {
  const effective = retainNativeFollowUpRequests(prior, next)
  const turns = new Map((prior?.turns ?? []).map((turn) => [turn.id, turn]))
  const oldRows = new Map((prior?.nativeFollowUpRequests ?? []).map((row) => [row.admission.requestId, row]))
  const rows = new Map((effective.nativeFollowUpRequests ?? []).map((row) => [row.turnId, row]))
  const changes = new Map<string, AdmissionChange>()
  for (const turn of next.turns) {
    const old = turns.get(turn.id), row = rows.get(turn.id)
    const oldRow = row && oldRows.get(row.admission.requestId)
    if (row && old && active(old) && active(turn)) {
      if (old.status === 'running' && turn.status === 'queued' ||
        oldRow?.phase === 'admitted' && !old.admissionPending && turn.admissionPending) {
        throw new NativeFollowUpPermitError('native admission progress cannot be rewound')
      }
      const protectedFields = old.status === 'queued' ? [...immutableTurnFields, ...queuedOnlyTurnFields] : immutableTurnFields
      for (const key of protectedFields) {
        if (!isDeepStrictEqual(old[key], turn[key])) throw new NativeFollowUpPermitError('native queued input is immutable: ' + key)
      }
    }
    const starts = active(turn) && (!active(old) || old?.status === 'queued' && turn.status === 'running')
    if (starts) {
      // Retained execution tombstones also protect a thread after ownership was released.
      if (oldRow?.terminalStatus || oldRow?.executionStartedAt) {
        throw new NativeFollowUpPermitError('native request cannot execute again after its start boundary')
      }
      changes.set(turn.id, { turn, row, stage: turn.status === 'queued' ? 'enqueue' : 'promote' })
    }
  }
  for (const row of effective.nativeFollowUpRequests ?? []) {
    const old = oldRows.get(row.admission.requestId)
    const prepared = !old || row.preparationRevision > old.preparationRevision
    if (!prepared) continue
    const turn = next.turns.find((candidate) => candidate.id === row.turnId)
    if (!turn || turn.status !== 'queued' || row.phase !== 'preparing' || turns.has(turn.id) && active(turns.get(turn.id))) {
      throw new NativeFollowUpPermitError('new native preparation must introduce its queued turn')
    }
    changes.set(turn.id, { turn, row, stage: 'enqueue' })
  }
  return [...changes.values()]
}

/** Installed at the Manager RPC, invoked inside the existing per-thread mutation queue. */
export function managerFollowUpThreadWriteGuard(input: {
  state: ServiceManagerState; roomStore: RoomStore; writes: ManagerFollowUpWriteArbitration;
  scope?: NativeFollowUpWriteScope; now?: () => string
}): ThreadAdmissionWriteGuard {
  return (store, next, write, sessions) => input.writes.run(async () => {
    const prior = store.getMetadata ? await store.getMetadata(next.id) : await store.get(next.id)
    const changes = nativeFollowUpAdmissionChanges(prior, next)
    if (!changes.length) return write()
    const owners = await input.roomStore.collaborationQuery({ kind: 'owned_thread', threadId: next.id })
    if (!owners.length && changes.every((change) => !change.row)) return write()
    if (owners.length !== 1 || changes.length !== 1 || !input.scope) throw new NativeFollowUpPermitError()
    const owner = CommitmentLinkSchema.parse(owners[0].value), change = changes[0]
    if (owner.stopRequestedAt || !change.row || change.stage !== input.scope.stage ||
      !isDeepStrictEqual(change.row.admission, input.scope.admission)) throw new NativeFollowUpPermitError()
    await assertNativeFollowUpPermit({ ...input, scope: input.scope, threadId: next.id, thread: prior,
      row: change.row, turn: change.turn, sessions, owner, now: input.now?.() ?? new Date().toISOString() })
    // Shared physical serialization remains held until filesystem/SQLite persistence settles.
    // A replacement Runtime can no longer commit stop ahead of this outstanding write.
    assertFollowUpArbitrationFence(input.state, input.scope.arbitration)
    return write()
  })
}

export async function assertNativeFollowUpPermit(input: {
  state: ServiceManagerState; roomStore: RoomStore; scope: NativeFollowUpWriteScope; threadId: string;
  thread: ThreadRecord | null | undefined; row: NativeFollowUpRequest; turn: Turn; sessions: SessionStore;
  owner: ReturnType<typeof CommitmentLinkSchema.parse>; now: string
}): Promise<void> {
  const { roomStore: store, scope, row, owner, now } = input
  const fail = (message?: string): never => { throw new NativeFollowUpPermitError(message) }
  assertFollowUpArbitrationFence(input.state, scope.arbitration)
  const executionRow = await store.get('commitment_execution', scope.admission.attemptId)
  const effectRow = await store.get('commitment_effect', scope.admission.effectId)
  if (!executionRow || !effectRow) return fail('native effect or execution is unavailable')
  const execution = CommitmentExecutionSchema.parse(executionRow.value), effect = CommitmentEffectSchema.parse(effectRow.value)
  const envelope = execution.envelope, permit = execution.permit
  // ManagerRemoteThreadStore strips prompt bodies before metadata writes.
  // Empty metadata is safe because promotion independently verifies the
  // exact persisted user item against the immutable template.
  if (effect.kind !== 'continue' || execution.phase === 'terminal' || execution.stopRequestedAt ||
    permit?.revokedAt || !permit?.native || !execution.nativeRequest) return fail('native execution is not permitted')
  if (!isDeepStrictEqual(effect.envelope, envelope) || execution.fingerprint !== effect.fingerprint ||
    scope.admission.requestId !== execution.requestId || scope.admission.admissionKey !== effect.admissionKey ||
    scope.admission.fingerprint !== execution.fingerprint || permit.admissionKey !== effect.admissionKey) {
    return fail('native effect identity does not match its permit')
  }
  if (permit.native.threadId !== input.threadId || execution.nativeRequest.threadId !== input.threadId ||
    permit.native.requestFingerprint !== row.requestFingerprint ||
    fingerprintStartTurnRequest(execution.nativeRequest.request) !== row.requestFingerprint ||
    row.requestFingerprint !== input.turn.clientRequestFingerprint ||
    execution.nativeRequest.request.clientRequestId !== input.turn.clientRequestId ||
    (execution.nativeRequest.request.prompt !== input.turn.prompt && input.turn.prompt !== '')) {
    return fail('native queued request does not match its permit')
  }
  if (owner.commitmentId !== envelope.commitmentId || owner.sourceRoomId !== envelope.sourceRoomId ||
    owner.participantAgentId !== execution.participantAgentId || !isDeepStrictEqual(owner.target, envelope.target)) {
    return fail('native target does not match its owner')
  }
  const request = execution.nativeRequest.request
  for (const key of exactRequestFields) {
    if (!isDeepStrictEqual(request[key], input.turn[key])) {
      return fail('native turn does not match its reserved request: ' + key)
    }
  }
  if (scope.stage === 'enqueue') assertInitialNativeSettings(input.thread, request, input.turn)
  const attachments = [...new Set((request.attachmentIds ?? []).map((id) => id.trim()).filter(Boolean))]
  if (!isDeepStrictEqual(attachments, input.turn.attachmentIds) ||
    !isDeepStrictEqual(request.composerContexts ?? [], input.turn.composerContexts ?? [])) {
    return fail('native turn attachments do not match its reserved request')
  }
  if (scope.stage === 'promote') {
    await assertNativeUserItem(input.sessions, row, execution.nativeRequest.request.prompt)
  }
  if (scope.stage === 'enqueue' && (effect.status !== 'dispatching' || !effect.claim ||
    effect.claim.ownerId !== scope.arbitration.fence.ownerInstanceId || effect.claim.token !== scope.claimToken ||
    effect.claim.expiresAt <= now || permit.claimToken > scope.claimToken)) return fail('native dispatch claim is not current')
  if (scope.stage === 'promote' && (row.phase !== 'admitted' ||
    !['dispatching', 'outcome_unknown', 'succeeded'].includes(effect.status))) return fail()
  const controlRow = await store.get('commitment_control', envelope.commitmentId)
  const commitmentRow = await store.get('agent_commitment', envelope.commitmentId)
  if (!controlRow || !commitmentRow) return fail()
  const control = CommitmentControlSchema.parse(controlRow.value), commitment = AgentCommitmentSchema.parse(commitmentRow.value)
  const policyRow = await store.get('collaboration_policy', control.policyRef)
  const policy = policyRow && CollaborationPolicySchema.parse(policyRow.value)
  if (control.stoppedAt || ['completed', 'cancelled'].includes(commitment.status) ||
    control.authorizationEpoch !== envelope.authorizationEpoch || control.generation < envelope.generation ||
    control.sourceRoomId !== envelope.sourceRoomId || control.participantAgentId !== execution.participantAgentId ||
    !policyRow || policyRow.revision !== envelope.policyVersion || !policy?.allowedActions.includes('continue') ||
    !followUpPolicyCurrent(commitment, control, policy, now)) return fail('native authorization was revoked or changed')
  // Pausing/disabling bumps generation but does not revoke a permit already issued
  // under this authorization epoch. Stop, takeover and scope changes do revoke it.
  // Source-backed admission is enabled only with the qualified source/grant adapter.
  if (envelope.source) return fail('source-backed native admission is not yet available')
}

/** Never trust the RPC's metadataOnly flag or its submitted prompt at promotion. */
async function assertNativeUserItem(sessions: SessionStore, row: NativeFollowUpRequest, prompt: string): Promise<void> {
  const fail = (): never => { throw new NativeFollowUpPermitError('canonical native user input is missing or changed') }
  // Exact-item requests return content fragments, not item envelopes. First
  // verify the bounded turn page's actual user-message identity and lifecycle.
  if (!sessions.loadDurableItemPage) throw new NativeFollowUpPermitError('durable native user input could not be verified')
  if (prompt.length > 256 * 1024 || Buffer.byteLength(prompt, 'utf8') > 256 * 1024) return fail()
  const durablePage = sessions.loadDurableItemPage.bind(sessions)
  const load = async (...args: Parameters<typeof durablePage>) => {
    try { return await durablePage(...args) }
    catch { throw new NativeFollowUpPermitError('durable native user input could not be verified') }
  }
  const options = { turnId: row.turnId, maxItems: 100, maxBytes: 256 * 1024 }
  const page = await load(row.threadId, { ...options, anchorTurnId: row.turnId })
  const matches = page.items.filter((candidate) => candidate.id === row.userMessageItemId)
  const item = matches[0]
  if (matches.length !== 1 || !item || item.kind !== 'user_message' || item.role !== 'user' || item.status !== 'completed' ||
    item.threadId !== row.threadId || item.turnId !== row.turnId) return fail()
  // Content pages contain at most 8 KiB characters each, independently of
  // maxBytes. Compare bounded fragments without trusting a display preview.
  let offset = 0
  for (let round = 0; round < 33; round += 1) {
    const part = await load(row.threadId, { ...options, itemId: row.userMessageItemId, contentOffset: offset })
    const content = part.content
    if (!content || content.itemId !== item.id || content.field !== 'text' || content.offset !== offset ||
      content.totalChars !== prompt.length || content.text !== prompt.slice(offset, offset + content.text.length)) return fail()
    offset += content.text.length
    if (content.nextOffset === undefined) {
      if (offset !== prompt.length) return fail()
      return
    }
    if (content.nextOffset !== offset || content.nextOffset >= prompt.length) return fail()
  }
  return fail()
}
