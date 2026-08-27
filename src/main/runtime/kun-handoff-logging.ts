import { logInfo, logWarn } from '../logger'
import type { KunHandoffEvent } from './kun-installed-build-handoff'

export function kunHandoffLogDetail(event: KunHandoffEvent): Record<string, unknown> {
  const owner = event.owner
  return {
    reason: event.reason,
    phase: event.phase,
    elapsedMs: event.elapsedMs,
    ...(event.targetBuildId ? { targetBuildId: abbreviateBuildId(event.targetBuildId) } : {}),
    ...(event.result ? { result: event.result } : {}),
    ...(event.code ? { code: event.code } : {}),
    ...(event.probeClassification ? { probeClassification: event.probeClassification } : {}),
    ...(event.postcondition ? { postcondition: event.postcondition } : {}),
    ...(owner
      ? {
          ownerKind: owner.kind,
          ...(owner.flavor ? { flavor: owner.flavor } : {}),
          ...(owner.pid ? { pid: owner.pid } : {}),
          ...(owner.instanceId ? { instanceId: owner.instanceId } : {}),
          ...(owner.port ? { port: owner.port } : {}),
          ...(owner.buildId ? { buildId: abbreviateBuildId(owner.buildId) } : {})
        }
      : {})
  }
}

export function logKunHandoffEvent(event: KunHandoffEvent): void {
  const message = `Kun owner handoff ${event.phase}${event.result ? `: ${event.result}` : ''}`
  const detail = kunHandoffLogDetail(event)
  if (event.result === 'failed') logWarn('update-handoff', message, detail)
  else logInfo('update-handoff', message, detail)
}

function abbreviateBuildId(buildId: string): string {
  return buildId.length > 12 ? buildId.slice(0, 12) : buildId
}
