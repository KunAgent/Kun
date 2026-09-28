/**
 * GET /v1/approvals projection (P3-19): the pending subset every client can
 * render for its "needs you" list. Decisions stay on POST /v1/approvals/:id.
 */
export type PendingApprovalItem = {
  approvalId: string
  threadId: string
  turnId: string
  toolName: string
  summary: string
  createdAt: string
}

export type PendingApprovalListResponse = {
  approvals: PendingApprovalItem[]
}
