import type { DelegatedRuntimeCapabilities } from '../runtime/delegated-turn-runtime.js'
import {
  HARNESS_CAPABILITY_KEYS,
  type CapabilityStatus,
  type HarnessCapabilities
} from '../contracts/harness-capabilities.js'

const SANDBOX_STRENGTH = { none: 0, native: 1, host: 2 } as const
const USAGE_STRENGTH = { none: 0, estimated: 1, exact: 2 } as const

export function weakestSandbox(
  values: readonly HarnessCapabilities['facts']['sandbox'][]
): HarnessCapabilities['facts']['sandbox'] {
  return values.reduce(
    (weakest, value) => (SANDBOX_STRENGTH[value] < SANDBOX_STRENGTH[weakest] ? value : weakest),
    'host'
  )
}

export function weakestUsage(
  values: readonly HarnessCapabilities['facts']['usageReporting'][]
): HarnessCapabilities['facts']['usageReporting'] {
  return values.reduce(
    (weakest, value) => (USAGE_STRENGTH[value] < USAGE_STRENGTH[weakest] ? value : weakest),
    'exact'
  )
}

/**
 * Intersect capability layers; the first layer reporting a capability as
 * unsupported wins so the tooltip states the most fundamental restriction.
 */
export function intersectCapabilities(...layers: HarnessCapabilities[]): HarnessCapabilities {
  const statuses = {} as Record<(typeof HARNESS_CAPABILITY_KEYS)[number], CapabilityStatus>
  for (const key of HARNESS_CAPABILITY_KEYS) {
    statuses[key] = layers.map((l) => l.statuses[key]).find((s) => !s.supported) ?? {
      supported: true
    }
  }
  return {
    statuses,
    facts: {
      sandbox: weakestSandbox(layers.map((l) => l.facts.sandbox)),
      usageReporting: weakestUsage(layers.map((l) => l.facts.usageReporting)),
      compactionOwner: layers[layers.length - 1]!.facts.compactionOwner
    }
  }
}

/** Derive v2 capability statuses from the legacy boolean bag reported by existing runtimes. */
export function capabilitiesV2FromLegacy(
  legacy: DelegatedRuntimeCapabilities,
  base: HarnessCapabilities
): HarnessCapabilities {
  const upstream = (ref: string): CapabilityStatus => ({
    supported: false,
    reason: 'upstream',
    upstreamRef: ref
  })
  return intersectCapabilities(base, {
    statuses: {
      ...base.statuses,
      nativeResume: legacy.nativeResume ? { supported: true } : upstream('runtime'),
      structuredStreaming: legacy.structuredStreaming
        ? { supported: true }
        : upstream('runtime'),
      kunTools: legacy.kunTools ? { supported: true } : upstream('runtime'),
      externalApproval: legacy.externalApproval ? { supported: true } : upstream('runtime'),
      sameTurnSteer: legacy.liveSteering ? { supported: true } : upstream('runtime'),
      nativeContextTelemetry: legacy.nativeContextTelemetry
        ? { supported: true }
        : upstream('runtime'),
      fork: legacy.fork ? { supported: true } : upstream('runtime')
    },
    facts: base.facts
  })
}
