import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type {
  HarnessCapabilities,
  HarnessCapabilityKey
} from '../contracts/harness-capabilities.js'
import type { HarnessUsage } from './usage-for-turn.js'
import { nativeAgentNetworkStatus } from './native-agent-network.js'

/**
 * Admission matrix (02 §5.2): what each usage requires from a harness.
 * `sandbox: 'host'` demands Kun enforce the sandbox; 'isolated-or-native'
 * accepts a harness-native sandbox or a host-managed isolated worktree.
 */
export const ADMISSION_RULES: Record<
  HarnessUsage,
  {
    required: readonly HarnessCapabilityKey[]
    sandbox?: 'host' | 'isolated-or-native'
  }
> = {
  'one-to-one': { required: ['abort'] },
  'manager-worker': {
    required: ['abort', 'structuredStreaming'],
    sandbox: 'isolated-or-native'
  },
  'graph-worker': {
    required: ['abort', 'structuredStreaming', 'kunTools'],
    sandbox: 'isolated-or-native'
  },
  'graph-lead': { required: ['kunTools', 'nativeToolInterception'] },
  'room-execution': {
    required: ['kunTools', 'externalApproval', 'nativeToolInterception'],
    sandbox: 'host'
  },
  scheduled: { required: ['abort'] },
  im: { required: ['abort'] },
  'plan-build': { required: ['abort'], sandbox: 'isolated-or-native' },
  design: { required: ['kunTools'] }
}

export type HarnessAdmissionFailureCode =
  | 'harness_not_ready'
  | 'capability_missing'
  | 'sandbox_insufficient'

export type AdmissionResult =
  | { ok: true; effective: HarnessCapabilities; permissionMode: string }
  | {
      ok: false
      code: HarnessAdmissionFailureCode
      missing: HarnessCapabilityKey[]
      message: string
    }

function statusMessage(status: HarnessStatus): string {
  if (status.installed !== 'yes') {
    return status.message ?? `harness ${status.harnessId} is not installed`
  }
  if (status.login === 'signed-out') return `harness ${status.harnessId} is signed out`
  return `harness ${status.harnessId} is not ready`
}

function firstMissingMessage(
  effective: HarnessCapabilities,
  missing: readonly HarnessCapabilityKey[]
): string {
  const first = missing[0]
  const status = first ? effective.statuses[first] : undefined
  const detail =
    status && !status.supported ? status.message ?? status.messageKey : undefined
  return detail ?? `missing required capabilities: ${missing.join(', ')}`
}

/**
 * Host-side admission check (02 §5.3). Runs inside `HarnessRouter.resolve`
 * before a delegated turn starts; the caller maps `ok: false` onto a
 * HarnessAdmissionError so the turn ends with a readable failure.
 */
export function checkHarnessAdmission(input: {
  usage: HarnessUsage
  harness: HarnessDefinition
  effective: HarnessCapabilities
  status: HarnessStatus
  credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
  workspace: { isolated: boolean }
  requestedPermissionMode?: string
  unattended: boolean
  allowUnattendedFullAccess: boolean
}): AdmissionResult {
  if ((input.credentialMode ?? input.harness.credentialModes[0]) === 'native-login' &&
    nativeAgentNetworkStatus(input.harness).networkSource === 'explicit-required') {
    return { ok: false, code: 'harness_not_ready', missing: [],
      message: 'Native Agent system proxy rules require explicit proxy environment configuration. Open Agent connection settings and retry.' }
  }
  if (
    input.harness.transport !== 'native-loop' &&
    (input.status.installed !== 'yes' || input.status.versionSupported === false || input.status.ready === 'no' ||
      ((input.credentialMode ?? input.harness.credentialModes[0]) === 'native-login' && input.status.login === 'signed-out'))
  ) {
    return {
      ok: false,
      code: 'harness_not_ready',
      missing: [],
      message: statusMessage(input.status)
    }
  }
  const rule = ADMISSION_RULES[input.usage]
  const missing = rule.required.filter(
    (key) => !input.effective.statuses[key]?.supported
  )
  if (missing.length) {
    return {
      ok: false,
      code: 'capability_missing',
      missing,
      message: firstMissingMessage(input.effective, missing)
    }
  }
  if (rule.sandbox === 'host' && input.effective.facts.sandbox !== 'host') {
    return {
      ok: false,
      code: 'sandbox_insufficient',
      missing: [],
      message: 'harness sandbox cannot be enforced by Kun'
    }
  }
  if (
    rule.sandbox === 'isolated-or-native' &&
    input.effective.facts.sandbox === 'none' &&
    !input.workspace.isolated
  ) {
    return {
      ok: false,
      code: 'sandbox_insufficient',
      missing: [],
      message: 'harness without sandbox must run in an isolated worktree'
    }
  }
  return {
    ok: true,
    effective: input.effective,
    permissionMode: resolvePermissionMode(
      input.harness,
      input.requestedPermissionMode,
      input.unattended,
      input.allowUnattendedFullAccess
    )
  }
}

/**
 * Unknown requested levels fall back to permissionModes[0] (strictest).
 * Unattended turns keep a full-access level only when the user explicitly
 * enabled `agents.kun.ade.allowUnattendedFullAccess`; otherwise [0] too.
 */
export function resolvePermissionMode(
  def: HarnessDefinition,
  requested: string | undefined,
  unattended: boolean,
  allowUnattendedFullAccess: boolean
): string {
  const found = def.permissionModes.find((m) => m.id === requested)
  if (!found) return def.permissionModes[0]!.id
  if (
    unattended &&
    found.kunPermissionMode === 'full-access' &&
    !allowUnattendedFullAccess
  ) {
    return def.permissionModes[0]!.id
  }
  return found.id
}
