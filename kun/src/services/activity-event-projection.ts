import type { RuntimeEvent } from '../contracts/events.js'
import type { ActivityPatch } from '../contracts/activity.js'

export type ActivityProjection = {
  unitId: string
  patch: ActivityPatch
}

const PREVIEW_MAX = 200

/**
 * Pure mapping from persisted runtime events to activity-row patches
 * (docs/ade/06 §4.2). Registration decisions live in the ActivityStore;
 * patches on unregistered units are ignored there.
 */
export function projectRuntimeEvent(event: RuntimeEvent): ActivityProjection[] {
  // Events carrying `child` are child lifecycle records on the parent's
  // stream: their kind describes the child transition, not the parent turn.
  const child = event.child
  if (child) {
    return [
      {
        unitId: child.childId,
        patch: {
          parentThreadId: child.parentThreadId,
          ...childStatusPatch(child.childStatus)
        }
      }
    ]
  }
  const patch = selfPatch(event)
  if (!patch) return []
  // Task-workspace updates target the bound execution unit, which may be
  // a worker row rather than the owner thread's row.
  const unitId =
    event.kind === 'task_workspace'
      ? event.taskWorkspace.unitId ?? event.threadId
      : event.threadId
  return [{ unitId, patch }]
}

function selfPatch(event: RuntimeEvent): ActivityPatch | null {
  switch (event.kind) {
    case 'turn_queued':
      return { mainState: 'initializing' }
    case 'turn_started':
      return {
        mainState: 'working',
        turnId: event.turnId,
        lastOutcome: undefined,
        waitingReason: undefined,
        currentTool: undefined,
        stalled: false
      }
    case 'approval_requested':
      return event.status === 'pending'
        ? { mainState: 'waiting', waitingReason: 'approval' }
        : null
    case 'user_input_requested':
      return event.status === 'pending'
        ? { mainState: 'waiting', waitingReason: 'user_input' }
        : null
    case 'approval_resolved':
    case 'user_input_resolved':
      return { mainState: 'working', waitingReason: undefined }
    case 'tool_call_started':
      return event.item.kind === 'tool_call'
        ? { currentTool: event.item.toolName.slice(0, 128) }
        : null
    case 'tool_call_finished':
      return { currentTool: undefined }
    case 'assistant_text_delta':
      return event.item.kind === 'assistant_text'
        ? { lastMessagePreview: event.item.text.slice(-PREVIEW_MAX) }
        : null
    case 'turn_completed':
      return {
        mainState: 'done',
        lastOutcome: 'completed',
        turnId: event.turnId,
        waitingReason: undefined,
        currentTool: undefined
      }
    case 'turn_failed':
      return {
        mainState: 'failed',
        lastOutcome: 'failed',
        turnId: event.turnId,
        waitingReason: undefined,
        currentTool: undefined
      }
    case 'turn_aborted':
      return {
        mainState: 'idle',
        lastOutcome: 'cancelled',
        turnId: event.turnId,
        waitingReason: undefined,
        currentTool: undefined
      }
    case 'thread_updated':
      return typeof event.title === 'string' && event.title.length > 0
        ? { title: event.title.slice(0, 200) }
        : null
    case 'task_workspace': {
      const workspace = event.taskWorkspace.workspace
      const progressNote = event.taskWorkspace.progress?.message
      if (!workspace && !progressNote) return null
      return {
        ...(workspace
          ? {
              workspace: {
                path: workspace.path,
                kind: workspace.kind,
                ...(workspace.branch ? { branch: workspace.branch } : {})
              }
            }
          : {}),
        ...(progressNote ? { progressNote: progressNote.slice(0, 280) } : {})
      }
    }
    case 'harness_runtime':
      return { harnessId: event.harnessId }
    case 'delegated_runtime':
      return event.harnessId ? { harnessId: event.harnessId } : null
    default:
      return null
  }
}

function childStatusPatch(
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
): ActivityPatch {
  switch (status) {
    case 'queued':
      return { mainState: 'initializing' }
    case 'running':
      return { mainState: 'working', waitingReason: undefined, stalled: false }
    case 'completed':
      return { mainState: 'done', lastOutcome: 'completed' }
    case 'failed':
      return { mainState: 'failed', lastOutcome: 'failed' }
    case 'aborted':
      return { mainState: 'idle', lastOutcome: 'cancelled' }
  }
}
