import { z } from 'zod'

/**
 * EXT-SEAM: Collaboration domain contracts (Expert Team orchestration).
 *
 * A CollaborationPlan defines a multi-agent workflow where tasks are assigned
 * to different experts, with dependency tracking, concurrency limits, and
 * clarification/termination support.
 */

export const CollaborationTaskStatusSchema = z.enum([
  'pending',      // Waiting for dependencies or assignment
  'assigned',     // Assigned to an expert but not started
  'in_progress',  // Currently being executed
  'paused',
  'interrupted',
  'retrying',
  'clarification_needed', // Blocked waiting for user input
  'completed',    // Successfully finished
  'failed',       // Failed and cannot continue
  'cancelled'     // Manually cancelled
])

export type CollaborationTaskStatus = z.infer<typeof CollaborationTaskStatusSchema>

export const CollaborationTaskAttemptSchema = z.object({
  attempt: z.number().int().positive(),
  threadId: z.string(),
  turnId: z.string(),
  status: CollaborationTaskStatusSchema,
  startedAt: z.string().optional(),
  endedAt: z.string()
})

export type CollaborationTaskAttempt = z.infer<typeof CollaborationTaskAttemptSchema>

export const CollaborationTaskSchema = z.object({
  id: z.string(),
  planId: z.string(),
  title: z.string(),
  description: z.string(),
  assignedExpertId: z.string().optional(), // Expert to execute this task
  status: CollaborationTaskStatusSchema,
  dependencies: z.array(z.string()).default([]), // Task IDs that must complete first
  blockedBy: z.array(z.string()).default([]),    // Computed: tasks blocking this one
  priority: z.number().int().min(0).max(10).default(5),
  threadId: z.string().optional(),    // Kun thread ID if task started
  turnId: z.string().optional(),      // Current turn ID
  attempt: z.number().int().nonnegative().default(0),
  previousAttempts: z.array(CollaborationTaskAttemptSchema).default([]),
  dependencyRevision: z.number().int().nonnegative().default(0),
  lastEventSeq: z.number().int().nonnegative().optional(),
  checkpoint: z.string().optional(),
  result: z.string().optional(),      // Task output/result
  clarificationPrompt: z.string().optional(), // User question if clarification_needed
  clarificationResponse: z.string().optional(), // User's answer
  error: z.string().optional(),       // Error message if failed
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
})

export type CollaborationTask = z.infer<typeof CollaborationTaskSchema>

export const CollaborationPlanStatusSchema = z.enum([
  'draft',        // Plan created but not confirmed
  'confirmed',    // Plan validated and ready to execute
  'in_progress',  // Tasks are being executed
  'completed',    // All tasks finished successfully
  'failed',       // Plan failed (critical task failed)
  'cancelled'     // Manually cancelled
])

export type CollaborationPlanStatus = z.infer<typeof CollaborationPlanStatusSchema>

export const CollaborationLimitsSchema = z.object({
  maxConcurrentTasks: z.number().int().min(1).max(10).default(3),
  maxTotalTasks: z.number().int().min(1).max(100).default(50),
  taskTimeoutSeconds: z.number().int().min(60).max(3600).default(600),
  clarificationTimeoutSeconds: z.number().int().min(30).max(1800).default(300)
})

export type CollaborationLimits = z.infer<typeof CollaborationLimitsSchema>

export const CollaborationPlanSchema = z.object({
  id: z.string(),
  expertTeamId: z.string(), // ExpertTeam that owns this plan
  title: z.string(),
  description: z.string(),
  status: CollaborationPlanStatusSchema,
  tasks: z.array(CollaborationTaskSchema).default([]),
  limits: CollaborationLimitsSchema.default({
    maxConcurrentTasks: 3,
    maxTotalTasks: 50,
    taskTimeoutSeconds: 600,
    clarificationTimeoutSeconds: 300
  }),
  createdAt: z.string(),
  confirmedAt: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
})

export type CollaborationPlan = z.infer<typeof CollaborationPlanSchema>

// Request/Response types for API

export const CreateCollaborationPlanSchema = z.object({
  expertTeamId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  tasks: z.array(z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000),
    assignedExpertId: z.string().optional(),
    dependencies: z.array(z.string()).default([]),
    priority: z.number().int().min(0).max(10).default(5)
  })).min(1).max(100),
  limits: CollaborationLimitsSchema.optional()
})

export type CreateCollaborationPlan = z.infer<typeof CreateCollaborationPlanSchema>

export const ConfirmCollaborationPlanSchema = z.object({
  planId: z.string()
})

export const CancelCollaborationPlanSchema = z.object({
  planId: z.string(),
  reason: z.string().optional()
})

export const AnswerClarificationSchema = z.object({
  taskId: z.string(),
  answer: z.string().min(1).max(5000)
})

export const CollaborationStateSchema = z.object({
  planId: z.string(),
  status: CollaborationPlanStatusSchema,
  totalTasks: z.number(),
  completedTasks: z.number(),
  failedTasks: z.number(),
  pendingTasks: z.number(),
  inProgressTasks: z.number(),
  clarificationNeededTasks: z.number(),
  pausedTasks: z.number(),
  interruptedTasks: z.number(),
  runningTaskIds: z.array(z.string()),
  blockedTaskIds: z.array(z.string()),
  nextTaskIds: z.array(z.string()) // Tasks ready to start
})

export type CollaborationState = z.infer<typeof CollaborationStateSchema>
