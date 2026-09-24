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
import type { ProjectedApprovalReview, ThreadProjection } from './state-types.js'
import {
  activityFor,
  appendDeltaItem,
  ensureTurn,
  hasVisibleTurnOutcome,
  mapTurnItems,
  omitPendingApproval,
  omitPendingUserInput,
  projectChildLifecycle,
  replaceGoal,
  replaceTodos,
  updateActivityForItem,
  updateTurnStatus,
  upsertApprovalReview,
  upsertItem,
  upsertTurnItem,
  upsertVisibleError
} from './state-reducers.js'

export function applyRuntimeEvent(
  current: ThreadProjection,
  event: RuntimeEvent
): ThreadProjection {
  if (event.threadId !== current.thread.id || event.seq <= current.lastSeq) return current
  let next: ThreadProjection = {
    ...current,
    lastSeq: event.seq,
    thread: { ...current.thread, latestSeq: event.seq }
  }
  // Delegated child lifecycle records intentionally use the parent turn id so
  // all clients can find them on the parent stream. They are not parent turn
  // lifecycle transitions: completing one child must never mark the main turn
  // idle while the parent model is still running.
  if (event.child && (
    event.kind === 'turn_started' || event.kind === 'turn_completed' ||
    event.kind === 'turn_failed' || event.kind === 'turn_aborted' || event.kind === 'turn_steered'
  )) {
    return projectChildLifecycle(next, event)
  }
  switch (event.kind) {
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
    case 'tool_call_started':
    case 'tool_call_finished': {
      next = {
        ...next,
        items: upsertItem(current.items, event.item),
        thread: upsertTurnItem(next.thread, event.item)
      }
      if (event.item.kind === 'approval') {
        next = event.item.status === 'pending'
          ? {
              ...next,
              pendingApproval: {
                approvalId: event.item.approvalId,
                toolName: event.item.toolName,
                summary: event.item.summary,
                turnId: event.item.turnId,
                itemId: event.item.id
              }
            }
          : omitPendingApproval(next, event.item.approvalId)
      } else if (event.item.kind === 'user_input') {
        next = event.item.status === 'pending'
          ? {
              ...next,
              pendingUserInput: {
                inputId: event.item.inputId,
                prompt: event.item.prompt,
                questions: event.item.questions,
                turnId: event.item.turnId,
                itemId: event.item.id
              }
            }
          : omitPendingUserInput(next, event.item.inputId)
      }
      next = updateActivityForItem(next, event.item, event.kind, event.timestamp)
      break
    }
    case 'assistant_text_delta':
    case 'assistant_reasoning_delta': {
      const item = appendDeltaItem(current.items, event.item)
      next = {
        ...next,
        items: upsertItem(current.items, item),
        thread: upsertTurnItem(next.thread, item),
        activity: {
          turnId: event.turnId ?? item.turnId,
          phase: event.kind === 'assistant_reasoning_delta' ? 'thinking' : 'responding',
          label: event.kind === 'assistant_reasoning_delta' ? 'Thinking' : 'Responding',
          startedAt: current.activity?.turnId === (event.turnId ?? item.turnId) &&
            current.activity.phase === (event.kind === 'assistant_reasoning_delta' ? 'thinking' : 'responding')
            ? current.activity.startedAt
            : event.timestamp,
          turnStartedAt: current.activity?.turnId === (event.turnId ?? item.turnId)
            ? current.activity.turnStartedAt
            : event.timestamp,
          updatedAt: event.timestamp
        }
      }
      break
    }
    case 'turn_started':
      next = {
        ...next,
        runningTurnId: event.turnId,
        lastError: undefined,
        ...(event.turnId ? {
          activity: {
            turnId: event.turnId,
            phase: 'starting',
            label: 'Waiting for model',
            startedAt: event.timestamp,
            turnStartedAt: event.timestamp,
            updatedAt: event.timestamp
          }
        } : {}),
        thread: updateTurnStatus(next.thread, event.turnId, 'running', 'running', event.timestamp, '', {
          ...(event.model ? { model: event.model } : {}),
          ...(event.providerId ? { providerId: event.providerId } : {}),
          ...(event.accountId ? { accountId: event.accountId } : {}),
          ...(event.reasoningEffort ? { reasoningEffort: event.reasoningEffort } : {}),
          ...(event.approvalPolicy ? { approvalPolicy: event.approvalPolicy } : {}),
          ...(event.sandboxMode ? { sandboxMode: event.sandboxMode } : {}),
          ...(event.approvalReviewer ? { approvalReviewer: event.approvalReviewer } : {}),
          ...(event.mode ? { mode: event.mode } : {})
        })
      }
      break
    case 'turn_completed':
    case 'turn_failed':
    case 'turn_aborted': {
      const status = event.kind === 'turn_completed'
        ? 'completed'
        : event.kind === 'turn_failed'
          ? 'failed'
          : 'aborted'
      next = {
        ...next,
        ...(next.runningTurnId === event.turnId ? { runningTurnId: undefined } : {}),
        ...(next.activity?.turnId === event.turnId ? { activity: undefined } : {}),
        thread: updateTurnStatus(next.thread, event.turnId, status, 'idle', event.timestamp),
        ...(event.kind === 'turn_failed' && event.message ? { lastError: event.message } : {})
      }
      if (event.kind === 'turn_failed' && event.turnId) {
        next = upsertVisibleError(next, {
          turnId: event.turnId,
          timestamp: event.timestamp,
          message: event.message ?? 'The turn failed before Kun produced a response.',
          code: event.code,
          details: event.details,
          severity: event.severity ?? 'error'
        })
      } else if (event.kind === 'turn_aborted' && event.turnId) {
        next = upsertVisibleError(next, {
          turnId: event.turnId,
          timestamp: event.timestamp,
          message: event.message ?? 'Turn stopped.',
          code: event.code ?? 'aborted',
          details: event.details,
          severity: 'warning',
          status: 'aborted'
        })
      } else if (event.kind === 'turn_completed' && event.turnId && !hasVisibleTurnOutcome(next.items, event.turnId)) {
        next = upsertVisibleError(next, {
          turnId: event.turnId,
          timestamp: event.timestamp,
          message: 'Kun completed this turn without a text response.',
          code: 'empty_turn',
          severity: 'warning',
          status: 'completed'
        })
      }
      break
    }
    case 'thread_updated':
      next = {
        ...next,
        thread: {
          ...next.thread,
          ...(event.title !== undefined ? { title: event.title } : {}),
          ...(event.titleAuto !== undefined ? { titleAuto: event.titleAuto } : {}),
          ...(event.status === 'idle' || event.status === 'running' || event.status === 'archived'
            ? { status: event.status }
            : {}),
          ...(event.mode ? { mode: event.mode } : {}),
          ...(event.workspace ? { workspace: event.workspace } : {}),
          ...(event.additionalWorkspaces ? { additionalWorkspaces: event.additionalWorkspaces } : {}),
          ...(event.approvalPolicy ? { approvalPolicy: event.approvalPolicy } : {}),
          ...(event.sandboxMode ? { sandboxMode: event.sandboxMode } : {}),
          ...(event.approvalReviewer ? { approvalReviewer: event.approvalReviewer } : {})
        }
      }
      break
    case 'approval_requested':
      next = {
        ...next,
        ...(event.turnId ? {
          activity: activityFor(event.turnId, 'waiting', 'Waiting for approval', event.timestamp, current.activity)
        } : {}),
        pendingApproval: {
          approvalId: event.approvalId,
          toolName: event.toolName,
          summary: event.summary ?? event.toolName,
          ...(event.turnId ? { turnId: event.turnId } : {}),
          ...(event.itemId ? { itemId: event.itemId } : {})
        }
      }
      break
    case 'approval_resolved':
      next = omitPendingApproval(next, event.approvalId)
      next = {
        ...next,
        items: next.items.map((item) => item.kind === 'approval' && item.approvalId === event.approvalId
          ? { ...item, status: event.status }
          : item),
        thread: mapTurnItems(next.thread, (item) => item.kind === 'approval' && item.approvalId === event.approvalId
          ? { ...item, status: event.status }
          : item)
      }
      break
    case 'approval_review_started': {
      const review: ProjectedApprovalReview = {
        reviewId: event.reviewId,
        approvalId: event.approvalId,
        toolName: event.toolName,
        summary: event.summary,
        status: event.status,
        startedAt: event.timestamp,
        ...(event.turnId ? { turnId: event.turnId } : {})
      }
      next = {
        ...next,
        approvalReviews: upsertApprovalReview(next.approvalReviews, review),
        ...(event.turnId
          ? {
              activity: activityFor(
                event.turnId,
                'waiting',
                `Agent reviewing ${event.toolName}`,
                event.timestamp,
                current.activity
              )
            }
          : {})
      }
      break
    }
    case 'approval_review_completed': {
      const existing = next.approvalReviews.find((review) => review.reviewId === event.reviewId)
      const turnId = event.turnId ?? existing?.turnId
      const review: ProjectedApprovalReview = {
        reviewId: event.reviewId,
        approvalId: event.approvalId,
        toolName: event.toolName,
        summary: event.summary,
        status: event.status,
        startedAt: existing?.startedAt ?? event.timestamp,
        completedAt: event.timestamp,
        ...(turnId ? { turnId } : {}),
        ...(event.decision ? { decision: event.decision } : {}),
        ...(event.riskLevel ? { riskLevel: event.riskLevel } : {}),
        ...(event.rationale ? { rationale: event.rationale } : {})
      }
      next = {
        ...next,
        approvalReviews: upsertApprovalReview(next.approvalReviews, review),
        ...(event.turnId && next.runningTurnId === event.turnId
          ? {
              activity: activityFor(
                event.turnId,
                'starting',
                event.status === 'approved'
                  ? `Continuing after agent review`
                  : `Agent review ${event.status}`,
                event.timestamp,
                current.activity
              )
            }
          : {})
      }
      break
    }
    case 'user_input_requested':
      next = {
        ...next,
        ...(event.turnId ? {
          activity: activityFor(event.turnId, 'waiting', 'Waiting for your input', event.timestamp, current.activity)
        } : {}),
        pendingUserInput: {
          inputId: event.inputId,
          prompt: event.prompt ?? 'Input requested',
          questions: event.questions ?? [],
          ...(event.turnId ? { turnId: event.turnId } : {}),
          ...(event.itemId ? { itemId: event.itemId } : {})
        }
      }
      break
    case 'user_input_resolved':
      next = omitPendingUserInput(next, event.inputId)
      next = {
        ...next,
        items: next.items.map((item) => item.kind === 'user_input' && item.inputId === event.inputId
          ? { ...item, status: event.status, ...(event.answers ? { answers: event.answers } : {}) }
          : item),
        thread: mapTurnItems(next.thread, (item) => item.kind === 'user_input' && item.inputId === event.inputId
          ? { ...item, status: event.status, ...(event.answers ? { answers: event.answers } : {}) }
          : item)
      }
      break
    case 'usage':
      next = { ...next, usage: event.usage }
      break
    case 'context_snapshot':
      next = { ...next, contextSnapshot: event }
      break
    case 'turn_steered':
      if (event.turnId && event.text) {
        const thread = ensureTurn(next.thread, event.turnId, 'running', event.timestamp)
        next = {
          ...next,
          thread: {
            ...thread,
            turns: thread.turns.map((turn) => turn.id === event.turnId
              ? { ...turn, steering: [...turn.steering, event.text!] }
              : turn)
          }
        }
      }
      break
    case 'turn_steering_updated':
      if (event.turnId) {
        const thread = ensureTurn(next.thread, event.turnId, 'running', event.timestamp)
        next = {
          ...next,
          thread: {
            ...thread,
            turns: thread.turns.map((turn) => turn.id === event.turnId
              ? { ...turn, steering: event.entries.map((entry) => entry.text) }
              : turn)
          }
        }
      }
      break
    case 'goal_updated':
    case 'goal_cleared':
      next = { ...next, thread: replaceGoal(next.thread, event.goal ?? undefined) }
      break
    case 'todos_updated':
    case 'todos_cleared':
      next = { ...next, thread: replaceTodos(next.thread, event.todos ?? undefined) }
      break
    case 'error':
      next = { ...next, lastError: event.message }
      if (event.turnId) {
        next = upsertVisibleError(next, {
          turnId: event.turnId,
          timestamp: event.timestamp,
          message: event.message,
          code: event.code,
          details: event.details,
          severity: event.severity ?? 'error'
        })
      }
      break
    case 'heartbeat':
    case 'thread_created':
      break
    case 'tool_call_ready':
      if (event.turnId) {
        next = {
          ...next,
          activity: {
            ...activityFor(event.turnId, 'tool', `Running ${event.toolName}`, event.timestamp, current.activity),
            toolName: event.toolName
          }
        }
      }
      break
    case 'model_request_retry':
      if (event.turnId) {
        next = {
          ...next,
          activity: {
            ...activityFor(event.turnId, 'retrying', `Retrying model request ${event.attempt}/${event.maxAttempts}`, event.timestamp, current.activity),
            attempt: event.attempt,
            maxAttempts: event.maxAttempts
          }
        }
      }
      break
    case 'model_route_switch':
      if (event.turnId) {
        next = {
          ...next,
          activity: activityFor(
            event.turnId,
            'retrying',
            `Switching model route to ${event.toProviderId}/${event.toModelId}`,
            event.timestamp,
            current.activity
          )
        }
      }
      break
    case 'tool_result_upload_wait':
      if (event.turnId) {
        next = {
          ...next,
          activity: activityFor(event.turnId, 'waiting', 'Waiting for tool results', event.timestamp, current.activity)
        }
      }
      break
    case 'tool_storm_suppressed':
    case 'tool_catalog_changed':
      break
    case 'compaction_started':
      if (event.turnId) {
        next = {
          ...next,
          activity: activityFor(event.turnId, 'compacting', event.summary ?? 'Compacting context', event.timestamp, current.activity)
        }
      }
      break
    case 'compaction_completed':
      if (event.turnId && next.runningTurnId === event.turnId) {
        next = {
          ...next,
          activity: activityFor(event.turnId, 'starting', 'Continuing', event.timestamp, current.activity)
        }
      }
      break
    case 'bash_session_started':
    case 'bash_session_updated':
    case 'bash_session_completed':
    case 'graph_event':
      break
    case 'pipeline_stage':
      if (event.turnId && next.runningTurnId === event.turnId && event.stage === 'pre_send') {
        next = {
          ...next,
          activity: activityFor(event.turnId, 'starting', event.label ?? 'Calling model', event.timestamp, current.activity)
        }
      }
      break
  }
  return next
}
