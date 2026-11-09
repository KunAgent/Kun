import { isDeepStrictEqual } from 'node:util'
import type { NativeFollowUpRequest } from '../contracts/native-followup-requests.js'
import type { TurnMutationFence } from '../contracts/runtime-flavor.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { StartTurnRequest, Turn } from '../contracts/turns.js'
import { CommitmentExecutionSchema, CommitmentEffectSchema } from '../contracts/collaboration-effects.js'
import { CommitmentControlSchema, CommitmentLinkSchema, CollaborationPolicySchema } from '../contracts/collaboration-followup.js'
import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { retainNativeFollowUpRequests } from '../domain/native-followup-requests.js'
import { fingerprintStartTurnRequest } from '../domain/turn-request-fingerprint.js'
import { nativeFollowUpTargetFingerprint } from '../domain/native-followup-target.js'
import { makeUserItem } from '../domain/item.js'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import { followUpPolicyCurrent } from '../agents/followup/state.js'
import { resolveDesignTurnAdmission } from '../services/turn-service-design-admission.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { SessionStore } from '../ports/session-store.js'
import { assertFollowUpArbitrationFence, type ManagerFollowUpWriteArbitration } from './followup-arbitration.js'
import { NativeFollowUpPermitError, type NativeFollowUpWriteScope } from './native-followup-write-scope.js'
import { assertManualFollowUpEvidence } from './manual-followup-evidence.js'
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
  'mode', 'orchestration', 'disableUserInput', 'imContext', 'planBuild', 'workspaceCheckpointRequestId',
  // Host-resolved routing and hard gates must not move under an admitted turn.
  'actingModelRoute', 'requiredToolGate'] as const

