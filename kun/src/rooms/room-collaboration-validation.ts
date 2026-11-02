import { isDeepStrictEqual } from 'node:util'
import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { CollaborationDocumentKindSchema, type CollaborationDocumentKind } from '../contracts/collaboration-store.js'
import { CommitmentControlSchema, CommitmentLinkSchema, CommitmentSubscriptionSchema,
  CollaborationPolicySchema, followUpTargetKey } from '../contracts/collaboration-followup.js'
import { CollaborationSourceSchema, CollaborationSourceGrantSchema, CollaborationEventSchema,
  CommitmentEventBindingSchema } from '../contracts/collaboration-events.js'
import { CommitmentExecutionSchema, CommitmentEffectSchema } from '../contracts/collaboration-effects.js'
import { CommitmentAttentionSchema } from '../contracts/collaboration-attention.js'
import { RoomStoreConflictError, type RoomStoreCommit } from './room-store.js'
import { followUpTargetKeySql } from './room-collaboration-sqlite.js'

const schemas: Record<CollaborationDocumentKind, z.ZodType> = {
  commitment_control: CommitmentControlSchema, commitment_link: CommitmentLinkSchema,
  commitment_subscription: CommitmentSubscriptionSchema, collaboration_source: CollaborationSourceSchema,
  collaboration_source_grant: CollaborationSourceGrantSchema, collaboration_event: CollaborationEventSchema,
  commitment_event_binding: CommitmentEventBindingSchema, commitment_execution: CommitmentExecutionSchema,
  commitment_effect: CommitmentEffectSchema, commitment_attention: CommitmentAttentionSchema,
  collaboration_policy: CollaborationPolicySchema
}
const immutable: Record<CollaborationDocumentKind, readonly string[]> = {
  commitment_control: [], commitment_link: ['target', 'ownership', 'userEvidence', 'nativeTarget'],
  commitment_subscription: ['sourceId', 'grantRef', 'resource'],
  collaboration_source: ['provider', 'accountRef', 'credentialRef'],
  collaboration_source_grant: ['sourceId', 'accountRef', 'resource', 'userEvidence'],
  collaboration_event: [],
  commitment_event_binding: ['eventId', 'candidateGrantRef', 'purpose'],
  commitment_execution: ['attemptId', 'requestId', 'effectId', 'envelope', 'fingerprint', 'nativeRequest'],
  commitment_effect: ['effectId', 'kind', 'requestId', 'admissionKey', 'fingerprint', 'envelope'],
  commitment_attention: ['kind', 'sourceRef', 'artifactVersion', 'attemptId', 'question', 'choices'],
  collaboration_policy: ['userEvidence', 'commitmentFingerprint']
}
const identity = ['schemaVersion', 'id', 'createdAt', 'commitmentId', 'sourceRoomId', 'participantAgentId']

export function isCollaborationKind(kind: string): kind is CollaborationDocumentKind {
  return CollaborationDocumentKindSchema.safeParse(kind).success
}

