import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentCommitmentSchema } from '../contracts/agent-commitments.js'
import { CollaborationPolicySchema } from '../contracts/collaboration-followup.js'
import type { NativeFollowUpRequest } from '../contracts/native-followup-requests.js'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { TurnSchema } from '../contracts/turns.js'
import { createThreadRecord } from '../domain/thread.js'
import { fingerprintStartTurnRequest } from '../domain/turn-request-fingerprint.js'
import { commitmentScopeFingerprint } from '../agents/followup/state.js'
import { base, scope, control, link, effect, execution, time, userEvidence } from '../rooms/room-collaboration-test-fixtures.js'
import type { RoomDocumentKind } from '../rooms/room-store.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { buildServiceManagerRouter } from './service-manager-router.js'
import { ServiceManagerState } from './service-manager-state.js'
import { requestManagerJson, type ServiceManagerConnection } from './manager-client.js'
import { FOLLOW_UP_ARBITRATION_LEASE } from './followup-arbitration.js'
import type { NativeFollowUpWriteScope } from './native-followup-write-scope.js'

export async function nativeManagerFixture(prompt = 'Continue this repair', model?: string) {
  const root = await mkdtemp(join(tmpdir(), 'kun-native-authority-'))
  const data = await ManagerSharedDataStore.create(join(root, 'data'))
  const state = new ServiceManagerState()
  state.register({ flavor: 'production', instanceId: 'runtime', pid: process.pid,
    startedAt: new Date().toISOString(), host: '127.0.0.1', port: 18899,
    baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'runtime-token' })
  const router = buildServiceManagerRouter({ managerToken: 'manager-token', instanceId: 'manager',
    startedAt: time, state, sharedData: data })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  const connection: ServiceManagerConnection = { discovery: { version: 1, protocolVersion: 7,
    instanceId: 'manager', pid: process.pid, startedAt: time, host: '127.0.0.1', port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'manager-token', serviceVersion: 'test',
    dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json') } }
  const initial = createThreadRecord({ id: 'thread', workspace: '/tmp/followup-authority', title: 'Repair', model: 'test' })
  const thread = ThreadSchema.parse(await data.executeThread('upsert', { thread: initial }))
  let seq = 0
  const put = async (kind: RoomDocumentKind, id: string, value: unknown) => {
    const old = await data.roomStore.get(kind, id)
    return data.roomStore.commit({ requestId: `fixture:${++seq}`, checks: [{ kind, id, expectedRevision: old?.revision ?? null }],
      puts: [{ kind, id, value }] })
  }
  const e = { ...effect(), status: 'dispatching' as const, retryAt: null,
    claim: { ownerId: 'runtime', token: 1, generation: 0, authorizationEpoch: 0, expiresAt: '2999-01-01T00:00:00.000Z' } }
  const request = { prompt, clientRequestId: e.requestId, ...(model ? { model } : {}) }
  const requestFingerprint = fingerprintStartTurnRequest(request)!
  const exec = { ...execution(), nativeRequest: { threadId: thread.id, request }, phase: 'admitted' as const,
    permit: { admissionKey: e.admissionKey, claimToken: 1, controlRevision: 0, issuedAt: time,
      native: { threadId: thread.id, requestFingerprint, issuanceId: 'manager-issued-fixture' } } }
  const commitment = AgentCommitmentSchema.parse({ ...base('commitment'), participantAgentId: scope.participantAgentId,
    sourceRoomId: scope.sourceRoomId,
    sourceMessageId: 'message', objective: 'Repair', acceptance: 'Tests pass', status: 'in_progress',
    authorization: { kind: 'user_message', messageRevision: 0, text: 'Repair', capturedAt: time } })
  const policy = CollaborationPolicySchema.parse({ ...base('policy'), ...scope,
    commitmentFingerprint: commitmentScopeFingerprint(commitment), continuationMode: 'manual', newWorkMode: 'off',
    allowedActions: ['continue'], limits: { attemptsPerDay: 3, attemptsTotal: 10, minimumIntervalMs: 1000, softTokenBudget: 1000 },
    expiresAt: '2999-01-01T00:00:00.000Z', userEvidence })
  const admission = { requestId: e.requestId, effectId: e.effectId, attemptId: exec.attemptId,
    admissionKey: e.admissionKey, fingerprint: e.fingerprint }
  const queued = TurnSchema.parse({ id: 'turn', threadId: thread.id, status: 'queued', prompt: request.prompt,
    createdAt: time, clientRequestId: e.requestId, clientRequestFingerprint: requestFingerprint, admissionPending: true,
    model: model ?? thread.model, providerId: thread.providerId ?? 'default', harnessId: 'kun', credentialMode: 'provider',
    approvalPolicy: thread.approvalPolicy, sandboxMode: thread.sandboxMode, approvalReviewer: thread.approvalReviewer,
    mode: thread.mode, collaborationEnabled: thread.collaboration?.enabled ?? thread.workspaceMode === 'ade',
    agentSurface: 'code', composerContexts: [] })
  const row: NativeFollowUpRequest = { threadId: thread.id, admission, requestFingerprint,
    turnId: queued.id, userMessageItemId: 'user-item', preparationRevision: 1,
    phase: 'preparing', createdAt: time, updatedAt: time }
  const next: ThreadRecord = { ...thread, status: 'running', turns: [queued], nativeFollowUpRequests: [row], updatedAt: time }
  const acquired = state.acquireResource({ resource: FOLLOW_UP_ARBITRATION_LEASE,
    ownerFlavor: 'production', ownerInstanceId: 'runtime' })
  const fence = acquired.lease
  state.beginResourceCommit(fence, 'native-commit')
  const writeScope: NativeFollowUpWriteScope = { admission, stage: 'enqueue', claimToken: 1,
    arbitration: { fence: { resource: fence.resource, ownerFlavor: fence.ownerFlavor,
      ownerInstanceId: fence.ownerInstanceId, fencingToken: fence.fencingToken }, commitId: 'native-commit' } }
  const seed = async (target?: Parameters<typeof link>[1]) => {
    await put('agent_commitment', commitment.id, commitment)
    await put('commitment_control', commitment.id, control())
    await put('collaboration_policy', policy.id, policy)
    await put('commitment_link', 'link', link('link', target))
    await put('commitment_effect', e.id, e)
    // Seed a trusted issuer result directly. These tests do not claim to exercise permit issuance.
    await put('commitment_execution', exec.id, exec)
  }
  const send = (value: ThreadRecord, followUp?: NativeFollowUpWriteScope, conditional = true, metadataOnly = false) =>
    requestManagerJson(connection, `/v1/data/thread/${conditional ? 'upsertIfRevision' : 'upsert'}`, {
      method: 'POST', body: { value: { thread: value, ...(metadataOnly ? { metadataOnly: true } : {}),
        ...(conditional ? { expectedRevision: value.revision ?? 0 } : {}) }, ...(followUp ? { followUp } : {}) }
    })
  const close = async () => { await server.close(); await data.close(); await rm(root, { recursive: true, force: true }) }
  return { root, data, state, server, connection, thread, next, row, exec, e, commitment, policy,
    scope: writeScope, put, seed, send, close }
}
export type NativeManagerFixture = Awaited<ReturnType<typeof nativeManagerFixture>>
