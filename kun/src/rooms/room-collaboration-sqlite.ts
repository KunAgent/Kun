import type { DatabaseSync } from 'node:sqlite'
import { CollaborationQuerySchema, type CollaborationQuery } from '../contracts/collaboration-store.js'
import type { RoomStoredDocument, RoomDocumentKind } from './room-store.js'

// Canonical aliases match followUpTargetKey: a Workbench link never owns its thread twice.
export const followUpTargetKeySql = `CASE json_extract(document,'$.target.kind')
  WHEN 'workbench_link' THEN json_array('thread',json_extract(document,'$.target.threadId'))
  WHEN 'thread' THEN json_array('thread',json_extract(document,'$.target.threadId'))
  WHEN 'room_task' THEN json_array('room_task',json_extract(document,'$.target.taskId'))
  WHEN 'ade' THEN json_array('ade',json_extract(document,'$.target.intentId'))
  WHEN 'handoff' THEN json_array('handoff',json_extract(document,'$.target.handoffId'))
  WHEN 'artifact' THEN json_array('artifact',json_extract(document,'$.target.artifactId'))
  WHEN 'github_pull_request' THEN json_array('github_pull_request',json_extract(document,'$.target.repositoryId'),json_extract(document,'$.target.number'))
END`

/** Called within the version migration transaction, before changing user_version. */
export function initializeCollaborationIndexes(db: DatabaseSync): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS collaboration_commitment ON room_documents(
      kind,json_extract(document,'$.commitmentId'),json_extract(document,'$.participantAgentId'),room_id,
      json_extract(document,'$.updatedAt'),id);
    CREATE INDEX IF NOT EXISTS collaboration_effect_pending ON room_documents(
      status,json_extract(document,'$.retryAt'),id) WHERE kind='commitment_effect';
    CREATE INDEX IF NOT EXISTS collaboration_effect_claim ON room_documents(
      status,json_extract(document,'$.claim.expiresAt'),id) WHERE kind='commitment_effect';
    CREATE INDEX IF NOT EXISTS collaboration_effect_reconcile ON room_documents(
      status,json_extract(document,'$.nextReconcileAt'),id) WHERE kind='commitment_effect';
    CREATE INDEX IF NOT EXISTS collaboration_execution_due ON room_documents(
      json_extract(document,'$.phase'),json_extract(document,'$.nextReconcileAt'),id)
      WHERE kind='commitment_execution';
    CREATE INDEX IF NOT EXISTS collaboration_subscription_due ON room_documents(
      json_extract(document,'$.enabled'),json_extract(document,'$.nextPollAt'),id)
      WHERE kind='commitment_subscription';
    CREATE INDEX IF NOT EXISTS collaboration_subscription_source ON room_documents(
      json_extract(document,'$.sourceId'),json_extract(document,'$.updatedAt'),id)
      WHERE kind='commitment_subscription';
    CREATE UNIQUE INDEX IF NOT EXISTS collaboration_event_identity ON room_documents(
      json_extract(document,'$.sourceId'),json_extract(document,'$.nativeKey'))
      WHERE kind='collaboration_event';
    CREATE UNIQUE INDEX IF NOT EXISTS collaboration_owned_target ON room_documents(${followUpTargetKeySql})
      WHERE kind='commitment_link' AND json_extract(document,'$.active')=1
      AND json_extract(document,'$.ownership')='owned';
    CREATE UNIQUE INDEX IF NOT EXISTS collaboration_effect_admission ON room_documents(
      json_extract(document,'$.admissionKey')) WHERE kind='commitment_effect';
    CREATE UNIQUE INDEX IF NOT EXISTS collaboration_execution_request ON room_documents(
      json_extract(document,'$.requestId')) WHERE kind='commitment_execution';
    CREATE INDEX IF NOT EXISTS collaboration_attention ON room_documents(
      json_extract(document,'$.participantAgentId'),room_id,status,json_extract(document,'$.priority') DESC,
      json_extract(document,'$.updatedAt') DESC,id DESC) WHERE kind='commitment_attention';
  `)
}

type Row = {
  kind: RoomDocumentKind; id: string; room_id: string | null; task_id: string | null;
  revision: number; seq: number; document: string
}

export function queryCollaboration<T = unknown>(db: DatabaseSync, input: CollaborationQuery): RoomStoredDocument<T>[] {
  const query = CollaborationQuerySchema.parse(input)
  const args: (string | number)[] = []
  const where: string[] = []
  let at = "json_extract(document,'$.updatedAt')", order = 'ASC', limit = 1
  let priority = false
  switch (query.kind) {
    case 'due_effects':
      where.push("kind='commitment_effect'", 'status=?')
      args.push(query.status)
      at = query.status === 'pending' ? "json_extract(document,'$.retryAt')" : query.status === 'dispatching'
        ? "json_extract(document,'$.claim.expiresAt')" : "json_extract(document,'$.nextReconcileAt')"
      break
    case 'due_executions':
      where.push("kind='commitment_execution'", "json_extract(document,'$.phase')=?")
      args.push(query.phase)
      at = "json_extract(document,'$.nextReconcileAt')"
      break
    case 'due_subscriptions':
      where.push("kind='commitment_subscription'", "json_extract(document,'$.enabled')=1")
      at = "json_extract(document,'$.nextPollAt')"
      break
    case 'by_commitment':
      where.push('kind=?', "json_extract(document,'$.commitmentId')=?",
        "json_extract(document,'$.participantAgentId')=?", 'room_id=?')
      args.push(query.documentKind, query.commitmentId, query.participantAgentId, query.sourceRoomId)
      order = 'DESC'
      break
    case 'commitment_activity': {
      const categories = {
        links: { kind: 'commitment_link', predicate: "json_extract(document,'$.active')=1" },
        subscriptions: { kind: 'commitment_subscription', predicate: "json_extract(document,'$.enabled')=1" },
        executions: { kind: 'commitment_execution', predicate: "json_extract(document,'$.phase')<>'terminal'" },
        effects: { kind: 'commitment_effect', predicate: "status IN ('pending','dispatching','outcome_unknown')" },
        attention: { kind: 'commitment_attention', predicate: "status='open'" }
      }
      const category = categories[query.category]
      where.push('kind=?', "json_extract(document,'$.commitmentId')=?",
        "json_extract(document,'$.participantAgentId')=?", 'room_id=?', category.predicate)
      args.push(category.kind, query.commitmentId, query.participantAgentId, query.sourceRoomId)
      order = 'DESC'
      break
    }
    case 'attention':
      where.push("kind='commitment_attention'", "json_extract(document,'$.participantAgentId')=?", 'room_id=?', 'status=?')
      args.push(query.participantAgentId, query.sourceRoomId, query.status)
      order = 'DESC'
      priority = true
      break
    case 'source_subscriptions':
      where.push("kind='commitment_subscription'", "json_extract(document,'$.sourceId')=?")
      args.push(query.sourceId)
      break
    case 'owned_target':
      where.push("kind='commitment_link'", "json_extract(document,'$.active')=1",
        "json_extract(document,'$.ownership')='owned'", `(${followUpTargetKeySql})=?`)
      args.push(query.targetKey)
      break
  }
  if ('before' in query) {
    where.push(`${at} IS NOT NULL`, `${at}<=?`)
    args.push(query.before)
  }
  if ('cursor' in query && query.cursor) {
    const cursor = query.cursor
    const comparison = order === 'ASC' ? '>' : '<'
    if ('priority' in cursor) {
      where.push(`(json_extract(document,'$.priority'),${at},id) < (?,?,?)`)
      args.push(cursor.priority, cursor.at, cursor.id)
    } else {
      where.push(`(${at},id) ${comparison} (?,?)`)
      args.push(cursor.at, cursor.id)
    }
  }
  if ('limit' in query) limit = query.limit
  args.push(limit)
  const ordering = query.kind === 'owned_target' ? '' : `ORDER BY ${priority ? "json_extract(document,'$.priority') DESC," : ''}${at} ${order},id ${order}`
  const rows = db.prepare(`SELECT * FROM room_documents WHERE ${where.join(' AND ')} ${ordering} LIMIT ?`).all(...args) as Row[]
  return rows.map((row) => ({ kind: row.kind, id: row.id, revision: row.revision, seq: row.seq,
    ...(row.room_id ? { roomId: row.room_id } : {}), ...(row.task_id ? { taskId: row.task_id } : {}),
    value: JSON.parse(row.document) as T }))
}
