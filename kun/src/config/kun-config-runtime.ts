import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { GeminiCodeAssistCredential } from '../contracts/gemini-code-assist.js'
import {
  ApprovalReviewerSchema,
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_REVIEWER,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  AttachmentsCapabilityConfig,
  ComputerUseCapabilityConfig,
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  ImageGenCapabilityConfig,
  InstructionsCapabilityConfig,
  KunCapabilitiesConfig,
  McpCapabilityConfig,
  MemoryCapabilityConfig,
  ModelCapabilityMetadata,
  ModelInputModality,
  ModelMessagePartSupport,
  ModelReasoningCapabilityMetadata,
  ModelReasoningEffort,
  MusicGenCapabilityConfig,
  SkillsCapabilityConfig,
  SpeechGenCapabilityConfig,
  SubagentsCapabilityConfig,
  VideoGenCapabilityConfig,
  WebCapabilityConfig
} from '../contracts/capabilities.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '../contracts/model-endpoint-format.js'
import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES
} from '../contracts/tool-output-limits.js'
import { HooksConfigSchema } from '../hooks/hook-config.js'
import { LocalModelGatewayConfigSchema, ModelRoutePoolConfigSchema } from '../contracts/model-route-pool.js'

export const KUN_CONFIG_FILENAME = 'config.json'
export const DEFAULT_KUN_MODEL = 'deepseek-v4-pro'

export const PositiveInt = z.number().int().positive()
export const PositiveRatio = z.number().positive().max(1)
export const HttpUrl = z.string().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}, { message: 'URL must use http or https' })

export const DEFAULT_MODEL_REQUEST_RETRY_CONFIG = {
  // Retries are counted after the initial provider request.
  maxAttempts: 5,
  initialDelayMs: 3_000,
  httpStatusCodes: [429, 500, 502, 503, 504]
} as const

export const ModelRequestRetryConfigSchema = z
  .object({
    maxAttempts: z.number().int().min(0).max(10).default(DEFAULT_MODEL_REQUEST_RETRY_CONFIG.maxAttempts).optional(),
    initialDelayMs: z.number().int().min(0).max(600_000).default(DEFAULT_MODEL_REQUEST_RETRY_CONFIG.initialDelayMs).optional(),
    httpStatusCodes: z.array(z.number().int().min(400).max(599)).max(64).default([...DEFAULT_MODEL_REQUEST_RETRY_CONFIG.httpStatusCodes]).optional(),
    // Desktop settings use this marker for one-time default migrations. The
    // request policy deliberately ignores it after strict config validation.
    defaultsVersion: z.number().int().min(0).max(1_000).optional()
  })
  .strict()
export type ModelRequestRetryConfig = z.infer<typeof ModelRequestRetryConfigSchema>

export const ModelContextCompactionProfileConfigSchema = z
  .object({
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      profile.softThreshold !== undefined &&
      profile.hardThreshold !== undefined &&
      profile.hardThreshold < profile.softThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelContextProfileConfigSchema = z
  .object({
    aliases: z.array(z.string().min(1)).optional(),
    contextWindowTokens: PositiveInt.optional(),
    maxOutputTokens: PositiveInt.optional(),
    contextCompaction: ModelContextCompactionProfileConfigSchema.optional(),
    softRatio: PositiveRatio.optional(),
    hardRatio: PositiveRatio.optional(),
    softThreshold: PositiveInt.optional(),
    hardThreshold: PositiveInt.optional(),
    inputModalities: z.array(ModelInputModality).optional(),
    outputModalities: z.array(ModelInputModality).optional(),
    supportsToolCalling: z.boolean().optional(),
    messageParts: z.array(ModelMessagePartSupport).optional(),
    reasoning: ModelReasoningCapabilityMetadata.optional(),
    serviceTiers: z.array(z.enum(['priority', 'flex'])).min(1).optional(),
    // Per-model wire-format override. Omitted means "inherit the
    // provider/runtime endpointFormat"; no default coercion here, otherwise
    // every model would be pinned to chat_completions.
    endpointFormat: z
      .preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS))
      .optional(),
    responsesMode: z.literal('lite').optional()
  })
  .strict()
  .superRefine((profile, ctx) => {
    const hasRatio =
      profile.softRatio !== undefined ||
      profile.hardRatio !== undefined ||
      profile.contextCompaction?.softRatio !== undefined ||
      profile.contextCompaction?.hardRatio !== undefined
    if (hasRatio && profile.contextWindowTokens === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'softRatio and hardRatio require contextWindowTokens'
      })
    }
    const softThreshold = profile.contextCompaction?.softThreshold ?? profile.softThreshold
    const hardThreshold = profile.contextCompaction?.hardThreshold ?? profile.hardThreshold
    if (softThreshold !== undefined && hardThreshold !== undefined && hardThreshold < softThreshold) {
      ctx.addIssue({
        code: 'custom',
        message: 'hardThreshold must be greater than or equal to softThreshold'
      })
    }
  })

