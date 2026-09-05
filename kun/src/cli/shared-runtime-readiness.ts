import type {
  SharedRuntimeConnection,
  SharedRuntimeInspection
} from './shared-runtime.js'
import type { SharedRuntimeLaunchObservation } from './shared-runtime-launch.js'

type SharedRuntimeReadinessInput = {
  inspect: () => Promise<SharedRuntimeInspection | null>
  reusable: (inspected: SharedRuntimeInspection | null) => SharedRuntimeConnection | null
  compatibleStarting: (inspected: SharedRuntimeInspection | null) => boolean
}

/**
 * Manager registration is an ownership fence, not a readiness marker. A
 * managed Runtime becomes attachable only after the same instance publishes
 * discovery following restart reconciliation.
 */
export function createSharedRuntimeReadiness(input: SharedRuntimeReadinessInput): {
  published(): Promise<SharedRuntimeConnection | null>
  canFinish(inspected: SharedRuntimeInspection | null): boolean
  observe(): Promise<SharedRuntimeLaunchObservation<SharedRuntimeConnection>>
} {
  const published = async (): Promise<SharedRuntimeConnection | null> => {
    const inspected = await input.inspect()
    return inspected?.published === false ? null : input.reusable(inspected)
  }

  const canFinish = (inspected: SharedRuntimeInspection | null): boolean =>
    input.reusable(inspected) !== null || input.compatibleStarting(inspected)

  const observe = async (): Promise<
    SharedRuntimeLaunchObservation<SharedRuntimeConnection>
  > => {
    const inspected = await input.inspect()
    const ready = inspected?.published === false ? null : input.reusable(inspected)
    if (ready) return { kind: 'ready', value: ready, ownerPid: ready.discovery.pid }
    if (!inspected) return { kind: 'vacant' }
    if (input.compatibleStarting(inspected)) return { kind: 'starting' }
    if (!inspected.connection) {
      return {
        kind: 'blocked',
        error: new Error(
          `Kun shared runtime process ${inspected.discovery.pid} is still alive but is not responding; ` +
          'preserving its discovery record instead of starting a second runtime'
        )
      }
    }
    return {
      kind: 'blocked',
      error: new Error(
        `Kun shared runtime process ${inspected.discovery.pid} claimed the Runtime slot ` +
        'with an incompatible build during startup'
      )
    }
  }

  return { published, canFinish, observe }
}
