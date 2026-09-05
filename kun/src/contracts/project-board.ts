import { z } from 'zod'
import { ThreadTodoListSchema } from './threads.js'

export const PROJECT_BOARD_DOCUMENT_VERSION = 1
export const PROJECT_BOARD_MAX_CARDS = 500
export const PROJECT_BOARD_MAX_SUMMARY_WORKSPACES = 32
export const PROJECT_BOARD_MAX_TITLE_CHARS = 300
export const PROJECT_BOARD_MAX_DESCRIPTION_CHARS = 2_000

export const ProjectBoardStatusSchema = z.enum(['pending', 'in_progress', 'completed'])
export type ProjectBoardStatus = z.infer<typeof ProjectBoardStatusSchema>

export const ProjectBoardPrioritySchema = z.enum(['P0', 'P1', 'P2']).nullable()
export type ProjectBoardPriority = z.infer<typeof ProjectBoardPrioritySchema>

export const ProjectBoardCategorySchema = z.enum([
  'feature',
  'bug',
  'refactor',
  'tech_debt',
  'docs',
  'test',
  'api',
  'sync',
  'ui',
  'interaction',
  'chore',
  'other'
])
export type ProjectBoardCategory = z.infer<typeof ProjectBoardCategorySchema>

const ProjectBoardTitleSchema = z.string().trim().min(1).max(PROJECT_BOARD_MAX_TITLE_CHARS)
const ProjectBoardDescriptionSchema = z.string().max(PROJECT_BOARD_MAX_DESCRIPTION_CHARS)

export const ManualProjectBoardCardSchema = z.object({
  id: z.string().min(1),
  title: ProjectBoardTitleSchema,
  description: ProjectBoardDescriptionSchema,
  status: ProjectBoardStatusSchema,
  category: ProjectBoardCategorySchema,
  priority: ProjectBoardPrioritySchema,
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ManualProjectBoardCard = z.infer<typeof ManualProjectBoardCardSchema>

export const ProjectBoardTodoOverlaySchema = z.object({
  threadId: z.string().min(1),
  todoId: z.string().min(1),
  category: ProjectBoardCategorySchema.nullable(),
  priority: ProjectBoardPrioritySchema,
  description: ProjectBoardDescriptionSchema,
  archived: z.boolean(),
  updatedAt: z.string()
}).strict()
export type ProjectBoardTodoOverlay = z.infer<typeof ProjectBoardTodoOverlaySchema>

export const ProjectBoardDocumentV1Schema = z.object({
  version: z.literal(PROJECT_BOARD_DOCUMENT_VERSION),
  workspaceRoot: z.string().min(1),
  revision: z.number().int().nonnegative(),
  manualCards: z.record(z.string(), ManualProjectBoardCardSchema),
  todoOverlays: z.record(z.string(), ProjectBoardTodoOverlaySchema),
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ProjectBoardDocumentV1 = z.infer<typeof ProjectBoardDocumentV1Schema>

export const ProjectBoardCardSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['manual', 'thread_todo']),
  workspaceRoot: z.string().min(1),
  title: z.string(),
  description: z.string(),
  status: ProjectBoardStatusSchema,
  category: z.union([ProjectBoardCategorySchema, z.literal('plan')]),
  priority: ProjectBoardPrioritySchema,
  archived: z.boolean(),
  updatedAt: z.string(),
  source: z.object({
    label: z.enum(['Manual', 'Plan']),
    threadId: z.string().optional(),
    todoId: z.string().optional(),
    threadTitle: z.string().optional(),
    planId: z.string().optional(),
    planRelativePath: z.string().optional(),
    sectionTitle: z.string().optional(),
    ordinal: z.number().int().nonnegative().optional()
  }).strict()
}).strict()
export type ProjectBoardCard = z.infer<typeof ProjectBoardCardSchema>

export const ProjectBoardCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
}).strict()
export type ProjectBoardCounts = z.infer<typeof ProjectBoardCountsSchema>

export const PatchProjectBoardCardStatusesRequestSchema = z.object({
  workspace: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative(),
  cardIds: z.array(z.string().trim().min(1)).min(1).max(PROJECT_BOARD_MAX_CARDS),
  fromStatus: ProjectBoardStatusSchema,
  status: ProjectBoardStatusSchema
}).strict().superRefine((value, ctx) => {
  if (new Set(value.cardIds).size !== value.cardIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cardIds'],
      message: 'cardIds must be unique'
    })
  }
})
export type PatchProjectBoardCardStatusesRequest = z.infer<
  typeof PatchProjectBoardCardStatusesRequestSchema
>

export const ProjectBoardStatusDeltaSchema = z.object({
  id: z.string().min(1),
  status: ProjectBoardStatusSchema,
  updatedAt: z.string()
}).strict()
export type ProjectBoardStatusDelta = z.infer<typeof ProjectBoardStatusDeltaSchema>