export const ModelConfigSchema = z
  .object({
    profiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()

export const ContextCompactionConfigSchema = z
  .object({
    defaultSoftThreshold: PositiveInt.optional(),
    defaultHardThreshold: PositiveInt.optional(),
    summaryMode: z.enum(['heuristic', 'model']).optional(),
    summaryTimeoutMs: PositiveInt.optional(),
    summaryMaxTokens: PositiveInt.optional(),
    summaryInputMaxBytes: PositiveInt.optional(),
    summaryModel: z.string().min(1).optional(),
    summaryProviderId: z.string().min(1).optional(),
    modelProfiles: z.record(z.string().min(1), ModelContextProfileConfigSchema).optional()
  })
  .strict()
  .superRefine((config, ctx) => {
    if (
      config.defaultSoftThreshold !== undefined &&
      config.defaultHardThreshold !== undefined &&
      config.defaultHardThreshold < config.defaultSoftThreshold
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultHardThreshold must be greater than or equal to defaultSoftThreshold'
      })
    }
  })

export const RuntimeTuningConfigSchema = z
  .object({
    // Max idle gap (ms) between streaming chunks before a turn fails with
    // `stream_idle_timeout`. Local LLM servers prefilling a huge prompt can
    // stay silent well past the 45s default; `0` disables the guard entirely.
    streamIdleTimeoutMs: z.number().int().min(0).optional(),
    toolStorm: z
      .object({
        enabled: z.boolean().optional()
      })
      .strict()
      .optional(),
    /**
     * Auto-resume ordinary threads (no active goal) whose turn was
     * interrupted by a runtime restart or host shutdown. Defaults to enabled;
     * set `enabled: false` to require the user to manually ask the agent to
     * continue.
     */
    interruptedTurnResume: z
      .object({
        enabled: z.boolean().optional()
      })
      .strict()
      .optional(),
    /**
     * kun serve memory-pressure monitor. Level 1 (warnRssBytes) folds idle
     * thread histories via automatic compaction; level 2 (criticalRssBytes)
     * requests a graceful shutdown so running turns are suspended and resumed
     * after restart instead of being hard-killed by OOM.
     */
    memoryPressure: z
      .object({
        enabled: z.boolean().optional(),
        pollIntervalMs: PositiveInt.max(3_600_000).optional(),
        warnRssBytes: z.number().int().positive().max(2 ** 53).optional(),
        criticalRssBytes: z.number().int().positive().max(2 ** 53).optional(),
        maxCompactionsPerSweep: PositiveInt.max(64).optional()
      })
      .strict()
      .optional(),
    /** Hard runtime bounds for native and delegated Agent SDK turns. */
    turnLimits: z
      .object({
        maxSteps: PositiveInt.max(1_000).optional(),
        maxWallTimeMs: PositiveInt.max(86_400_000).optional(),
        maxToolCallsPerStep: PositiveInt.max(10_000).optional(),
        /** Global in-process admission cap for concurrently active turns. */
        maxConcurrentTurns: PositiveInt.max(256).optional()
      })
      .strict()
      .optional(),
    /** Sensitive local Agent Perspective capture; explicitly set false to disable. */
    llmDebug: z
      .object({
        enabled: z.boolean().default(true),
        defaultThreadCaptureEnabled: z.boolean().optional()
      })
      .strict()
      .optional(),
    toolArgumentRepair: z
      .object({
        maxStringBytes: PositiveInt.optional()
      })
      .strict()
      .optional()
  })
  .strict()

