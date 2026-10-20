import type { ContextSnapshotEvent, RuntimeEvent } from '../contracts/events.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type {
  ApprovalTurnItem,
  TurnItem,
  UserInputQuestionSchema,
  UserInputTurnItem
} from '../contracts/items.js'
import type { Turn } from '../contracts/turns.js'
import type { DelegationDiagnostics, ThreadDetail } from './client.js'
import type { z } from 'zod'
import type { ProjectedChildRun, ThreadProjection } from './state-types.js'
import { activityFromTurn } from './state-reducers.js'

export function projectThreadSnapshot(thread: ThreadDetail): ThreadProjection {
  const items = thread.turns.flatMap((turn) => turn.items)
  const running = [...thread.turns].reverse().find((turn) => turn.status === 'running' || turn.status === 'queued')
  const pendingApprovalIds = Array.isArray(thread.pendingApprovalIds)
    ? new Set(thread.pendingApprovalIds)
    : undefined
  const pendingApprovalItem = [...items].reverse().find(
    (item): item is ApprovalTurnItem =>
      item.kind === 'approval' &&
      item.status === 'pending' &&
      (!pendingApprovalIds || pendingApprovalIds.has(item.approvalId))
  )
  const pendingInputItem = [...items].reverse().find(
    (item): item is UserInputTurnItem =>
      item.kind === 'user_input' && item.status === 'pending' && thread.pendingUserInputIds.includes(item.inputId)
  )
  return {
    thread,
    items,
    lastSeq: thread.latestSeq,
    childRuns: [],
    approvalReviews: [],
    ...(thread.contextSnapshot ? { contextSnapshot: thread.contextSnapshot } : {}),
    ...(running ? { runningTurnId: running.id } : {}),
    ...(running ? { activity: activityFromTurn(running) } : {}),
    ...(pendingApprovalItem ? {
      pendingApproval: {
        approvalId: pendingApprovalItem.approvalId,
        toolName: pendingApprovalItem.toolName,
        summary: pendingApprovalItem.summary,
        turnId: pendingApprovalItem.turnId,
        itemId: pendingApprovalItem.id
      }
    } : {}),
    ...(pendingInputItem ? {
      pendingUserInput: {
        inputId: pendingInputItem.inputId,
        prompt: pendingInputItem.prompt,
        questions: pendingInputItem.questions,
        turnId: pendingInputItem.turnId,
        itemId: pendingInputItem.id
      }
    } : {})
  }
}

export function hydrateProjectedChildRuns(
  current: ThreadProjection,
  diagnostics: DelegationDiagnostics | undefined
): ThreadProjection {
  if (!diagnostics) return current
  return {
    ...current,
    childRuns: diagnostics.childRuns.map((run) => ({
      childId: run.id,
      parentTurnId: run.parentTurnId,
      ...(run.label ? { label: run.label } : {}),
      ...(run.prompt ? { prompt: run.prompt } : {}),
      ...(run.profile ? { profile: run.profile } : {}),
      ...(run.profileSnapshot?.name ? { profileName: run.profileSnapshot.name } : {}),
      ...(typeof run.model === 'string' && run.model ? { model: run.model } : {}),
      ...(typeof run.providerId === 'string' && run.providerId ? { providerId: run.providerId } : {}),
      ...(typeof run.reasoningEffort === 'string' && run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
      ...(run.toolPolicy ? { toolPolicy: run.toolPolicy } : {}),
      status: run.status,
      ...(run.summary || run.error ? { text: run.summary ?? run.error } : {}),
      ...(run.detached ? { detached: true } : {}),
      ...(run.prefixReused !== undefined ? { prefixReused: run.prefixReused } : {}),
      ...(typeof run.inheritedHistoryItems === 'number' ? { inheritedHistoryItems: run.inheritedHistoryItems } : {}),
      ...(typeof run.toolInvocations === 'number' ? { toolInvocations: run.toolInvocations } : {}),
      ...(run.activity ? { activity: run.activity } : {}),
      ...(typeof run.durationMs === 'number' ? { durationMs: run.durationMs } : {}),
      ...(typeof run.queuedMs === 'number' ? { queuedMs: run.queuedMs } : {}),
      ...(typeof run.childSeq === 'number' ? { childSeq: run.childSeq } : {}),
      ...(run.usage?.totalTokens > 0 ? { totalTokens: run.usage.totalTokens } : {}),
      ...(run.usage?.cacheHitRate !== undefined ? { cacheHitRate: run.usage.cacheHitRate } : {}),
      ...(run.usage?.costUsd !== undefined ? { costUsd: run.usage.costUsd } : {}),
      ...(run.usage?.costCny !== undefined ? { costCny: run.usage.costCny } : {}),
      startedAt: run.startedAt ?? run.createdAt,
      updatedAt: run.updatedAt
    }))
  }
}
