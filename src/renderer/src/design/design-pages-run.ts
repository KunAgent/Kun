export type { RunDesignPagesDeps } from './design-pages-run/orchestration-support'
export { cancelDesignPagesRun, deriveParallelDesignPageStatesFromBlocks, isDesignPagesRunActive } from './design-pages-run/orchestration-support'
export { runDesignPages } from './design-pages-run/runner'
import { cancelDesignPagesRun } from './design-pages-run/orchestration-support'

/**
 * Stop the renderer-owned multi-step Design orchestration before interrupting
 * the current runtime turn. The runtime can become idle immediately after an
 * interrupt; cancelling first prevents that idle transition from being
 * mistaken for a normally completed step and scheduling the next one.
 */
export function interruptDesignPagesRun(
  interrupt: (options?: { discard?: boolean }) => void,
  options?: { discard?: boolean }
): void {
  cancelDesignPagesRun()
  interrupt(options)
}
