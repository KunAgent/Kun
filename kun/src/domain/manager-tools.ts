import type { ToolHostContext } from '../ports/tool-host.js'

type ManagerToolAdmissionContext = Pick<
  ToolHostContext,
  'workspaceMode' | 'collaborationEnabled' | 'collaborationEverEnabled' |
  'harnessId' | 'executionUnitKind' | 'roomAgent' | 'agentSurface' |
  'clientSurface' | 'imContext' | 'managerToolBridgeAvailable'
>

/** Shared discovery and execution gate for existing-team controls. */
export function shouldAdvertiseManagerTools(
  context: ManagerToolAdmissionContext
): boolean {
  const collaborationAccess = context.collaborationEnabled === true ||
    context.collaborationEverEnabled === true ||
    (context.collaborationEnabled === undefined && context.workspaceMode === 'ade')
  return collaborationAccess &&
    ((context.harnessId ?? 'kun') === 'kun' || context.managerToolBridgeAvailable === true) &&
    context.executionUnitKind !== 'worker' &&
    context.roomAgent !== true &&
    (context.agentSurface ?? 'code') === 'code' &&
    context.clientSurface !== 'im' &&
    context.imContext !== true
}

/** New workers and dispatches require the current task policy to allow them. */
export function shouldAdvertiseNewManagerWork(context: ManagerToolAdmissionContext): boolean {
  return shouldAdvertiseManagerTools(context) &&
    (context.collaborationEnabled ?? context.workspaceMode === 'ade')
}
