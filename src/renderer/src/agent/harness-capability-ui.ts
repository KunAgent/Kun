import type {
  CapabilityStatus,
  HarnessCapabilities,
  HarnessCapabilityKey
} from '@shared/harness-capabilities'
import type { DelegatedRuntimeState, HarnessRuntimeState } from './types'

/**
 * UI degrade contract for harness capability v2 (plan 02 §6.2). Components
 * call only these helpers; the mapping from capability keys to UI affordances
 * lives here. A missing snapshot means "runtime state has not arrived yet" —
 * helpers then preserve today's Kun-native behavior (affordance stays
 * enabled/visible) rather than degrading.
 *
 * Rule of thumb (02 §6.2): gray out before hiding; hide only when the
 * capability can never exist (`reason: 'upstream'`) and the affordance would
 * clutter the main path.
 */

type RuntimeCaps = DelegatedRuntimeState | HarnessRuntimeState | null | undefined

const capsOf = (runtime: RuntimeCaps): HarnessCapabilities | undefined =>
  runtime?.capabilitiesV2

const statusOf = (
  runtime: RuntimeCaps,
  key: HarnessCapabilityKey
): CapabilityStatus | undefined => capsOf(runtime)?.statuses[key]

/** True when supported or unknown; false only when explicitly unsupported. */
const available = (runtime: RuntimeCaps, key: HarnessCapabilityKey): boolean =>
  statusOf(runtime, key)?.supported !== false

/** Tooltip copy key for a capability that is unsupported; undefined otherwise. */
export function capabilityReason(
  runtime: RuntimeCaps,
  key: HarnessCapabilityKey
): 'upstream' | 'not-implemented' | 'platform' | undefined {
  const status = statusOf(runtime, key)
  return status && status.supported === false ? status.reason : undefined
}

/** Composer steer affordance: disabled when sameTurnSteer is unsupported. */
export function canSteer(runtime: RuntimeCaps): boolean {
  const caps = capsOf(runtime)
  if (!caps) {
    // Legacy fallback: DelegatedRuntimeState always carries the boolean bag.
    if (runtime && 'capabilities' in runtime) return runtime.capabilities.liveSteering
    return true
  }
  return caps.statuses.sameTurnSteer.supported === true
}

/** Stop button. An unadmitted abort-unsupported harness should not reach here. */
export function canAbort(runtime: RuntimeCaps): boolean {
  return available(runtime, 'abort')
}

/**
 * Mid-session model switching. When unsupported the picker shows only the
 * current model plus a "start a new conversation" entry.
 */
export function canSwitchModelMidSession(runtime: RuntimeCaps): boolean {
  return available(runtime, 'switchModelMidSession')
}

/** Effort control: hidden when effort is unsupported. */
export function showEffortControl(runtime: RuntimeCaps): boolean {
  return available(runtime, 'effort')
}

/** Plan-mode toggle: hidden when planMode is unsupported. */
export function showPlanModeToggle(runtime: RuntimeCaps): boolean {
  return available(runtime, 'planMode')
}

/** Harness mode icons (harness-native session modes like Claude's plan/bypass). */
export function showHarnessModeIcons(runtime: RuntimeCaps): boolean {
  return available(runtime, 'modes')
}

/** Harness-native slash commands in the slash menu. */
export function showHarnessSlashCommands(runtime: RuntimeCaps): boolean {
  return available(runtime, 'nativeCommands')
}

/** Image attachments: false restricts the attachment button to files. */
export function canAttachImages(runtime: RuntimeCaps): boolean {
  return available(runtime, 'imageInput')
}

/**
 * Kun-tool-backed entries (memory, canvas, worker callbacks). Without kunTools
 * support these entries must not appear for the conversation.
 */
export function kunToolsAvailable(runtime: RuntimeCaps): boolean {
  return available(runtime, 'kunTools')
}

/** Context capacity gauge: false shows "unknown" instead of an estimate. */
export function contextTelemetryKnown(runtime: RuntimeCaps): boolean {
  return available(runtime, 'nativeContextTelemetry')
}

/** Usage display: false shows "unavailable" rather than zero. */
export function usageReportingAvailable(runtime: RuntimeCaps): boolean {
  return capsOf(runtime)?.facts.usageReporting !== 'none'
}

/** Rewind menu affordance. */
export function canRewind(runtime: RuntimeCaps): boolean {
  return available(runtime, 'rewind')
}

/** Fork affordance. */
export function canFork(runtime: RuntimeCaps): boolean {
  return available(runtime, 'fork')
}

/**
 * "Approve for me": offered while the harness can relay Kun approvals.
 * Delegated runtimes without externalApproval support lose the option.
 */
export function canApproveForMe(runtime: RuntimeCaps): boolean {
  return available(runtime, 'externalApproval')
}