// These are resolved by the runtime after a turn starts, but must not be
// injected into a pending queue entry or changed during its promotion.
const queuedOnlyTurnFields = ['activeSkillIds', 'gatewayAliasGrants', 'workspaceCheckpointId',
  'extensionBudgetTokenBaseline', 'extensionModelRequests', 'extensionToolInvocations'] as const

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
  // A request may repeat the bound route, but must not move user context to a
  // different model, provider, or account without a new user authorization.
  const model = nonBlank(thread.model)
  const threadProviderId = nonBlank(thread.providerId)
  const providerId = threadProviderId ?? 'default'
  const accountId = nonBlank(thread.accountId)
  if (!model || nonBlank(request.model) && nonBlank(request.model) !== model ||
    nonBlank(request.providerId) && nonBlank(request.providerId) !== providerId ||
    nonBlank(request.accountId) && nonBlank(request.accountId) !== accountId ||
    request.mode !== undefined && request.mode !== thread.mode) {
    return fail('native request changes the linked execution route')
  }
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
  // A continuation cannot choose a different approval or sandbox regime just
  // by placing an override in its otherwise immutable request template.
  for (const key of ['approvalPolicy', 'sandboxMode', 'approvalReviewer'] as const) {
    if (request[key] !== undefined && request[key] !== thread[key]) {
      return fail('native request changes linked permissions: ' + key)
    }
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
    const turn = next.turns.find((candidate) => candidate.id === row.turnId)
    if (old?.phase === 'preparing' && row.phase === 'known_not_admitted') {
      throw new NativeFollowUpPermitError('native rollback requires authoritative negative reconciliation')
    }
    if (old?.phase === 'preparing' && row.phase === 'admitted') {
      if (!turn || turn.status !== 'queued' || turn.admissionPending || !turn.admissionCompletedAt) {
        throw new NativeFollowUpPermitError('native acceptance requires completed queue admission')
      }
      changes.set(turn.id, { turn, row, stage: 'enqueue' })
      continue
    }
    const prepared = !old || row.preparationRevision > old.preparationRevision
    if (!prepared) continue
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
  scope?: NativeFollowUpWriteScope; turnFence?: TurnMutationFence; now?: () => string
}): ThreadAdmissionWriteGuard {
  return (store, next, write, sessions) => input.writes.run(async () => {
    const prior = store.getMetadata ? await store.getMetadata(next.id) : await store.get(next.id)
    if (prior) {
      const oldTurns = new Map(prior.turns.map((turn) => [turn.id, turn]))
      const newTurns = new Map(next.turns.map((turn) => [turn.id, turn]))
      const activeNativeIds = (prior.nativeFollowUpRequests ?? []).map((row) => row.turnId)
        .filter((id) => active(oldTurns.get(id)))
      if (activeNativeIds.some((id) => !newTurns.has(id))) {
        throw new NativeFollowUpPermitError('active native execution cannot be removed before settlement')
      }
      if (activeNativeIds.length && nativeFollowUpTargetFingerprint(prior) !== nativeFollowUpTargetFingerprint(next)) {
        throw new NativeFollowUpPermitError('native target authority cannot change while work is active')
      }
      // Terminal receipts must reflect a real terminal transition, not a forged row or queued completion.
      const effective = retainNativeFollowUpRequests(prior, next)
      for (const oldRow of prior.nativeFollowUpRequests ?? []) {
        const row = effective.nativeFollowUpRequests?.find(candidate => candidate.admission.requestId === oldRow.admission.requestId)
        const before = oldTurns.get(oldRow.turnId), after = newTurns.get(oldRow.turnId)
        if (!row || !before) continue
        const terminal = after?.status === 'completed' ? 'completed' : after?.status === 'failed' ? 'failed'
          : after?.status === 'aborted' ? 'cancelled' : undefined
        if (row.terminalStatus && (!oldRow.terminalStatus || after) && row.terminalStatus !== terminal) {
          throw new NativeFollowUpPermitError('native terminal receipt does not match a terminal turn')
        }
        if (!oldRow.terminalStatus && row.terminalStatus && after) {
          if (before.status === 'queued' && (after.status === 'completed' || after.startedAt)) {
            throw new NativeFollowUpPermitError('an unstarted native turn cannot be reported as executed')
          }
          if (before.status === 'running') {
            const fence = input.turnFence
            if (!fence || fence.threadId !== prior.id || fence.turnId !== before.id) {
              throw new NativeFollowUpPermitError('native terminal outcome requires the executing turn fence')
            }
            try { input.state.assertTurnMutationFence(fence) }
            catch { throw new NativeFollowUpPermitError('native terminal outcome has a stale turn fence') }
          }
        }
      }
    }
    const changes = nativeFollowUpAdmissionChanges(prior, next)
    if (!changes.length) return write()
    const owners = await input.roomStore.collaborationQuery({ kind: 'owned_thread', threadId: next.id })
    if (!owners.length && changes.every((change) => !change.row)) return write()
    if (owners.length !== 1 || changes.length !== 1 || !input.scope) throw new NativeFollowUpPermitError()
    const owner = CommitmentLinkSchema.parse(owners[0].value), change = changes[0]
    if (owner.stopRequestedAt || !change.row || change.stage !== input.scope.stage ||
      !isDeepStrictEqual(change.row.admission, input.scope.admission)) throw new NativeFollowUpPermitError()
    const assertCoordinator = (): void => {
      const coordinator = input.scope!.coordinatorFence, arbitration = input.scope!.arbitration.fence
      if (coordinator.resource !== 'rooms-coordinator' || coordinator.ownerFlavor !== arbitration.ownerFlavor ||
        coordinator.ownerInstanceId !== arbitration.ownerInstanceId ||
        input.state.registration(coordinator.ownerFlavor)?.instanceId !== coordinator.ownerInstanceId) {
        throw new NativeFollowUpPermitError('native admission requires the current rooms coordinator')
      }
      try { input.state.assertResource(coordinator) }
      catch { throw new NativeFollowUpPermitError('rooms coordinator fence is no longer current') }
    }
    const assertPromotionLease = (): void => {
      if (change.stage !== 'promote') return
      const lease = input.state.lease(next.id), arbitration = input.scope!.arbitration.fence
      if (!lease || lease.turnId !== change.turn.id || lease.ownerFlavor !== arbitration.ownerFlavor ||
        lease.ownerInstanceId !== arbitration.ownerInstanceId) {
        throw new NativeFollowUpPermitError('native promotion requires the current turn owner lease')
      }
      try { input.state.assertTurnMutationFence(lease) }
      catch { throw new NativeFollowUpPermitError('native turn owner lease is no longer current') }
    }
    assertCoordinator()
    assertPromotionLease()
    await assertNativeFollowUpPermit({ ...input, scope: input.scope, threadId: next.id, thread: prior, next,
      row: change.row, turn: change.turn, sessions, owner, now: input.now?.() ?? new Date().toISOString() })
    // Shared physical serialization remains held until filesystem/SQLite persistence settles.
    // A replacement Runtime can no longer commit stop ahead of this outstanding write.
    assertFollowUpArbitrationFence(input.state, input.scope.arbitration)
    assertCoordinator()
    assertPromotionLease()
    return write()
  })
}

