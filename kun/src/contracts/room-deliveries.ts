import { z } from 'zod'
import { RoomIdSchema } from './rooms.js'

const RevisionHash = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const RelativeFile = z.string().min(1).max(4096).refine((path) =>
  !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') &&
  !/^[A-Za-z]:/.test(path) && !path.split('/').some((part) => part === '..' || part === '.' || !part),
'repository relative file required')

export const RoomVerificationEvidenceSchema = z.object({
  command: z.string().min(1).max(16000),
  cwd: z.string().min(1).max(4096),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['not_run', 'passed', 'failed', 'timed_out']),
  exitCode: z.number().int().nullable(),
  logArtifactId: z.string().min(1).max(256).optional(),
  reason: z.string().max(4000).optional()
}).strict().superRefine((evidence, ctx) => {
  if (evidence.status === 'passed' && (evidence.exitCode !== 0 || !evidence.endedAt || !evidence.logArtifactId)) {
    ctx.addIssue({ code: 'custom', message: 'passing verification requires exit zero and persisted execution evidence' })
  }
  if (evidence.status === 'not_run' && (evidence.exitCode !== null || !evidence.reason)) {
    ctx.addIssue({ code: 'custom', message: 'unrun verification requires a reason and no exit code' })
  }
})

export const RoomDeliverySchema = z.object({
  id: RoomIdSchema,
  taskId: RoomIdSchema,
  attemptId: RoomIdSchema,
  version: z.number().int().positive(),
  baseRevision: RevisionHash,
  versionHash: RevisionHash,
  pinRef: z.string().regex(/^refs\/kun\/rooms\/[A-Za-z0-9/_-]+$/),
  changedFiles: z.array(RelativeFile).max(10000),
  diffArtifactId: z.string().min(1).max(256),
  summary: z.string().min(1).max(16000),
  incomplete: z.array(z.string().max(4000)).max(100),
  verification: z.array(RoomVerificationEvidenceSchema).max(1000),
  createdAt: z.string().datetime({ offset: true })
}).strict()
export type RoomDelivery = z.infer<typeof RoomDeliverySchema>

export const RoomReviewSchema = z.object({
  id: RoomIdSchema,
  taskId: RoomIdSchema,
  deliveryId: RoomIdSchema,
  versionHash: RevisionHash,
  reviewerMemberId: RoomIdSchema,
  verdict: z.enum(['passed', 'changes_requested']),
  findings: z.array(z.object({
    severity: z.enum(['blocking', 'major', 'minor']),
    file: RelativeFile.optional(),
    line: z.number().int().positive().optional(),
    description: z.string().min(1).max(4000)
  }).strict()).max(1000),
  limitations: z.array(z.string().max(4000)).max(100)
}).strict().refine((review) => review.verdict !== 'passed' ||
  !review.findings.some((finding) => finding.severity === 'blocking'),
'blocking findings cannot produce a passing review')
export type RoomReview = z.infer<typeof RoomReviewSchema>
