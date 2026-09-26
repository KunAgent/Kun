import { z } from 'zod'
import { SubagentToolPolicy } from './capabilities.js'
import { ChildRunFailureSchema, ProactiveRetryStatusSchema } from './subagent-retry.js'

/**
 * Safe, compact progress projected from a child thread onto its parent.
 *
 * This intentionally carries only a phase label, never reasoning text or
 * tool output. A parent client can therefore show Kimi-style live activity
 * without subscribing to every child transcript or duplicating private
 * child-session content in the parent event log.
 */
export const ChildRunActivity = z.object({
  phase: z.enum(['starting', 'thinking', 'responding', 'tool', 'retrying', 'compacting', 'waiting']),
  label: z.string().min(1).max(500),
  toolName: z.string().min(1).max(256).optional(),
  startedAt: z.string(),
  updatedAt: z.string()
}).strict()
export type ChildRunActivity = z.infer<typeof ChildRunActivity>

export const RuntimeEventBase = z.object({
  seq: z.number().int().nonnegative(),
  timestamp: z.string(),
  threadId: z.string().min(1),
  turnId: z.string().optional(),
  itemId: z.string().optional(),
  child: z.object({
    parentThreadId: z.string().min(1),
    parentTurnId: z.string().min(1),
    childId: z.string().min(1),
    childLabel: z.string().optional(),
    childStatus: z.enum(['queued', 'running', 'completed', 'failed', 'aborted']),
    childSeq: z.number().int().nonnegative(),
    childLauncher: z.preprocess(
      (value) => (value === 'explore_agent' ? 'fast_context' : value),
      z.enum(['delegate_task', 'fast_context', 'ppt_agent', 'component_design', 'diagram_design', 'graph'])
    ).optional(),
    childTerminationReason: z.enum(['user_stop', 'manual_stop', 'runtime_restart', 'child_error']).optional(),
    resumable: z.boolean().optional(),
    resumeCount: z.number().int().nonnegative().optional(),
    failure: ChildRunFailureSchema.optional(),
    proactiveRetry: ProactiveRetryStatusSchema.optional(),
    detached: z.boolean().optional(),
    // Observability metrics carried alongside the child lifecycle event so
    // the GUI can show prefix reuse, tool fan-out, timing, and cost per
    // subagent without a separate diagnostics fetch.
    childModel: z.string().optional(),
    childProviderId: z.string().optional(),
    childProfile: z.string().optional(),
    childProfileName: z.string().optional(),
    childToolPolicy: SubagentToolPolicy.optional(),
    prefixReused: z.boolean().optional(),
    inheritedHistoryItems: z.number().int().nonnegative().optional(),
    toolInvocations: z.number().int().nonnegative().optional(),
    attemptStartedAt: z.string().optional(),
    attemptDurationMs: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    queuedMs: z.number().int().nonnegative().optional(),
    summaryTruncated: z.boolean().optional(),
    resultRef: z.object({
      artifactId: z.string().min(1),
      byteSize: z.number().int().nonnegative(),
      lineCount: z.number().int().nonnegative(),
      mimeType: z.literal('text/markdown')
    }).strict().optional(),
    resultUnavailableReason: z.string().min(1).max(500).optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    cacheHitRate: z.number().min(0).max(1).nullable().optional(),
    costUsd: z.number().nonnegative().optional(),
    costCny: z.number().nonnegative().optional(),
    activity: ChildRunActivity.optional()
  }).optional()
})