/** Runs in the same transaction as CAS, before any row or request receipt becomes visible. */
export function validateCollaborationWrite(db: DatabaseSync, input: {
  kind: string; id: string; value: unknown; roomId?: string; taskId?: string;
}, prior?: { document: string; revision: number }): unknown {
  if (!isCollaborationKind(input.kind)) return input.value
  const kind = input.kind
  const value = schemas[kind].parse(input.value) as Record<string, unknown>
  const fail = (message: string): never => { throw new RoomStoreConflictError(message, prior?.revision ?? null) }
  if (value.id !== input.id) fail('collaboration document id mismatch')
  if (value.sourceRoomId !== undefined && input.roomId !== undefined && value.sourceRoomId !== input.roomId) {
    fail('collaboration source room mismatch')
  }
  // Sidecars describe execution targets but never become room-task execution documents themselves.
  if (input.taskId !== undefined) fail('collaboration sidecars cannot acquire task ownership')
  if (prior) {
    if (kind === 'collaboration_event') fail('collaboration events are immutable')
    const before = schemas[kind].parse(JSON.parse(prior.document)) as Record<string, unknown>
    for (const key of [...identity, ...immutable[kind]]) {
      if (!isDeepStrictEqual(before[key], value[key])) fail('collaboration identity cannot change: ' + key)
    }
    if (String(value.updatedAt) < String(before.updatedAt)) fail('collaboration update time cannot move backwards')
    for (const key of ['generation', 'sourceGeneration', 'credentialEpoch', 'authorizationEpoch', 'decisionVersion']) {
      if (typeof before[key] === 'number' && Number(value[key]) < before[key]) fail('collaboration epoch cannot decrease: ' + key)
    }
    if (kind === 'commitment_control' && !isDeepStrictEqual(before.userEvidence, value.userEvidence) &&
      (Number(value.generation) <= Number(before.generation) || Number(value.authorizationEpoch) <= Number(before.authorizationEpoch))) {
      fail('new authorization requires a new generation and epoch')
    }
    if (['commitment_link', 'commitment_execution'].includes(kind) && before.stopRequestedAt &&
      before.stopRequestedAt !== value.stopRequestedAt) fail('target stop intent cannot be undone')
    if (kind === 'commitment_effect') validateEffectTransition(before, value, fail)
    if (kind === 'commitment_execution') {
      const oldPermit = before.permit as Record<string, unknown> | undefined
      const permit = value.permit as Record<string, unknown> | undefined
      if (oldPermit) {
        if (!permit) fail('execution permit cannot be erased')
        for (const key of ['admissionKey', 'controlRevision', 'claimToken', 'issuedAt', 'native']) {
          if (!isDeepStrictEqual(oldPermit[key], permit?.[key])) fail('execution permit identity cannot change')
        }
        if (oldPermit.revokedAt && oldPermit.revokedAt !== permit?.revokedAt) fail('execution revocation cannot be undone')
      }
      if (before.dispatch && !isDeepStrictEqual(before.dispatch, value.dispatch)) fail('native dispatch intent cannot be changed or erased')
      if (before.phase === 'terminal' && value.phase !== 'terminal') fail('terminal execution cannot be revived')
    }
    if (kind === 'collaboration_source_grant' && before.revokedAt && before.revokedAt !== value.revokedAt) {
      fail('revoked grants require a new grant identity')
    }
    if (kind === 'commitment_attention' && before.status !== 'open' && !isDeepStrictEqual(before, value)) {
      fail('closed attention is immutable; create a new question for new evidence')
    }
  }
  if (kind === 'commitment_link') {
    const link = CommitmentLinkSchema.parse(value)
    if (link.active && link.ownership === 'owned') {
      if (link.target.kind === 'workbench_link') {
        const native = db.prepare("SELECT json_extract(document,'$.threadId') AS thread FROM room_documents WHERE kind='workbench_link' AND id=?")
          .get(link.target.linkId)
        if (native && native.thread !== link.target.threadId) fail('owned Workbench target thread mismatch')
      }
      const owner = db.prepare(`SELECT id FROM room_documents WHERE kind='commitment_link'
        AND json_extract(document,'$.active')=1 AND json_extract(document,'$.ownership')='owned'
        AND (${followUpTargetKeySql})=? AND id<>? LIMIT 1`).get(followUpTargetKey(link.target), link.id)
      if (owner) fail('execution target already has an active owner')
      let threadId = 'threadId' in link.target ? link.target.threadId : undefined
      if (link.target.kind === 'room_task') {
        const task = db.prepare("SELECT json_extract(document,'$.task.executionThreadId') AS thread FROM room_documents WHERE kind='task' AND id=?")
          .get(link.target.taskId)
        if (task?.thread) threadId = String(task.thread)
      }
      if (threadId) {
        // Room task IDs and Workbench IDs are not independent ownership domains for the same real thread.
        const alias = db.prepare(`SELECT l.id FROM room_documents l LEFT JOIN room_documents t
          ON t.kind='task' AND t.id=json_extract(l.document,'$.target.taskId')
          WHERE l.kind='commitment_link' AND l.id<>? AND json_extract(l.document,'$.active')=1
          AND json_extract(l.document,'$.ownership')='owned'
          AND (json_extract(l.document,'$.target.threadId')=? OR
            (json_extract(l.document,'$.target.kind')='room_task' AND json_extract(t.document,'$.task.executionThreadId')=?)) LIMIT 1`)
          .get(link.id, threadId, threadId)
        if (alias) fail('execution thread already has an active owner through another target')
      }
    }
  }
  if (kind === 'collaboration_event') {
    const event = CollaborationEventSchema.parse(value)
    const existing = db.prepare(`SELECT id FROM room_documents WHERE kind='collaboration_event'
      AND json_extract(document,'$.sourceId')=? AND json_extract(document,'$.nativeKey')=? AND id<>? LIMIT 1`)
      .get(event.sourceId, event.nativeKey, event.id)
    if (existing) fail('collaboration native event already exists')
  }
  return value
}

