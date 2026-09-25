export type ActivityRollupChildren = {
  working: number
  waiting: number
  done: number
  failed: number
}

export type ActivityRollupState =
  | 'initializing'
  | 'working'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'idle'
  | 'closed'

/**
 * Fold child counts into the unit's own state (docs/ade/06 §5).
 * Mirror of kun/src/services/activity-rollup.ts; both sides are pinned by
 * the shared fixture at kun/src/services/__fixtures__/activity-rollup.json.
 */
export function rollupState(
  main: ActivityRollupState,
  children: ActivityRollupChildren
): ActivityRollupState {
  if (main === 'waiting') return 'waiting'
  if (children.waiting > 0) return 'waiting'
  if (main === 'working' || main === 'initializing') return main
  if (children.working > 0) return 'working'
  return main
}