export const ProjectBoardBulkStatusFailureSchema = z.object({
  cardId: z.string().min(1),
  code: z.enum(['write_failed', 'source_missing', 'stale_status', 'skipped']),
  message: z.string().min(1)
}).strict()
export type ProjectBoardBulkStatusFailure = z.infer<
  typeof ProjectBoardBulkStatusFailureSchema
>

export const ProjectBoardBulkStatusResponseSchema = z.object({
  workspaceRoot: z.string().min(1),
  revision: z.number().int().nonnegative(),
  counts: ProjectBoardCountsSchema,
  updatedCards: z.array(ProjectBoardStatusDeltaSchema).max(PROJECT_BOARD_MAX_CARDS * 2),
  failures: z.array(ProjectBoardBulkStatusFailureSchema).max(PROJECT_BOARD_MAX_CARDS)
}).strict()
export type ProjectBoardBulkStatusResponse = z.infer<
  typeof ProjectBoardBulkStatusResponseSchema
>

export const ProjectBoardSnapshotResponseSchema = z.object({
  workspaceRoot: z.string().min(1),
  revision: z.number().int().nonnegative(),
  cards: z.array(ProjectBoardCardSchema).max(PROJECT_BOARD_MAX_CARDS),
  counts: ProjectBoardCountsSchema,
  truncated: z.boolean(),
  nextCursor: z.string().optional(),
  warning: z.string().optional()
}).strict()
export type ProjectBoardSnapshotResponse = z.infer<typeof ProjectBoardSnapshotResponseSchema>

export const ProjectBoardSummarySchema = z.object({
  workspaceRoot: z.string().min(1),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  progress: z.number().min(0).max(1),
  updatedAt: z.string().nullable()
}).strict()
export type ProjectBoardSummary = z.infer<typeof ProjectBoardSummarySchema>

export const ProjectBoardSummariesRequestSchema = z.object({
  workspaces: z.array(z.string().trim().min(1)).max(PROJECT_BOARD_MAX_SUMMARY_WORKSPACES)
}).strict()
export type ProjectBoardSummariesRequest = z.infer<typeof ProjectBoardSummariesRequestSchema>

export const ProjectBoardSummariesResponseSchema = z.object({
  summaries: z.array(ProjectBoardSummarySchema)
}).strict()

const BoardMutationBaseSchema = z.object({
  workspace: z.string().trim().min(1),
  expectedRevision: z.number().int().nonnegative()
})

export const CreateManualProjectBoardCardRequestSchema = BoardMutationBaseSchema.extend({
  title: ProjectBoardTitleSchema,
  description: ProjectBoardDescriptionSchema.optional().default(''),
  status: ProjectBoardStatusSchema,
  category: ProjectBoardCategorySchema.optional().default('other'),
  priority: ProjectBoardPrioritySchema.optional().default(null)
}).strict()
export type CreateManualProjectBoardCardRequest = z.infer<typeof CreateManualProjectBoardCardRequestSchema>

export const PatchManualProjectBoardCardRequestSchema = BoardMutationBaseSchema.extend({
  title: ProjectBoardTitleSchema.optional(),
  description: ProjectBoardDescriptionSchema.optional(),
  status: ProjectBoardStatusSchema.optional(),
  category: ProjectBoardCategorySchema.optional(),
  priority: ProjectBoardPrioritySchema.optional(),
  archived: z.boolean().optional()
}).strict().refine((value) => [
  value.title,
  value.description,
  value.status,
  value.category,
  value.priority,
  value.archived
].some((field) => field !== undefined), { message: 'card patch must change at least one field' })
export type PatchManualProjectBoardCardRequest = z.infer<typeof PatchManualProjectBoardCardRequestSchema>

export const DeleteManualProjectBoardCardRequestSchema = BoardMutationBaseSchema.strict()
export type DeleteManualProjectBoardCardRequest = z.infer<typeof DeleteManualProjectBoardCardRequestSchema>

export const PatchProjectBoardTodoOverlayRequestSchema = BoardMutationBaseSchema.extend({
  category: ProjectBoardCategorySchema.nullable().optional(),
  priority: ProjectBoardPrioritySchema.optional(),
  description: ProjectBoardDescriptionSchema.optional(),
  archived: z.boolean().optional()
}).strict().refine((value) => [
  value.category,
  value.priority,
  value.description,
  value.archived
].some((field) => field !== undefined), { message: 'todo overlay patch must change at least one field' })
export type PatchProjectBoardTodoOverlayRequest = z.infer<typeof PatchProjectBoardTodoOverlayRequestSchema>

export const ProjectBoardMutationResponseSchema = ProjectBoardSnapshotResponseSchema

export const PatchThreadTodoRequestSchema = z.object({
  status: ProjectBoardStatusSchema
}).strict()
export type PatchThreadTodoRequest = z.infer<typeof PatchThreadTodoRequestSchema>

export const PatchThreadTodoResponseSchema = z.object({
  todos: ThreadTodoListSchema,
  card: ProjectBoardCardSchema.optional()
}).strict()