function validateEffectTransition(before: Record<string, unknown>, after: Record<string, unknown>, fail: (message: string) => never) {
  const oldEffect = CommitmentEffectSchema.parse(before), effect = CommitmentEffectSchema.parse(after)
  if (['succeeded', 'cancelled'].includes(oldEffect.status) && effect.status !== oldEffect.status) {
    fail('terminal effect cannot be revived')
  }
  if (oldEffect.status === 'outcome_unknown' && ['pending', 'dispatching'].includes(effect.status)) {
    fail('unknown outcome requires reconciliation, not redispatch')
  }
  if (effect.status === 'dispatching' && !['pending', 'dispatching'].includes(oldEffect.status)) {
    fail('dispatch must re-enter pending through proven non-admission')
  }
  if (['dispatching', 'outcome_unknown'].includes(oldEffect.status) && ['failed', 'cancelled'].includes(effect.status)) {
    const receipt = effect.receipt
    if (receipt?.state !== 'known_not_admitted' && !(receipt?.state === 'terminal' && receipt.terminalStatus === effect.status)) {
      fail('uncertain outcome requires authoritative reconciliation before closure')
    }
  }
  if (oldEffect.status !== 'pending' && effect.status === 'pending' && effect.receipt?.state !== 'known_not_admitted') {
    fail('retry requires authoritative proof of non-admission')
  }
  if (effect.status === 'succeeded' && !['accepted', 'terminal'].includes(effect.receipt?.state ?? '')) {
    fail('success requires an authoritative admission receipt')
  }
  if (effect.receipt && (effect.receipt.requestId !== effect.requestId || effect.receipt.fingerprint !== effect.fingerprint)) {
    fail('effect receipt identity mismatch')
  }
  if (oldEffect.receipt && ['accepted', 'terminal'].includes(oldEffect.receipt.state)) {
    if (!effect.receipt || !['accepted', 'terminal'].includes(effect.receipt.state) ||
      oldEffect.receipt.state === 'terminal' && (effect.receipt.state !== 'terminal' || effect.receipt.terminalStatus !== oldEffect.receipt.terminalStatus)) {
      fail('authoritative admission receipt cannot be erased or downgraded')
    }
    for (const key of ['receiver', 'targetRefId', 'threadId', 'turnId'] as const) {
      if (oldEffect.receipt[key] !== undefined && effect.receipt[key] !== oldEffect.receipt[key]) fail('admission receipt target cannot change')
    }
  }
  if (oldEffect.claim && !effect.claim) fail('effect claim fencing cannot be erased')
  if (effect.claim) {
    if (effect.claim.generation !== effect.envelope.generation || effect.claim.authorizationEpoch !== effect.envelope.authorizationEpoch) {
      fail('effect claim authorization mismatch')
    }
    if (oldEffect.status === 'pending' && effect.status === 'dispatching' && oldEffect.claim && effect.claim.token <= oldEffect.claim.token) {
      fail('a new dispatch claim requires a newer fencing token')
    }
    if (oldEffect.claim && (effect.claim.token < oldEffect.claim.token ||
      effect.claim.token === oldEffect.claim.token && effect.claim.ownerId !== oldEffect.claim.ownerId)) {
      fail('effect claim ownership requires a newer token')
    }
  }
}

/** Native-target aliases depend on final task/link values, so row-local validation alone is insufficient. */
export function validateCollaborationTargets(db: DatabaseSync, puts: NonNullable<RoomStoreCommit['puts']>): void {
  const checked = new Set<string>()
  const checkLink = (id: string) => {
    if (checked.has(id)) return
    checked.add(id)
    const row = db.prepare("SELECT document,room_id FROM room_documents WHERE kind='commitment_link' AND id=?").get(id)
    if (!row) return
    validateCollaborationWrite(db, { kind: 'commitment_link', id, value: JSON.parse(String(row.document)),
      ...(row.room_id ? { roomId: String(row.room_id) } : {}) })
  }
  for (const put of puts) {
    if (put.kind === 'commitment_link') checkLink(put.id)
    if (put.kind === 'task' || put.kind === 'workbench_link') {
      const key = put.kind === 'task' ? 'taskId' : 'linkId'
      const targetKind = put.kind === 'task' ? 'room_task' : 'workbench_link'
      const links = db.prepare(`SELECT id FROM room_documents WHERE kind='commitment_link'
        AND json_extract(document,'$.active')=1 AND json_extract(document,'$.ownership')='owned'
        AND json_extract(document,'$.target.kind')=? AND json_extract(document,'$.target.${key}')=?`).all(targetKind, put.id)
      for (const link of links) checkLink(String(link.id))
    }
  }
}

export function validateCollaborationMigration(db: DatabaseSync): void {
  for (const kind of CollaborationDocumentKindSchema.options) {
    const rows = db.prepare('SELECT id, document, room_id, task_id FROM room_documents WHERE kind=?').iterate(kind)
    for (const row of rows) {
      validateCollaborationWrite(db, { kind, id: String(row.id), value: JSON.parse(String(row.document)),
        ...(row.room_id ? { roomId: String(row.room_id) } : {}), ...(row.task_id ? { taskId: String(row.task_id) } : {}) })
    }
  }
}
