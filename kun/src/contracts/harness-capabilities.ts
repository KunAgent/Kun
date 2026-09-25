import { z } from 'zod'

export const CapabilityStatusSchema = z.discriminatedUnion('supported', [
  z.object({ supported: z.literal(true) }).strict(),
  z
    .object({
      supported: z.literal(false),
      /**
       * upstream: the harness itself does not have it; not-implemented: Kun has
       * not wired it yet; platform: current platform/version/login state.
       */
      reason: z.enum(['upstream', 'not-implemented', 'platform']),
      upstreamRef: z.string().max(256).optional(),
      /** i18n key preferred; falls back to `message` text. */
      messageKey: z.string().max(128).optional(),
      message: z.string().max(256).optional()
    })
    .strict()
])
export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>

export const HARNESS_CAPABILITY_KEYS = [
  // Session
  'nativeResume',
  'fork',
  'rewind',
  // Streaming and control
  'structuredStreaming',
  'reasoningStream',
  'abort',
  'sameTurnSteer',
  'switchModelMidSession',
  'setPermissionModeMidSession',
  'effort',
  'planMode',
  'manualCompact',
  // Tools and mediation
  'kunTools',
  'externalApproval',
  'nativeToolInterception',
  'fsMediated',
  'terminalMediated',
  // Context and input
  'nativeContextTelemetry',
  'imageInput',
  'fileInput',
  'nativeCommands',
  'modes',
  // Collaboration
  'userInput'
] as const
export type HarnessCapabilityKey = (typeof HARNESS_CAPABILITY_KEYS)[number]

const CapabilityStatusesSchema = z
  .object(
    Object.fromEntries(
      HARNESS_CAPABILITY_KEYS.map((key) => [key, CapabilityStatusSchema])
    ) as Record<HarnessCapabilityKey, typeof CapabilityStatusSchema>
  )
  .strict()
export type HarnessCapabilityStatuses = z.infer<typeof CapabilityStatusesSchema>

export const HarnessCapabilitiesSchema = z
  .object({
    statuses: CapabilityStatusesSchema,
    /** Fact dimensions that are not boolean capabilities. */
    facts: z
      .object({
        /** host: Kun sandbox applies; native: harness sandbox; none: neither. */
        sandbox: z.enum(['host', 'native', 'none']),
        usageReporting: z.enum(['exact', 'estimated', 'none']),
        compactionOwner: z.enum(['kun', 'harness', 'none'])
      })
      .strict()
  })
  .strict()
export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>

export const SUPPORTED: CapabilityStatus = { supported: true }

export function unsupported(
  reason: 'upstream' | 'not-implemented' | 'platform',
  extra?: { upstreamRef?: string; messageKey?: string; message?: string }
): CapabilityStatus {
  return { supported: false, reason, ...extra }
}

export function allSupportedStatuses(): HarnessCapabilityStatuses {
  return Object.fromEntries(
    HARNESS_CAPABILITY_KEYS.map((key) => [key, SUPPORTED])
  ) as HarnessCapabilityStatuses
}
