import { z } from 'zod'
import { InvitationBundleSchema } from '@kun/collaboration-protocol'

export const CollaborationNetworkStatusSchema = z.object({
  state: z.enum(['disabled', 'connecting', 'ready', 'SECURITY_SYNC_REQUIRED', 'error']),
  e2eeState: z.enum(['setup_required', 'pending_membership', 'ready', 'blocked']),
  serverUrl: z.url().optional(),
  serverInstanceId: z.string().optional(),
  memberId: z.string().optional(),
  deviceId: z.string().optional(),
  activeMeetingId: z.string().optional(),
  pendingInvitationId: z.string().optional(),
  lastVerifiedSequence: z.number().int().nonnegative().optional(),
  protocol: z.literal(1),
  transport: z.literal('tls13-spki'),
  encryption: z.literal('rfc9420-openmls'),
  error: z.string().optional()
}).strict()
export type CollaborationNetworkStatus = z.infer<typeof CollaborationNetworkStatusSchema>

export const CollaborationNetworkCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('network_local_server_start') }).strict(),
  z.object({ kind: z.literal('network_local_server_stop') }).strict(),
  z.object({
    kind: z.literal('network_operator_enroll'), serverUrl: z.url(),
    enrollmentToken: z.string().min(32), displayName: z.string().min(1).max(200)
  }).strict(),
  z.object({ kind: z.literal('network_meeting_enable'), meetingId: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal('network_invitation_create'), meetingId: z.string().min(1),
    role: z.enum(['admin', 'member', 'reviewer']).default('member'),
    expiresInSeconds: z.number().int().min(60).max(604_800).default(86_400)
  }).strict(),
  z.object({
    kind: z.literal('network_invitation_join'), invitation: InvitationBundleSchema,
    displayName: z.string().min(1).max(200)
  }).strict(),
  z.object({ kind: z.literal('network_join_requests'), meetingId: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal('network_join_approve'), meetingId: z.string().min(1), invitationId: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal('network_member_remove'), meetingId: z.string().min(1), memberId: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal('network_join_refresh'), meetingId: z.string().min(1), invitationId: z.string().min(1)
  }).strict(),
  z.object({ kind: z.literal('network_sync'), meetingId: z.string().min(1) }).strict()
])
export type CollaborationNetworkCommand = z.infer<typeof CollaborationNetworkCommandSchema>

export const CollaborationPendingJoinRequestSchema = z.object({
  invitationId: z.string().min(1), meetingId: z.string().min(1), memberId: z.string().min(1),
  deviceId: z.string().min(1), displayName: z.string().min(1), role: z.string().min(1), keyPackage: z.string().min(1)
}).strict()
export type CollaborationPendingJoinRequest = z.infer<typeof CollaborationPendingJoinRequestSchema>

export const MeetingMemberSchema = z.object({
  id: z.string().min(1), displayName: z.string().min(1), role: z.string().default('member'),
  status: z.enum(['online', 'offline', 'invited']).default('offline')
})

export const HumanTaskParticipantSchema = z.object({
  memberId: z.string().min(1), decision: z.enum(['pending', 'accepted', 'declined']),
  executionStatus: z.enum(['idle', 'working', 'blocked', 'submitted', 'completed']).default('idle')
})

export const HumanTaskProgressSchema = z.object({
  id: z.string(), memberId: z.string(), summary: z.string(), percent: z.number().min(0).max(100), createdAt: z.string()
})

export const CollaborationDeliverySchema = z.object({
  id: z.string(), memberId: z.string(), title: z.string(), summary: z.string(), status: z.enum(['submitted', 'accepted', 'revision_requested', 'waived']), createdAt: z.string()
})

export const HumanCollaborationTaskStatusSchema = z.enum([
  'proposed', 'accepted', 'in_progress', 'review', 'revision_requested', 'completed', 'declined', 'waived', 'cancelled'
])

export const HumanCollaborationTaskSchema = z.object({
  id: z.string(), meetingId: z.string(), title: z.string(), description: z.string(), creatorId: z.string(),
  targetMemberIds: z.array(z.string()), status: HumanCollaborationTaskStatusSchema,
  participants: z.array(HumanTaskParticipantSchema), progress: z.array(HumanTaskProgressSchema),
  deliveries: z.array(CollaborationDeliverySchema), localThreadId: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), version: z.number().int().positive()
})
export type HumanCollaborationTask = z.infer<typeof HumanCollaborationTaskSchema>

export const MeetingTimelineEventSchema = z.object({
  id: z.string(), kind: z.string().regex(/^(meeting_|human_task_|employee_invocation_)/),
  actorId: z.string(), summary: z.string(), createdAt: z.string()
})

export const MeetingSchema = z.object({
  id: z.string(), title: z.string().min(1), description: z.string().default(''),
  status: z.enum(['draft', 'active', 'closed']), members: z.array(MeetingMemberSchema),
  tasks: z.array(HumanCollaborationTaskSchema), timeline: z.array(MeetingTimelineEventSchema),
  createdAt: z.string(), updatedAt: z.string(), version: z.number().int().positive()
})
export type Meeting = z.infer<typeof MeetingSchema>

export const ReceptionEmployeePublicationSchema = z.object({
  id: z.string(), employeeId: z.string(), displayName: z.string(), description: z.string(),
  ownerDeviceId: z.string(), allowedToolNames: z.array(z.string()), status: z.enum(['available', 'busy', 'offline']),
  ownerEncryptionPublicKey: z.string().optional(),
  meetingIds: z.array(z.string()).default([]), taskIds: z.array(z.string()).default([]),
  updatedAt: z.string()
})
export type ReceptionEmployeePublication = z.infer<typeof ReceptionEmployeePublicationSchema>

