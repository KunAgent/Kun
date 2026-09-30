import type { ToolHostContext } from '../ports/tool-host.js'

/**
 * Manager (`worker_*`) tools exist only inside ADE mode: the owning thread's
 * `workspaceMode` must be 'ade', the turn must run on the native Kun loop
 * (external harnesses never manage workers), the thread must not itself be a
 * worker execution unit (no nested teams — workers use `delegate_task`), and
 * room agents are excluded (Rooms keep their own member protocol).
 *
 * This predicate is the single gate consulted by the manager tool provider
 * (P1) so the rule stays host-enforced and testable instead of prompt-level.
 */
export function shouldAdvertiseManagerTools(
  context: Pick<
    ToolHostContext,
    'workspaceMode' | 'harnessId' | 'executionUnitKind' | 'roomAgent'
  >
): boolean {
  return context.workspaceMode === 'ade' &&
    (context.harnessId ?? 'kun') === 'kun' &&
    context.executionUnitKind !== 'worker' &&
    context.roomAgent !== true
}
