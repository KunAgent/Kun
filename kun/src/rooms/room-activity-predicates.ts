export const ROOM_REQUEST_ATTENTION_STATUSES = [
  'needs_input',
  'failed',
  'recovery_required'
] as const

/** Only the latest private request is surfaced by direct chat; peer roots track their latest request. */
export function roomCurrentAttentionRequestSql(alias: string): string {
  return `(CASE WHEN json_extract(${alias}.document,'$.privateProtocol') IS NOT NULL THEN
    ${alias}.id=(SELECT latest.id FROM room_documents latest WHERE latest.kind='request' AND latest.room_id=${alias}.room_id
      AND json_extract(latest.document,'$.privateProtocol') IS NOT NULL ORDER BY latest.seq DESC LIMIT 1)
    ELSE (COALESCE(json_extract(${alias}.document,'$.collaborationProtocol'),'')<>'peer' OR
      ${alias}.id=COALESCE((SELECT COALESCE(json_extract(root.document,'$.peerLatestRequestId'),root.id)
        FROM room_documents root WHERE root.kind='request' AND root.id=COALESCE(json_extract(${alias}.document,'$.rootRequestId'),${alias}.id)),${alias}.id)) END)`
}

export function roomIntegrationHasTaskSql(alias: string): string {
  return `EXISTS(SELECT 1 FROM room_documents task WHERE task.kind='task' AND task.id=COALESCE(${alias}.task_id,json_extract(${alias}.document,'$.taskId')) AND task.room_id=${alias}.room_id)`
}

/** Matches roomActivitySummary attention keys: current requests, tasks, and integrations that still have a task. */
export function roomAttentionPredicateSql(alias: string): string {
  return `((${alias}.kind='task' AND ${alias}.status IN ('needs_input','needs_approval','recovery_required','failed','awaiting_acceptance')) OR (${alias}.kind='request' AND ${alias}.status IN ('needs_input','failed','recovery_required') AND ${roomCurrentAttentionRequestSql(alias)}) OR (${alias}.kind='integration' AND ${alias}.status IN ('preparing','validating','recovery_required','conflict','ready','failed') AND NOT(${alias}.status='failed' AND COALESCE(json_extract(${alias}.document,'$.cancelRequested'),0)=1 AND json_extract(${alias}.document,'$.applyIntent') IS NULL) AND (${alias}.status IN ('recovery_required','conflict','ready','failed') OR json_extract(${alias}.document,'$.applyIntent') IS NOT NULL OR COALESCE(json_array_length(${alias}.document,'$.attention.approvalIds'),0)>0 OR COALESCE(json_array_length(${alias}.document,'$.attention.userInputIds'),0)>0) AND ${roomIntegrationHasTaskSql(alias)}))`
}

export function isCurrentPeerRequest(
  request: {
    id: string
    collaborationProtocol?: string
    rootRequestId?: string
    peerLatestRequestId?: string
  },
  root?: { id: string; peerLatestRequestId?: string } | null
): boolean {
  if (request.collaborationProtocol !== 'peer') return true
  const latest = root ?? request
  return request.id === (latest.peerLatestRequestId ?? latest.id)
}

export function isAttentionRequestStatus(status: string): boolean {
  return (ROOM_REQUEST_ATTENTION_STATUSES as readonly string[]).includes(status)
}
