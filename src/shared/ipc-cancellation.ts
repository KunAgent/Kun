import { z } from 'zod'

const RequestId = z.string().trim().min(1).max(128)
const Timestamp = z.string().datetime({ offset: true })

/** A bounded request identity shared by the start, cancel, and terminal events. */
export const IpcOperationRequestSchema = z.object({
  requestId: RequestId,
  operation: z.string().trim().min(1).max(128)
}).strict()
export type IpcOperationRequest = z.infer<typeof IpcOperationRequestSchema>

/** Cancellation is a separate message so every long-running operation can acknowledge it. */
export const IpcCancellationRequestSchema = z.object({
  requestId: RequestId,
  reason: z.string().trim().min(1).max(256).optional(),
  requestedAt: Timestamp
}).strict()
export type IpcCancellationRequest = z.infer<typeof IpcCancellationRequestSchema>

export const IpcCancellationAckStatus = z.enum([
  'accepted',
  'already-terminal',
  'unknown-request'
])
export type IpcCancellationAckStatus = z.infer<typeof IpcCancellationAckStatus>

/** Acknowledgement confirms that the cancellation message was observed, not that work stopped. */
export const IpcCancellationAckSchema = z.object({
  requestId: RequestId,
  status: IpcCancellationAckStatus,
  acknowledgedAt: Timestamp
}).strict()
export type IpcCancellationAck = z.infer<typeof IpcCancellationAckSchema>

export const IpcOperationTerminalStatus = z.enum(['completed', 'failed', 'cancelled'])
export type IpcOperationTerminalStatus = z.infer<typeof IpcOperationTerminalStatus>

/** Exactly one terminal event is expected for a request; consumers must treat it as idempotent. */
export const IpcOperationTerminalSchema = z.object({
  requestId: RequestId,
  status: IpcOperationTerminalStatus,
  finishedAt: Timestamp,
  errorCode: z.string().trim().min(1).max(128).optional()
}).strict()
export type IpcOperationTerminal = z.infer<typeof IpcOperationTerminalSchema>