export async function assertNativeFollowUpPermit(input: {
  state: ServiceManagerState; roomStore: RoomStore; scope: NativeFollowUpWriteScope; threadId: string;
  thread: ThreadRecord | null | undefined; next: ThreadRecord; row: NativeFollowUpRequest; turn: Turn; sessions: SessionStore;
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
  if (!input.thread || !owner.nativeTarget || owner.nativeTarget.threadId !== input.threadId ||
    owner.nativeTarget.fingerprint !== permit.native.targetFingerprint ||
    nativeFollowUpTargetFingerprint(input.thread) !== owner.nativeTarget.fingerprint ||
    nativeFollowUpTargetFingerprint(input.next) !== owner.nativeTarget.fingerprint) {
    return fail('native target authority changed since it was linked')
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
  if (scope.stage === 'promote' || row.phase === 'admitted') {
    await assertNativeUserItem(input.sessions, row, request, input.thread, input.turn)
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
  if (permit.native.manualEventId) {
    if (!execution.dispatch || scope.claimToken < execution.dispatch.claimToken) {
      return fail('manual native dispatch has not been authorized')
    }
    await assertManualFollowUpEvidence({ store, execution, commitment, control, policy, owner })
  }
  // Pausing/disabling bumps generation but does not revoke a permit already issued
  // under this authorization epoch. Stop, takeover and scope changes do revoke it.
  // Source-backed admission is enabled only with the qualified source/grant adapter.
  if (envelope.source) return fail('source-backed native admission is not yet available')
}

/** Never trust the RPC's metadata or a renderer-oriented, truncated history preview. */
export async function assertNativeUserItem(sessions: SessionStore, row: NativeFollowUpRequest,
  request: StartTurnRequest, thread: ThreadRecord, turn: Turn): Promise<void> {
  const fail = (): never => { throw new NativeFollowUpPermitError('canonical native user input is missing or changed') }
  if (!sessions.loadDurableItemPage) throw new NativeFollowUpPermitError('durable native user input could not be verified')
  if (request.prompt.length > 256 * 1024 || Buffer.byteLength(request.prompt, 'utf8') > 256 * 1024) return fail()
  let page: Awaited<ReturnType<NonNullable<SessionStore['loadDurableItemPage']>>>
  try {
    page = await sessions.loadDurableItemPage(row.threadId, {
      turnId: row.turnId, exactItemId: row.userMessageItemId, maxItems: 1, maxBytes: 1024 * 1024
    })
  } catch { throw new NativeFollowUpPermitError('durable native user input could not be verified') }
  const item = page.items[0]
  if (page.items.length !== 1 || !item || item.kind !== 'user_message' || item.role !== 'user' ||
    item.status !== 'completed' || item.id !== row.userMessageItemId || item.threadId !== row.threadId ||
    item.turnId !== row.turnId || item.text !== request.prompt) return fail()
  const design = resolveDesignTurnAdmission({ thread, request, turnId: row.turnId })
  const expected = makeUserItem({ id: row.userMessageItemId, threadId: row.threadId, turnId: row.turnId,
    text: request.prompt, displayText: request.displayText, messageSource: request.messageSource,
    attachmentIds: turn.attachmentIds, attachmentAliases: turn.attachmentAliases, composerContexts: turn.composerContexts,
    fileReferences: request.fileReferences, workspaceCheckpointId: request.workspaceCheckpointId,
    workspace: thread.workspace, historyRefId: thread.historyRefId,
    threadAgentSurface: design.locksSurface && design.effectiveSurface
      ? design.effectiveSurface : resolveThreadAgentSurface(thread),
    agentSurface: turn.agentSurface, designProfile: turn.designProfile, designDocumentTarget: turn.designDocumentTarget,
    designImagePlacementTarget: request.designImagePlacementTarget })
  if (expected.kind !== 'user_message') return fail()
  for (const key of ['displayText', 'messageSource', 'attachmentIds', 'attachmentAliases', 'composerContexts',
    'reviewRequests', 'fileReferences', 'historyRefId', 'workspaceCheckpointId', 'workspace', 'threadAgentSurface',
    'agentSurface', 'designProfile', 'designDocumentTarget', 'designImagePlacementTarget'] as const) {
    if (!isDeepStrictEqual(item[key], expected[key])) return fail()
  }
}
