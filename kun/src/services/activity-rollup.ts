import type {
  ActivityChildren,
  ActivityState,
  ActivityWaitingReason
} from '../contracts/activity.js'

/**
 * Fold child counts into the unit's own state (docs/ade/06 §5).
 * A waiting unit (or any waiting child) surfaces first; a unit whose own
 * turn is done still reads working while its workers run. Keep this file
 * in sync with src/shared/activity-rollup.ts — both sides are pinned by
 * the shared fixture at kun/src/services/__fixtures__/activity-rollup.json.
 */
export function rollupState(
  main: ActivityState,
  children: ActivityChildren,
  _waitingReason?: ActivityWaitingReason
): ActivityState {
  if (main === 'waiting') return 'waiting'
  if (children.waiting > 0) return 'waiting'
  if (main === 'working' || main === 'initializing') return main
  if (children.working > 0) return 'working'
  return main
}
