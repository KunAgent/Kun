/**
 * Renderer-side copy of the harness capability contracts and pure functions.
 * `src/` must not import from `kun/`; keep this file and
 * `kun/src/harness/effective-capabilities.ts` semantically identical — they are
 * verified against the same JSON fixtures.
 */

export type CapabilityStatus =
  | { supported: true }
  | {
      supported: false
      reason: 'upstream' | 'not-implemented' | 'platform'
      upstreamRef?: string
      messageKey?: string
      message?: string
    }

export const HARNESS_CAPABILITY_KEYS = [
  'nativeResume',
  'fork',
  'rewind',
  'structuredStreaming',
  'reasoningStream',
  'abort',
  'sameTurnSteer',
  'switchModelMidSession',
  'setPermissionModeMidSession',
  'effort',
  'planMode',
  'manualCompact',
  'kunTools',
  'externalApproval',
  'nativeToolInterception',
  'fsMediated',
  'terminalMediated',
  'nativeContextTelemetry',
  'imageInput',
  'fileInput',
  'nativeCommands',
  'modes',
  'userInput'
] as const
export type HarnessCapabilityKey = (typeof HARNESS_CAPABILITY_KEYS)[number]

export type HarnessCapabilities = {
  statuses: Record<HarnessCapabilityKey, CapabilityStatus>
  facts: {
    sandbox: 'host' | 'native' | 'none'
    usageReporting: 'exact' | 'estimated' | 'none'
    compactionOwner: 'kun' | 'harness' | 'none'
  }
}

/** The legacy boolean bag reported by DelegatedTurnRuntime.capabilities(). */
export type LegacyDelegatedRuntimeCapabilities = {
  nativeResume: boolean
  structuredStreaming: boolean
  kunTools: boolean
  externalApproval: boolean
  liveSteering: boolean
  nativeContextTelemetry: boolean
  fork: boolean
}

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

export function intersectCapabilities(...layers: HarnessCapabilities[]): HarnessCapabilities {
  const statuses = {} as Record<HarnessCapabilityKey, CapabilityStatus>
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

export function capabilitiesV2FromLegacy(
  legacy: LegacyDelegatedRuntimeCapabilities,
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

/**
 * Conservative base for deriving v2 capabilities from a legacy boolean bag when
 * the wire event predates `capabilitiesV2`: the seven keys covered by the
 * legacy bag come out supported-or-upstream, everything else stays
 * not-implemented, and the facts report the weakest levels.
 */
export const LEGACY_DERIVATION_BASE: HarnessCapabilities = {
  statuses: Object.fromEntries(
    HARNESS_CAPABILITY_KEYS.map((key) => [
      key,
      { supported: false, reason: 'not-implemented' }
    ])
  ) as Record<HarnessCapabilityKey, CapabilityStatus>,
  facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'none' }
}

const CAPABILITY_REASONS = new Set(['upstream', 'not-implemented', 'platform'])
const SANDBOX_FACTS = new Set(['host', 'native', 'none'])
const USAGE_FACTS = new Set(['exact', 'estimated', 'none'])
const OWNER_FACTS = new Set(['kun', 'harness', 'none'])

function isCapabilityStatus(value: unknown): value is CapabilityStatus {
  if (typeof value !== 'object' || value === null) return false
  const status = value as CapabilityStatus
  if (status.supported === true) return true
  if (status.supported !== false) return false
  return typeof status.reason === 'string' && CAPABILITY_REASONS.has(status.reason)
}

/** Structural validator for `capabilitiesV2` arriving over the wire. */
export function isHarnessCapabilities(value: unknown): value is HarnessCapabilities {
  if (typeof value !== 'object' || value === null) return false
  const caps = value as HarnessCapabilities
  if (typeof caps.statuses !== 'object' || caps.statuses === null) return false
  if (typeof caps.facts !== 'object' || caps.facts === null) return false
  const { sandbox, usageReporting, compactionOwner } = caps.facts
  if (!SANDBOX_FACTS.has(sandbox) || !USAGE_FACTS.has(usageReporting) || !OWNER_FACTS.has(compactionOwner)) {
    return false
  }
  return HARNESS_CAPABILITY_KEYS.every((key) => isCapabilityStatus(caps.statuses[key]))
}