export const GraphSchedulerRuntimeConfigSchema = z.object({
  maxNodes: PositiveInt.max(10_000).default(128),
  maxEdges: PositiveInt.max(50_000).default(512),
  maxConcurrentRuns: PositiveInt.max(256).default(4),
  maxConcurrentNodes: PositiveInt.max(256).default(8),
  maxConcurrentNodesPerRun: PositiveInt.max(256).default(4),
  maxAttemptsPerNode: PositiveInt.max(20).default(3),
  maxRevisions: PositiveInt.max(128).default(16),
  maxLoopIterations: z.number().int().min(0).max(128).default(5),
  maxRunWallTimeMs: PositiveInt.max(30 * 24 * 60 * 60 * 1_000).default(7 * 24 * 60 * 60 * 1_000),
  maxNodeWallTimeMs: PositiveInt.max(24 * 60 * 60 * 1_000).default(24 * 60 * 60 * 1_000),
  maxTotalTokens: PositiveInt.max(1_000_000_000).optional(),
  maxArtifactBytes: z.number().int().min(0).max(100_000_000_000).default(1024 * 1024 * 1024),
  budgetWarningRatio: z.number().positive().max(1).default(0.8)
}).strict().transform((scheduler) => {
  const { maxTotalTokens, ...activeConfig } = scheduler
  void maxTotalTokens
  return activeConfig
})

export const GraphWorkerModelRuntimeConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('inherit')
  }).strict(),
  z.object({
    mode: z.literal('fixed'),
    providerId: z.string().trim().min(1).max(128),
    model: z.string().trim().min(1).max(256),
    reasoningEffort: ModelReasoningEffort.optional()
  }).strict()
]).default({ mode: 'inherit' })

export const GraphRuntimeConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    defaultStrategy: z.enum(['direct', 'graph']).default('direct'),
    rolloutStage: z.enum([
      'experimental',
      'alpha',
      'beta',
      'learning-preview',
      'stable'
    ]).default('experimental'),
    workerModel: GraphWorkerModelRuntimeConfigSchema,
    scheduler: GraphSchedulerRuntimeConfigSchema,
    context: z.object({
      maxWorkerContextBytes: PositiveInt.max(16 * 1024 * 1024).default(256 * 1024),
      maxDependencySummaryBytes: PositiveInt.max(1024 * 1024).default(32 * 1024),
      maxInputArtifacts: PositiveInt.max(1_000).default(64),
      maxInputMessages: PositiveInt.max(1_000).default(64),
      maxInlineEventBytes: PositiveInt.max(1024 * 1024).default(16 * 1024)
    }).strict(),
    mailbox: z.object({
      maxMessagesPerNode: z.number().int().min(0).max(10_000).default(128),
      maxMessagesPerRun: z.number().int().min(0).max(100_000).default(2_048),
      maxMessageBytes: PositiveInt.max(1024 * 1024).default(16 * 1024),
      maxArtifactRefsPerMessage: z.number().int().min(0).max(1_000).default(32),
      maxMessagesPerMinute: z.number().int().min(0).max(10_000).default(60),
      defaultTtlMs: PositiveInt.max(30 * 24 * 60 * 60 * 1_000).default(24 * 60 * 60 * 1_000),
      blockingReplyTimeoutMs: PositiveInt.max(30 * 24 * 60 * 60 * 1_000).default(30 * 60 * 1_000)
    }).strict(),
    supervision: z.object({
      enabled: z.boolean().default(true),
      autoStart: z.boolean().default(true),
      coalesceWindowMs: z.number().int().min(0).max(60_000).default(1_000),
      stallTimeoutMs: PositiveInt.max(24 * 60 * 60 * 1_000).default(15 * 60 * 1_000),
      repeatedFailureThreshold: z.number().int().min(2).max(20).default(2),
      requireFinalReview: z.boolean().default(true),
      requireHumanForCriticalRisk: z.boolean().default(true)
    }).strict(),
    writeIsolation: z.object({
      mode: z.enum(['serialize', 'lease', 'worktree']).default('serialize'),
      allowWorktrees: z.boolean().default(false),
      leaseTtlMs: PositiveInt.max(24 * 60 * 60 * 1_000).default(30 * 60 * 1_000),
      preserveFailedWorktrees: z.boolean().default(true)
    }).strict(),
    routing: z.object({
      recallLimit: PositiveInt.max(100).default(12),
      minTaskFit: z.number().min(0).max(1).default(0.25),
      minConfidence: z.number().min(0).max(1).default(0.2),
      explorationRatio: z.number().min(0).max(1).default(0),
      dormantMissedOpportunityThreshold: PositiveInt.max(10_000).default(20)
    }).strict(),
    learning: z.object({
      mode: z.enum(['off', 'suggest', 'auto_candidate']).default('off'),
      minimumDistinctSessions: z.number().int().min(2).max(1_000).default(3),
      minimumVerifiedEpisodes: z.number().int().min(2).max(10_000).default(3),
      consolidationIntervalMs: PositiveInt.max(365 * 24 * 60 * 60 * 1_000).default(24 * 60 * 60 * 1_000),
      maxEpisodesPerJob: PositiveInt.max(100_000).default(500),
      probationMinimumRuns: PositiveInt.max(1_000).default(5),
      allowReadOnlyExploration: z.boolean().default(false)
    }).strict(),
    retention: z.object({
      graphDays: PositiveInt.max(3_650).default(90),
      artifactDays: PositiveInt.max(3_650).default(30),
      episodeDays: PositiveInt.max(3_650).default(180),
      auditDays: PositiveInt.max(36_500).default(365),
      snapshotEveryEvents: PositiveInt.max(100_000).default(100),
      compactAfterEvents: PositiveInt.max(10_000_000).default(5_000)
    }).strict()
  })
  .strict()
  .superRefine((graph, ctx) => {
    if (!graph.enabled && graph.defaultStrategy === 'graph') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultStrategy'],
        message: 'defaultStrategy cannot be graph while Graph Mode is disabled'
      })
    }
    if (graph.scheduler.maxConcurrentNodesPerRun > graph.scheduler.maxConcurrentNodes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduler', 'maxConcurrentNodesPerRun'],
        message: 'maxConcurrentNodesPerRun must not exceed maxConcurrentNodes'
      })
    }
    if (graph.learning.mode === 'off' && graph.learning.allowReadOnlyExploration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['learning', 'allowReadOnlyExploration'],
        message: 'read-only exploration requires learning to be enabled'
      })
    }
  })
