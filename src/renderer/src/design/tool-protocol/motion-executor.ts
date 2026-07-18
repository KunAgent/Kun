import { executeMotionOps } from '../canvas/motion-ops'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import {
  invalidToolResult,
  invocationInputRecord,
  labelForInvocation,
  type DesignToolInvocation,
  type DesignToolInvocationResult
} from './protocol-types'

const MOTION_PROTOCOL_OP_BY_TOOL: Record<string, string> = {
  design_motion_set_timeline: 'set-timeline',
  design_motion_upsert_keyframes: 'upsert-keyframes',
  design_motion_apply_preset: 'apply-preset',
  design_motion_delete: 'delete'
}

export function executeDesignMotionInvocation(
  invocation: DesignToolInvocation
): DesignToolInvocationResult {
  const record = invocationInputRecord(invocation.input)
  if (!record) {
    return invalidToolResult(invocation, {
      code: 'INVALID_INPUT',
      message: `${invocation.toolId} expects its structured Motion tool arguments or a motionOps array.`
    })
  }
  const explicitOps = Array.isArray(record.motionOps) ? record.motionOps : null
  const op = MOTION_PROTOCOL_OP_BY_TOOL[invocation.toolId]
  const motionOps = explicitOps ?? (op ? [{ ...record, op }] : [])
  const label = labelForInvocation(invocation, invocation.toolId)
  const previousJournalId = useCanvasShapeStore.getState().document.operationJournal?.at(-1)?.id
  const result = executeMotionOps(motionOps, label)
  const journalEntry = useCanvasShapeStore.getState().document.operationJournal?.at(-1)
  const entryChanged = journalEntry && journalEntry.id !== previousJournalId
  return {
    ok: result.ok,
    toolId: invocation.toolId,
    status: result.ok ? 'applied' : 'partial',
    affectedIds: result.affectedIds,
    errors: result.errors,
    ...(entryChanged ? { journalEntry } : {}),
    summaryLines: [
      `${invocation.toolId}: ${result.ok ? 'applied' : 'partial'} ${motionOps.length} Motion operation${motionOps.length === 1 ? '' : 's'}`,
      `affected: ${result.affectedIds.length}`,
      `errors: ${result.errors.length}`
    ]
  }
}
