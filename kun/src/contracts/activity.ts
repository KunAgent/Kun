import { z } from 'zod'
import { HarnessIdSchema } from './harness.js'

/**
 * One Activity row tracks a single execution unit: a conversation thread,
 * a manager-dispatched worker, a side chat, a graph attempt, or a
 * tier-0 terminal agent. See docs/ade/06-activity-store.md.
 */
export const ExecutionUnitKindSchema = z.enum([
  'thread',
  'worker',
  'side-chat',
  'graph-attempt',
  'terminal-agent'
])
export type ExecutionUnitKind = z.infer<typeof ExecutionUnitKindSchema>

export const ActivityStateSchema = z.enum([
  'initializing',
  'working',
  'waiting',
  'done',
  'failed',
  'idle',
  'closed'
])
export type ActivityState = z.infer<typeof ActivityStateSchema>

export const ActivityWaitingReasonSchema = z.enum([
  'approval',
  'user_input',
  'question',
  'terminal_prompt'
])
export type ActivityWaitingReason = z.infer<typeof ActivityWaitingReasonSchema>

/** Who produced a row write; authority rules live in the ActivityStore. */
export const ActivityProvenanceSchema = z.enum([
  'runtime',
  'callback',
  'hook',
  'inferred',
  'restored'
])
export type ActivityProvenance = z.infer<typeof ActivityProvenanceSchema>

export const ActivityChildrenSchema = z
  .object({
    working: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  })
  .strict()
export type ActivityChildren = z.infer<typeof ActivityChildrenSchema>

export const ActivityWorkspaceSchema = z
  .object({
    path: z.string().max(4_096),
    kind: z.enum(['worktree', 'local', 'directory']),
    branch: z.string().max(256).optional()
  })
  .strict()
export type ActivityWorkspace = z.infer<typeof ActivityWorkspaceSchema>

export const ActivityRowSchema = z
  .object({
    unitId: z.string().min(1).max(128),
    kind: ExecutionUnitKindSchema,
    threadId: z.string().min(1),
    /** Rooms owns its private publication/attention notification delivery. */
    roomId: z.string().min(1).optional(),
    metadataPending: z.boolean().optional(),
    /** Parent thread for worker / side-chat / graph-attempt units. */
    parentThreadId: z.string().optional(),
    teamId: z.string().optional(),
    harnessId: HarnessIdSchema,
    title: z.string().max(200),
    workspace: ActivityWorkspaceSchema,
    /** User-facing state after folding child units in; store-computed. */
    state: ActivityStateSchema,
    waitingReason: ActivityWaitingReasonSchema.optional(),
    /** The unit's own state, without children; managers key on this. */
    mainState: ActivityStateSchema,
    /** Result of the most recent finish; only set for done / idle rows. */
    lastOutcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
    children: ActivityChildrenSchema,
    phase: z
      .enum(['investigating', 'implementing', 'verifying', 'blocked', 'compacting'])
      .optional(),
    progressNote: z.string().max(280).optional(),
    currentTool: z.string().max(128).optional(),
    lastMessagePreview: z.string().max(200).optional(),
    turnId: z.string().optional(),
    stateSince: z.string().datetime(),
    updatedAt: z.string().datetime(),
    provenance: ActivityProvenanceSchema,
    /**
     * Row recovered from persistence after a restart that the runtime has
     * not confirmed yet; never treated as live truth.
     */
    restoredUnconfirmed: z.boolean().default(false),
    stalled: z.boolean().default(false),
    visibility: z.enum(['active', 'archived']),
    residency: z.enum(['live', 'dormant']),
    /** User facts shared across clients. */
    acknowledgedAt: z.string().datetime().optional(),
    dismissedAt: z.string().datetime().optional(),
    pinned: z.boolean().default(false)
  })
  .strict()
export type ActivityRow = z.infer<typeof ActivityRowSchema>

/**
 * Partial row write. `state`, `children`, `unitId`, `kind`, and `threadId`
 * are store-owned and cannot be patched; `state` is always recomputed by
 * the rollup rule. Explicit `undefined` values clear optional fields.
 */
export const ActivityPatchSchema = ActivityRowSchema.omit({
  unitId: true,
  kind: true,
  threadId: true,
  state: true,
  children: true
}).partial()
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>

export const RegisterUnitSchema = z
  .object({
    unitId: z.string().min(1).max(128),
    kind: ExecutionUnitKindSchema,
    threadId: z.string().min(1),
    /** Rooms owns its private publication/attention notification delivery. */
    roomId: z.string().min(1).optional(),
    metadataPending: z.boolean().optional(),
    parentThreadId: z.string().optional(),
    teamId: z.string().optional(),
    harnessId: HarnessIdSchema,
    title: z.string().max(200),
    workspace: ActivityWorkspaceSchema,
    mainState: ActivityStateSchema.optional(),
    lastOutcome: z.enum(['completed', 'failed', 'cancelled']).optional(),
    waitingReason: ActivityWaitingReasonSchema.optional(),
    turnId: z.string().optional(),
    provenance: ActivityProvenanceSchema.optional(),
    restoredUnconfirmed: z.boolean().optional(),
    visibility: z.enum(['active', 'archived']).optional(),
    residency: z.enum(['live', 'dormant']).optional(),
    acknowledgedAt: z.string().datetime().optional(),
    dismissedAt: z.string().datetime().optional(),
    pinned: z.boolean().optional()
  })
  .strict()
export type RegisterUnit = z.infer<typeof RegisterUnitSchema>

export const ActivityChangeSchema = z
  .object({
    unitId: z.string().min(1),
    removed: z.boolean().optional(),
    row: ActivityRowSchema.optional()
  })
  .strict()
export type ActivityChange = z.infer<typeof ActivityChangeSchema>

export const ActivityBatchSchema = z
  .object({
    cursor: z.string().min(1),
    changes: z.array(ActivityChangeSchema)
  })
  .strict()
export type ActivityBatch = z.infer<typeof ActivityBatchSchema>

export const ActivitySnapshotSchema = z
  .object({
    cursor: z.string().min(1),
    rows: z.array(ActivityRowSchema)
  })
  .strict()
export type ActivitySnapshot = z.infer<typeof ActivitySnapshotSchema>
