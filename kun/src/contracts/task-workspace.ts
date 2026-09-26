import { z } from 'zod'

/** Host-managed task workspaces (docs/ade/07 §4). */

export const TaskWorkspaceIsolationSchema = z.enum([
  'worktree',     // host-created git worktree (default)
  'local',        // the user's own checkout (one-to-one default; workers need opt-in)
  'directory'     // non-git directory, no isolation
])
export type TaskWorkspaceIsolation = z.infer<typeof TaskWorkspaceIsolationSchema>

export const StartFromSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('default-branch') }).strict(),                 // repo default branch (origin/HEAD first, local fallback)
  z.object({ kind: z.literal('current-head') }).strict(),
  z.object({ kind: z.literal('branch'), name: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('commit'), sha: z.string().regex(/^[a-f0-9]{7,64}$/) }).strict(),
  z.object({ kind: z.literal('remote-branch'), remote: z.string().max(128), name: z.string().max(256) }).strict(),
  z.object({ kind: z.literal('change-request'), number: z.number().int().positive() }).strict()   // P2
])
export type StartFrom = z.infer<typeof StartFromSchema>

export const TaskWorkspaceStateSchema = z.enum([
  'creating', 'setting-up', 'ready', 'failed',
  'captured', 'integrated', 'conflict', 'preserved', 'removed', 'orphaned'
])
export type TaskWorkspaceState = z.infer<typeof TaskWorkspaceStateSchema>

export const TaskWorkspaceProgressSchema = z.object({
  step: z.enum(['resolve', 'fetch', 'worktree', 'share', 'copy', 'setup']),
  message: z.string().max(256)
}).strict()
export type TaskWorkspaceProgress = z.infer<typeof TaskWorkspaceProgressSchema>

export const TaskWorkspaceSetupSchema = z.object({
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'not-approved']),
  logArtifactId: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional()
}).strict()
export type TaskWorkspaceSetup = z.infer<typeof TaskWorkspaceSetupSchema>

/** Result of sharing/copying ignored paths into a new worktree (07 §6). */
export const TaskWorkspaceEnvironmentFillSchema = z.object({
  shared: z.array(z.string().max(4_096)).max(256).default([]),
  copied: z.array(z.string().max(4_096)).max(256).default([]),
  skipped: z
    .array(z.object({
      path: z.string().max(4_096),
      reason: z.string().max(64)
    }).strict())
    .max(256)
    .default([]),
  warnings: z.array(z.string().max(256)).max(64).default([])
}).strict()
export type TaskWorkspaceEnvironmentFill = z.infer<typeof TaskWorkspaceEnvironmentFillSchema>

export const TaskWorkspaceRecordSchema = z.object({
  workspaceId: z.string().regex(/^tws_[a-z0-9]{8,32}$/),
  ownerThreadId: z.string().min(1),          // initiator: manager thread, one-to-one thread, or Graph thread
  unitId: z.string().optional(),             // bound execution unit (docs/ade/06)
  label: z.string().max(120).optional(),
  isolation: TaskWorkspaceIsolationSchema,
  sourceRoot: z.string().max(4_096),         // project directory the user picked
  repositoryRoot: z.string().max(4_096).optional(),
  path: z.string().max(4_096),               // cwd the execution unit actually uses
  startFrom: StartFromSchema,
  baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  branch: z.string().max(256).optional(),
  /** Local branch merge-branch integration targets (none for detached starts). */
  targetBranch: z.string().max(256).optional(),
  headRevision: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
  state: TaskWorkspaceStateSchema,
  progress: TaskWorkspaceProgressSchema.optional(),
  setup: TaskWorkspaceSetupSchema,
  environmentFill: TaskWorkspaceEnvironmentFillSchema.optional(),
  changedFiles: z.array(z.string().max(4_096)).max(10_000).default([]),
  patchArtifactId: z.string().optional(),
  lastError: z.string().max(2_048).optional(),
  /** User-facing recovery steps set alongside lastError on conflicts. */
  recovery: z.array(z.string().max(512)).max(8).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict()
export type TaskWorkspaceRecord = z.infer<typeof TaskWorkspaceRecordSchema>

/** POST /v1/task-workspaces request body. */
export const CreateTaskWorkspaceRequestSchema = z.object({
  ownerThreadId: z.string().min(1).max(128),
  unitId: z.string().min(1).max(128).optional(),
  label: z.string().min(1).max(120).optional(),
  sourceRoot: z.string().min(1).max(4_096),
  isolation: TaskWorkspaceIsolationSchema.default('worktree'),
  startFrom: StartFromSchema.default({ kind: 'default-branch' })
}).strict()
export type CreateTaskWorkspaceRequest = z.infer<typeof CreateTaskWorkspaceRequestSchema>

/** POST /v1/task-workspaces/:id/integrate request body. */
export const IntegrateTaskWorkspaceRequestSchema = z.object({
  mode: z.enum(['apply-patch', 'merge-branch']).default('apply-patch')
}).strict()
export type IntegrateTaskWorkspaceRequest = z.infer<typeof IntegrateTaskWorkspaceRequestSchema>

/** POST /v1/task-workspaces/:id/discard request body. */
export const DiscardTaskWorkspaceRequestSchema = z.object({
  confirm: z.literal(true).optional()
}).strict()
export type DiscardTaskWorkspaceRequest = z.infer<typeof DiscardTaskWorkspaceRequestSchema>

export const TaskWorkspaceIntegrateOutcomeSchema = z.enum([
  'applied', 'merged', 'needs_human', 'conflict'
])
export type TaskWorkspaceIntegrateOutcome = z.infer<typeof TaskWorkspaceIntegrateOutcomeSchema>

/** Preview returned with HTTP 409 when discard lacks `confirm: true`. */
export const TaskWorkspaceDiscardPreviewSchema = z.object({
  uncommittedFiles: z.number().int().nonnegative(),
  unpushedCommits: z.number().int().nonnegative()
}).strict()
export type TaskWorkspaceDiscardPreview = z.infer<typeof TaskWorkspaceDiscardPreviewSchema>

export type PreservedBranchInfo = {
  branch: string
  lastCommit: string
  aheadBy: number
}

/**
 * Runtime event emitted on every progress/state transition, attached to
 * `threadId = ownerThreadId` so the ActivityStore can refresh the row's
 * workspace fields (docs/ade/07 §5, docs/ade/06 §4.2).
 */
export const TaskWorkspaceEventPayloadSchema = z.object({
  workspaceId: z.string().min(1).max(128),
  unitId: z.string().min(1).max(128).optional(),
  state: TaskWorkspaceStateSchema,
  progress: TaskWorkspaceProgressSchema.optional(),
  setup: TaskWorkspaceSetupSchema.optional(),
  workspace: z.object({
    path: z.string().max(4_096),
    sourceRoot: z.string().max(4_096).optional(),
    kind: TaskWorkspaceIsolationSchema,
    branch: z.string().max(256).optional()
  }).strict().optional()
}).strict()
export type TaskWorkspaceEventPayload = z.infer<typeof TaskWorkspaceEventPayloadSchema>

/** `<prefix><slug>-<workspaceId tail>`; non-ASCII labels collapse to `task`. */
export function taskBranchName(prefix: string, label: string, workspaceId: string): string {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task'
  return `${prefix}${slug}-${workspaceId.slice(-6)}`
}