export const EmployeeInvocationSchema = z.object({
  id: z.string(), employeeId: z.string(), requesterId: z.string(), ownerDeviceId: z.string(),
  status: z.enum(['awaiting_owner', 'running', 'completed', 'failed', 'interrupted']),
  prompt: z.string(), allowedToolNames: z.array(z.string()), threadId: z.string().optional(), turnId: z.string().optional(),
  meetingId: z.string().optional(),
  resultSummary: z.string().optional(), error: z.string().optional(), createdAt: z.string(), updatedAt: z.string()
})
export type EmployeeInvocation = z.infer<typeof EmployeeInvocationSchema>

export const LocalCollaborationSnapshotSchema = z.object({
  version: z.literal(1), meetings: z.array(MeetingSchema), employees: z.array(ReceptionEmployeePublicationSchema),
  invocations: z.array(EmployeeInvocationSchema), commandResults: z.record(z.string(), z.unknown()).default({})
})
export type LocalCollaborationSnapshot = z.infer<typeof LocalCollaborationSnapshotSchema>

export const HumanCollaborationCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meeting_create'), commandId: z.string(), title: z.string().min(1), description: z.string().default('') }),
  z.object({ kind: z.literal('meeting_close'), commandId: z.string(), meetingId: z.string() }),
  z.object({
    kind: z.literal('meeting_member_upsert'), commandId: z.string(), meetingId: z.string(), memberId: z.string(),
    displayName: z.string().min(1), role: z.string().min(1), status: z.enum(['online', 'offline', 'invited'])
  }),
  z.object({
    kind: z.literal('meeting_member_remove'), commandId: z.string(), meetingId: z.string(), memberId: z.string()
  }),
  z.object({ kind: z.literal('human_task_create'), commandId: z.string(), meetingId: z.string(), title: z.string().min(1), description: z.string().default(''), targetMemberIds: z.array(z.string()).default([]) }),
  z.object({ kind: z.literal('human_task_transition'), commandId: z.string(), meetingId: z.string(), taskId: z.string(), action: z.enum(['accept', 'decline', 'start', 'submit', 'request_revision', 'complete', 'waive', 'cancel']) }),
  z.object({ kind: z.literal('human_task_progress'), commandId: z.string(), meetingId: z.string(), taskId: z.string(), summary: z.string().min(1), percent: z.number().min(0).max(100) }),
  z.object({
    kind: z.literal('employee_publish'), commandId: z.string(), employeeId: z.string(), displayName: z.string().min(1),
    description: z.string().default(''), allowedToolNames: z.array(z.string()),
    ownerDeviceId: z.string().optional(), ownerEncryptionPublicKey: z.string().optional(),
    meetingIds: z.array(z.string()).default([]), taskIds: z.array(z.string()).default([])
  }),
  z.object({
    kind: z.literal('employee_invoke'), commandId: z.string(), employeeId: z.string(), prompt: z.string().min(1),
    meetingId: z.string().optional()
  }),
  z.object({ kind: z.literal('employee_interrupt'), commandId: z.string(), invocationId: z.string() })
])
export type HumanCollaborationCommand = z.infer<typeof HumanCollaborationCommandSchema>

export const CollaborationRemoteInvocationPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('remote_employee_request'), commandId: z.string().min(1), meetingId: z.string().min(1),
    version: z.literal(1), invocationId: z.string().min(1), employeeId: z.string().min(1),
    requesterId: z.string().min(1), requesterPublicKey: z.string().min(1), ownerDeviceId: z.string().min(1),
    enc: z.string().min(1), ciphertext: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal('remote_employee_response'), commandId: z.string().min(1), meetingId: z.string().min(1),
    version: z.literal(1), invocationId: z.string().min(1), requesterId: z.string().min(1),
    ownerDeviceId: z.string().min(1), enc: z.string().min(1), ciphertext: z.string().min(1)
  }).strict()
])
export type CollaborationRemoteInvocationPayload = z.infer<typeof CollaborationRemoteInvocationPayloadSchema>

export const CollaborationEncryptedCommandSchema = z.union([
  HumanCollaborationCommandSchema,
  CollaborationRemoteInvocationPayloadSchema
])
export type CollaborationEncryptedCommand = z.infer<typeof CollaborationEncryptedCommandSchema>

const TRANSITIONS: Record<HumanCollaborationTask['status'], Partial<Record<Extract<HumanCollaborationCommand, { kind: 'human_task_transition' }>['action'], HumanCollaborationTask['status']>>> = {
  proposed: { accept: 'accepted', decline: 'declined', cancel: 'cancelled' },
  accepted: { start: 'in_progress', cancel: 'cancelled' },
  in_progress: { submit: 'review', cancel: 'cancelled' },
  review: { request_revision: 'revision_requested', complete: 'completed', waive: 'waived' },
  revision_requested: { start: 'in_progress', cancel: 'cancelled' },
  completed: {}, declined: {}, waived: {}, cancelled: {}
}

export function transitionHumanTask(
  task: HumanCollaborationTask,
  action: Extract<HumanCollaborationCommand, { kind: 'human_task_transition' }>['action']
): HumanCollaborationTask {
  const status = TRANSITIONS[task.status][action]
  if (!status) throw new Error(`Invalid human task transition: ${task.status} -> ${action}`)
  return { ...task, status, updatedAt: new Date().toISOString(), version: task.version + 1 }
}
