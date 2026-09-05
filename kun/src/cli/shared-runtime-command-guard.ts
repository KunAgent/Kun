import type { SharedRuntimeInspection } from './shared-runtime.js'

export function assertRuntimeSelfControlAllowed(
  inspected: SharedRuntimeInspection | null,
  callerRuntimeInstanceId: string | undefined
): void {
  if (!callerRuntimeInstanceId || inspected?.discovery.instanceId !== callerRuntimeInstanceId) return
  throw new Error(
    'runtime_self_control_forbidden: cannot stop or restart the Runtime that is executing ' +
    'this command; use the GUI or an external terminal'
  )
}

export function assertOneShotRuntimeControlAllowed(
  inspected: SharedRuntimeInspection | null,
  callerRuntimeInstanceId: string | undefined
): void {
  assertRuntimeSelfControlAllowed(inspected, callerRuntimeInstanceId)
  if (!inspected?.discovery.clientOwnerKind) return
  throw new Error(
    `runtime is owned by ${inspected.discovery.clientOwnerKind}; ` +
    'close or restart that client instead'
  )
}

export function sameInspectedRuntimeOwner(
  left: SharedRuntimeInspection | null,
  right: SharedRuntimeInspection | null
): boolean {
  if (!left || !right) return left === right
  const a = left.discovery
  const b = right.discovery
  return a.instanceId === b.instanceId &&
    a.pid === b.pid &&
    a.startedAt === b.startedAt &&
    a.host === b.host &&
    a.port === b.port &&
    a.baseUrl === b.baseUrl &&
    a.runtimeToken === b.runtimeToken &&
    a.launchMode === b.launchMode &&
    a.clientOwnerKind === b.clientOwnerKind &&
    a.flavor === b.flavor
}
