import type {
  ApprovalReviewDecision,
  ApprovalReviewTerminalStatus
} from '../contracts/approvals.js'
import type {
  ApprovalRequest,
  ApprovalResolution
} from '../domain/approval.js'

/** Immutable route selected for the acting turn. Credentials are resolved by the model adapter. */
export type ApprovalReviewModelRoute = Readonly<{
  unresolvedGatewayAlias?: true
  requestedGatewayAlias?: string
  model: string
  providerId?: string
  accountId?: string
}>

export type ApprovalReviewInput = {
  approval: ApprovalRequest
  route?: ApprovalReviewModelRoute
  /** Bounded excerpt of the initiating user's intent; treated as untrusted data. */
  intent?: string
  signal: AbortSignal
}

export type ApprovalReviewResult = ApprovalResolution & {
  reviewer: 'agent'
  reviewId: string
  reviewStatus: ApprovalReviewTerminalStatus
  riskLevel?: ApprovalReviewDecision['riskLevel']
}

/** Isolated automatic-review boundary. It never owns executable tools. */
export interface ApprovalReviewPort {
  review(input: ApprovalReviewInput): Promise<ApprovalReviewResult>
}
