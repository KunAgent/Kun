import { z } from 'zod'
import { ApprovalPolicySchema, ApprovalReviewerSchema, SandboxModeSchema, KUN_TOOL_PERMISSION_MODES } from './policy.js'

export const RoomExecutionPolicySchema = z.object({ approvalPolicy: ApprovalPolicySchema,
  sandboxMode: SandboxModeSchema, approvalReviewer: ApprovalReviewerSchema }).strict()
export type RoomExecutionPolicy = z.infer<typeof RoomExecutionPolicySchema>
export const RoomPermissionRequestSchema = z.object({ clientRequestId: z.string().min(1).max(128),
  expectedRevision: z.number().int().nonnegative(), mode: z.enum(KUN_TOOL_PERMISSION_MODES) }).strict()
export type RoomPermissionRequest = z.infer<typeof RoomPermissionRequestSchema>
export function roomPermissionConsentSubject(roomId: string, input: RoomPermissionRequest) {
  return 'room-permission-v1:' + JSON.stringify([roomId, input.clientRequestId, input.expectedRevision, input.mode])
}