export type GraphRuntimeConfig = z.infer<typeof GraphRuntimeConfigSchema>
export const DEFAULT_GRAPH_RUNTIME_CONFIG: GraphRuntimeConfig = GraphRuntimeConfigSchema.parse({
  enabled: false,
  defaultStrategy: 'direct',
  rolloutStage: 'stable',
  workerModel: { mode: 'inherit' },
  scheduler: {
    maxNodes: 128,
    maxEdges: 512,
    maxConcurrentRuns: 4,
    maxConcurrentNodes: 8,
    maxConcurrentNodesPerRun: 4,
    maxAttemptsPerNode: 3,
    maxRevisions: 16,
    maxLoopIterations: 5,
    maxRunWallTimeMs: 7 * 24 * 60 * 60 * 1_000,
    maxNodeWallTimeMs: 24 * 60 * 60 * 1_000,
    maxArtifactBytes: 1024 * 1024 * 1024,
    budgetWarningRatio: 0.8
  },
  context: {
    maxWorkerContextBytes: 256 * 1024,
    maxDependencySummaryBytes: 32 * 1024,
    maxInputArtifacts: 64,
    maxInputMessages: 64,
    maxInlineEventBytes: 16 * 1024
  },
  mailbox: {
    maxMessagesPerNode: 128,
    maxMessagesPerRun: 2_048,
    maxMessageBytes: 16 * 1024,
    maxArtifactRefsPerMessage: 32,
    maxMessagesPerMinute: 60,
    defaultTtlMs: 24 * 60 * 60 * 1_000,
    blockingReplyTimeoutMs: 30 * 60 * 1_000
  },
  supervision: {
    enabled: true,
    autoStart: true,
    coalesceWindowMs: 1_000,
    stallTimeoutMs: 15 * 60 * 1_000,
    repeatedFailureThreshold: 2,
    requireFinalReview: true,
    requireHumanForCriticalRisk: true
  },
  writeIsolation: {
    mode: 'serialize',
    allowWorktrees: false,
    leaseTtlMs: 30 * 60 * 1_000,
    preserveFailedWorktrees: true
  },
  routing: {
    recallLimit: 12,
    minTaskFit: 0.25,
    minConfidence: 0.2,
    explorationRatio: 0,
    dormantMissedOpportunityThreshold: 20
  },
  learning: {
    mode: 'off',
    minimumDistinctSessions: 3,
    minimumVerifiedEpisodes: 3,
    consolidationIntervalMs: 24 * 60 * 60 * 1_000,
    maxEpisodesPerJob: 500,
    probationMinimumRuns: 5,
    allowReadOnlyExploration: false
  },
  retention: {
    graphDays: 90,
    artifactDays: 30,
    episodeDays: 180,
    auditDays: 365,
    snapshotEveryEvents: 100,
    compactAfterEvents: 5_000
  }
})

/** Detection aggressiveness for the design-quality linter. */
