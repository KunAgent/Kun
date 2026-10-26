import { z } from 'zod'

const kunGraphSchedulerPatchSchema = z.object({
  maxNodes: z.number().int().positive().max(10_000).optional(),
  maxEdges: z.number().int().positive().max(50_000).optional(),
  maxConcurrentRuns: z.number().int().positive().max(256).optional(),
  maxConcurrentNodes: z.number().int().positive().max(256).optional(),
  maxConcurrentNodesPerRun: z.number().int().positive().max(256).optional(),
  maxAttemptsPerNode: z.number().int().positive().max(20).optional(),
  maxRevisions: z.number().int().positive().max(1_000).optional(),
  maxLoopIterations: z.number().int().nonnegative().max(1_000).optional(),
  maxRunWallTimeMs: z.number().int().positive().max(30 * 86_400_000).optional(),
  maxNodeWallTimeMs: z.number().int().positive().max(86_400_000).optional(),
  maxTotalTokens: z.number().int().positive().max(1_000_000_000).optional(),
  maxArtifactBytes: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  budgetWarningRatio: z.number().min(0).max(1).optional()
}).strict().transform((scheduler) => {
  const { maxTotalTokens, ...activeSettings } = scheduler
  void maxTotalTokens
  return activeSettings
})

export const kunGraphPatchSchema = z.object({
  enabled: z.boolean().optional(),
  defaultStrategy: z.enum(['direct', 'graph']).optional(),
  rolloutStage: z.enum([
    'experimental',
    'alpha',
    'beta',
    'learning-preview',
    'stable'
  ]).optional(),
  workerModel: z.object({
    mode: z.enum(['inherit', 'fixed']).optional(),
    providerId: z.string().trim().max(128).optional(),
    model: z.string().trim().max(256).optional(),
    reasoningEffort: z.enum(['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max']).optional()
  }).strict().optional(),
  scheduler: kunGraphSchedulerPatchSchema.optional(),
  context: z.object({
    maxWorkerContextBytes: z.number().int().positive().max(16 * 1024 * 1024).optional(),
    maxDependencySummaryBytes: z.number().int().positive().max(1024 * 1024).optional(),
    maxInputArtifacts: z.number().int().positive().max(1_000).optional(),
    maxInputMessages: z.number().int().positive().max(1_000).optional(),
    maxInlineEventBytes: z.number().int().positive().max(1024 * 1024).optional()
  }).strict().optional(),
  mailbox: z.object({
    maxMessagesPerNode: z.number().int().nonnegative().max(100_000).optional(),
    maxMessagesPerRun: z.number().int().nonnegative().max(1_000_000).optional(),
    maxMessageBytes: z.number().int().positive().max(1024 * 1024).optional(),
    maxArtifactRefsPerMessage: z.number().int().nonnegative().max(1_000).optional(),
    maxMessagesPerMinute: z.number().int().nonnegative().max(10_000).optional(),
    defaultTtlMs: z.number().int().positive().max(30 * 86_400_000).optional(),
    blockingReplyTimeoutMs: z.number().int().positive().max(30 * 86_400_000).optional()
  }).strict().optional(),
  supervision: z.object({
    enabled: z.boolean().optional(),
    autoStart: z.boolean().optional(),
    coalesceWindowMs: z.number().int().nonnegative().max(60_000).optional(),
    stallTimeoutMs: z.number().int().positive().max(86_400_000).optional(),
    repeatedFailureThreshold: z.number().int().min(2).max(20).optional(),
    requireFinalReview: z.boolean().optional(),
    requireHumanForCriticalRisk: z.boolean().optional()
  }).strict().optional(),
  writeIsolation: z.object({
    mode: z.enum(['serialize', 'lease', 'worktree']).optional(),
    allowWorktrees: z.boolean().optional(),
    leaseTtlMs: z.number().int().positive().max(86_400_000).optional(),
    preserveFailedWorktrees: z.boolean().optional()
  }).strict().optional(),
  routing: z.object({
    recallLimit: z.number().int().positive().max(100).optional(),
    minTaskFit: z.number().min(0).max(1).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    explorationRatio: z.number().min(0).max(1).optional(),
    dormantMissedOpportunityThreshold: z.number().int().positive().max(10_000).optional()
  }).strict().optional(),
  learning: z.object({
    mode: z.enum(['off', 'suggest', 'auto_candidate']).optional(),
    minimumDistinctSessions: z.number().int().min(2).max(1_000).optional(),
    minimumVerifiedEpisodes: z.number().int().min(2).max(10_000).optional(),
    consolidationIntervalMs: z.number().int().positive()
      .max(365 * 86_400_000).optional(),
    maxEpisodesPerJob: z.number().int().positive().max(100_000).optional(),
    probationMinimumRuns: z.number().int().positive().max(1_000).optional(),
    allowReadOnlyExploration: z.boolean().optional()
  }).strict().optional(),
  retention: z.object({
    graphDays: z.number().int().positive().max(3_650).optional(),
    artifactDays: z.number().int().positive().max(3_650).optional(),
    episodeDays: z.number().int().positive().max(3_650).optional(),
    auditDays: z.number().int().positive().max(36_500).optional(),
    snapshotEveryEvents: z.number().int().positive().max(100_000).optional(),
    compactAfterEvents: z.number().int().positive().max(10_000_000).optional()
  }).strict().optional()
}).strict()
