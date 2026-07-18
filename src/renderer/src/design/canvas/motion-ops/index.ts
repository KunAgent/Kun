export { MotionOpSchema } from './schema'
export type { ExecuteMotionOpsResult, MotionOp, MotionOpError } from './schema'
export { executeMotionOps } from './executor'
export type { ExecuteMotionOpsOptions } from './executor'

export const DESIGN_MOTION_RENDERER_TOOL_NAMES = new Set([
  'design_motion_set_timeline',
  'design_motion_upsert_keyframes',
  'design_motion_apply_preset',
  'design_motion_delete'
])

export function isDesignMotionRendererToolName(value: unknown): value is string {
  return typeof value === 'string' && DESIGN_MOTION_RENDERER_TOOL_NAMES.has(value)
}

export function extractMotionOpsFromValue(value: unknown): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const motionOps = (value as { motionOps?: unknown }).motionOps
  return Array.isArray(motionOps) ? motionOps : []
}
