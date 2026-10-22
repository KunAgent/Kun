import { z } from 'zod'
import type { AgentDispatchAssignmentRoute } from './agent-dispatch'

/** Lightweight HTTP mirror of Kun's suggestion-card contract, independent of its loop types. */
export type TaskSuggestionRoute = AgentDispatchAssignmentRoute
export type TaskSuggestionRowState =
  'suggested' | 'starting' | 'running' | 'done' | 'failed' | 'start_failed' | 'cancelled' | 'ignored' | 'here'
export type TaskSuggestionFailureCode = 'disk_space' | 'worktree_conflict' | 'agent_unavailable' | 'quota' | 'runtime'
export type TaskSuggestionCardState = 'suggested' | 'countdown' | 'paused' | 'active' | 'settled'
export type TaskSuggestionBrief = { goal: string; scope: string[]; done: string[] }
export type TaskSuggestionResult = {
  turnStatus: 'completed' | 'failed' | 'aborted'
  summary?: string
  error?: string
  changedFiles?: number
}
export type TaskSuggestionTaskView = {
  id: string
  title: string
  area?: string
  brief: TaskSuggestionBrief
  route: TaskSuggestionRoute
  worktree: boolean
  inheritContext: boolean
  state: TaskSuggestionRowState
  attempt: number
  threadId?: string
  turnId?: string
  taskWorkspaceId?: string
  branch?: string
  startedAt?: string
  settledAt?: string
  failure?: { code: TaskSuggestionFailureCode; message: string }
  result?: TaskSuggestionResult
  reportAcknowledged?: boolean
}
export type TaskSuggestionView = {
  intentId: string
  revision: number
  source: { threadId: string; turnId: string; toolCallId: string }
  state: TaskSuggestionCardState
  workspace: string
  reason?: string
  deadline?: string
  autoStarted?: boolean
  tasks: TaskSuggestionTaskView[]
  createdAt: string
  updatedAt: string
}

const route = z.object({ agentId: z.string().min(1).max(512), model: z.string().max(512).optional(),
  providerId: z.string().min(1).max(128).optional(),
  credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional() }).strict()
const brief = z.object({ goal: z.string().min(1).max(8_000), scope: z.array(z.string().max(2_000)).max(12).default([]),
  done: z.array(z.string().max(2_000)).max(12).default([]) }).strict()
const task = z.object({
  id: z.string().min(1).max(64), title: z.string().min(1).max(200), area: z.string().max(200).optional(),
  brief, route, worktree: z.boolean(), inheritContext: z.boolean().default(false),
  state: z.enum(['suggested', 'starting', 'running', 'done', 'failed', 'start_failed', 'cancelled', 'ignored', 'here']),
  attempt: z.number().int().min(0).default(0), threadId: z.string().min(1).optional(), turnId: z.string().min(1).optional(),
  taskWorkspaceId: z.string().min(1).optional(), branch: z.string().max(512).optional(),
  startedAt: z.string().datetime().optional(), settledAt: z.string().datetime().optional(),
  failure: z.object({ code: z.enum(['disk_space', 'worktree_conflict', 'agent_unavailable', 'quota', 'runtime']),
    message: z.string().max(2_000) }).strict().optional(),
  result: z.object({ turnStatus: z.enum(['completed', 'failed', 'aborted']), summary: z.string().max(4_000).optional(),
    error: z.string().max(2_000).optional(), changedFiles: z.number().int().min(0).optional() }).strict().optional(),
  reportAcknowledged: z.boolean().optional()
}).strict()

export const TaskSuggestionPublicSchema: z.ZodType<TaskSuggestionView> = z.object({
  intentId: z.string().min(1).max(256), revision: z.number().int().positive(),
  source: z.object({ threadId: z.string().min(1), turnId: z.string().min(1), toolCallId: z.string().min(1) }).strict(),
  state: z.enum(['suggested', 'countdown', 'paused', 'active', 'settled']),
  workspace: z.string().min(1).max(4_096), reason: z.string().max(2_000).optional(),
  deadline: z.string().datetime().optional(), autoStarted: z.boolean().optional(),
  tasks: z.array(task).min(1).max(6), createdAt: z.string().datetime(), updatedAt: z.string().datetime()
}).strict()

export type TaskSuggestionActionName =
  'start' | 'pause' | 'resume' | 'update' | 'ignore' | 'retry' | 'continue_here' | 'acknowledge'
export type TaskSuggestionTaskChanges = {
  title?: string
  route?: TaskSuggestionRoute
  worktree?: boolean
  inheritContext?: boolean
  brief?: TaskSuggestionBrief
}
export type TaskSuggestionActionInput = {
  taskIds?: string[]
  taskId?: string
  changes?: TaskSuggestionTaskChanges
}

export const taskSuggestionPath = (intentId: string): string =>
  `/v1/task-suggestions/${encodeURIComponent(intentId)}`

const FINAL: ReadonlySet<TaskSuggestionRowState> = new Set(['done', 'failed', 'cancelled', 'ignored', 'here'])
export const isFinalTaskRow = (state: TaskSuggestionRowState): boolean => FINAL.has(state)
