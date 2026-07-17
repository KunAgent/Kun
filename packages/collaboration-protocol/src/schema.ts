import { z } from 'zod'

export const COLLABORATION_PROTOCOL_VERSION = 1 as const
export const MAX_CIPHERTEXT_BASE64_CHARS = 1_398_104

const Id = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const Sha256 = z.string().length(64).regex(/^[a-f0-9]+$/i)
const Base64 = z.string().min(1).regex(/^[A-Za-z0-9+/_-]+={0,2}$/)

export const EncryptedPayloadSchema = z.object({
  algorithm: z.enum(['mls', 'task-key', 'hpke', 'delivery-key']),
  ciphertext: Base64.max(MAX_CIPHERTEXT_BASE64_CHARS),
  contentType: z.string().min(1).max(128),
  plaintextBytes: z.number().int().nonnegative().max(100 * 1024 * 1024),
  sha256: Sha256,
  epoch: z.number().int().nonnegative().optional(),
  generation: z.number().int().nonnegative().optional(),
  nonce: Base64.max(128).optional()
}).strict().superRefine((value, context) => {
  if (value.algorithm === 'mls' && value.epoch === undefined) {
    context.addIssue({ code: 'custom', path: ['epoch'], message: 'MLS payloads require an epoch' })
  }
  if (value.algorithm === 'task-key' && value.generation === undefined) {
    context.addIssue({ code: 'custom', path: ['generation'], message: 'Task payloads require a generation' })
  }
})
export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>

export const SignedReceiptSchema = z.object({
  commandId: Id,
  meetingId: Id,
  sequence: z.number().int().positive(),
  acceptedAt: z.iso.datetime(),
  serverInstanceId: Id,
  signature: Base64.max(16_384)
}).strict()

export const InvitationBundleSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  invitationId: Id,
  serverUrl: z.url().refine((value) => new URL(value).protocol === 'https:', 'Invitation server URL must use HTTPS'),
  serverInstanceId: Id,
  spkiSha256: Sha256,
  meetingId: Id,
  oneTimeCredential: Base64.max(16_384),
  expiresAt: z.iso.datetime(),
  inviterMemberId: Id.optional(),
  welcome: EncryptedPayloadSchema.optional()
}).strict()
export type InvitationBundle = z.infer<typeof InvitationBundleSchema>

export const ClientHandshakeFrameSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: z.literal('handshake'),
  clientId: Id,
  supportedVersions: z.array(z.number().int().positive()).min(1).max(8),
  featureFlags: z.array(Id).max(64).default([])
}).strict()

export const ClientAuthFrameSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: z.literal('auth'),
  memberId: Id,
  deviceId: Id,
  credential: Base64.max(16_384),
  challengeSignature: Base64.max(16_384)
}).strict()

export const ClientCommandFrameSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: z.literal('command'),
  commandId: Id,
  meetingId: Id,
  expectedVersion: z.number().int().nonnegative(),
  payload: EncryptedPayloadSchema
}).strict()

export const ClientAckFrameSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: z.literal('ack'),
  meetingId: Id,
  sequence: z.number().int().nonnegative(),
  checkpointDigest: Sha256
}).strict()

export const ClientPresenceFrameSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: z.literal('presence'),
  meetingId: Id,
  status: z.enum(['online', 'away', 'offline']),
  sponsorTaskIds: z.array(Id).max(256).default([])
}).strict()

export const ClientFrameSchema = z.discriminatedUnion('kind', [
  ClientHandshakeFrameSchema,
  ClientAuthFrameSchema,
  ClientCommandFrameSchema,
  ClientAckFrameSchema,
  ClientPresenceFrameSchema
])
export type ClientFrame = z.infer<typeof ClientFrameSchema>

export const HumanCollaborationEventKindSchema = z.string().min(1).max(128).regex(
  /^(meeting_|human_task_|employee_invocation_|delivery_)[a-z0-9_]+$/,
  'Invalid human collaboration event namespace'
)

export const ServerEventSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: HumanCollaborationEventKindSchema,
  meetingId: Id,
  sequence: z.number().int().positive(),
  epoch: z.number().int().nonnegative(),
  payload: EncryptedPayloadSchema,
  receipt: SignedReceiptSchema
}).strict()
export type ServerEvent = z.infer<typeof ServerEventSchema>

export const MembershipRecordSchema = z.object({
  memberId: Id,
  deviceId: Id,
  role: z.string().min(1).max(64),
  status: z.enum(['invited', 'active', 'removed']),
  joinedAt: z.iso.datetime().optional(),
  removedAt: z.iso.datetime().optional()
}).strict()

export const SnapshotManifestSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  meetingId: Id,
  fromSequence: z.number().int().nonnegative(),
  throughSequence: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  checkpointDigest: Sha256,
  payload: EncryptedPayloadSchema,
  signature: Base64.max(16_384)
}).strict().refine(
  (value) => value.throughSequence >= value.fromSequence,
  { message: 'Snapshot sequence range is invalid', path: ['throughSequence'] }
)

export const BlobManifestSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  blobId: Id,
  meetingId: Id,
  totalBytes: z.number().int().positive().max(100 * 1024 * 1024),
  chunkBytes: z.number().int().min(64 * 1024).max(4 * 1024 * 1024),
  chunkCount: z.number().int().positive().max(1600),
  ciphertextSha256: Sha256,
  encryptedContentKey: EncryptedPayloadSchema,
  signature: Base64.max(16_384)
}).strict()

export const ProtocolErrorSchema = z.object({
  version: z.literal(COLLABORATION_PROTOCOL_VERSION),
  kind: z.literal('error'),
  code: z.enum([
    'unsupported_version', 'authentication_failed', 'forbidden', 'conflict',
    'rate_limited', 'quota_exceeded', 'payload_too_large', 'history_inconsistent',
    'invitation_invalid', 'invitation_consumed', 'server_identity_changed', 'internal_error'
  ]),
  message: z.string().min(1).max(512),
  requestId: Id.optional(),
  retryable: z.boolean(),
  retryAfterMs: z.number().int().nonnegative().max(86_400_000).optional(),
  currentVersion: z.number().int().nonnegative().optional()
}).strict()

export const CollaborationProtocolSchema = z.object({
  clientFrame: ClientFrameSchema,
  serverEvent: ServerEventSchema,
  invitation: InvitationBundleSchema,
  snapshot: SnapshotManifestSchema,
  blob: BlobManifestSchema,
  error: ProtocolErrorSchema
})
