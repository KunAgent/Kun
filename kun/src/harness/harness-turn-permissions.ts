import { providerModule } from './providers/registry.js'
import { KUN_TOOL_PERMISSION_MODES, kunToolPermissionModeFromSettings, type ApprovalPolicy,
  type ApprovalReviewer, type SandboxMode } from '../contracts/policy.js'
import type { HarnessDefinition } from '../contracts/harness.js'
import { resolvePermissionMode } from './harness-admission.js'
import { HarnessTransportError } from '../session/harness-session.js'

/** The captured turn policy is the ceiling; native defaults cannot expand it. */
export function harnessTurnPermissionMode(definition: HarnessDefinition, input: {
  requested?: string; approvalPolicy?: ApprovalPolicy; sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer; unattended: boolean; allowUnattendedFullAccess: boolean
}): string {
  const host = kunToolPermissionModeFromSettings({ approvalPolicy: input.approvalPolicy ?? 'on-request',
    sandboxMode: input.sandboxMode ?? 'workspace-write', approvalReviewer: input.approvalReviewer })
  const readOnly = input.sandboxMode === 'read-only' || (input.unattended && !input.allowUnattendedFullAccess)
  const ceiling = readOnly
    ? 0 : KUN_TOOL_PERMISSION_MODES.indexOf(host)
  const allowed = definition.permissionModes.filter((mode) => KUN_TOOL_PERMISSION_MODES.indexOf(mode.kunPermissionMode) <= ceiling)
  if (!allowed.length) throw new HarnessTransportError('policy_denied',
    `${definition.displayName} has no permission mode within the current task's allowed scope`)
  // Equal Kun upper bounds do not make native modes equally strict: plan may
  // forbid writes while default still allows them after an external approval.
  if (readOnly) return allowed[0]!.id
  const requested = input.requested?.trim()
  // An engine may map the writable scope onto its own native modes first.
  const native = providerModule(definition.id)?.permissionMode?.({ requested, ceiling })
  if (native) return native
  if (requested) {
    const resolved = resolvePermissionMode(definition, requested, input.unattended, input.allowUnattendedFullAccess)
    return allowed.find((mode) => mode.id === resolved)?.id ?? allowed[0]!.id
  }
  // No native override: honor the permission the user selected in the composer,
  // instead of always forcing the first (often read-only) harness mode.
  return allowed.at(-1)!.id
}

/**
 * Native Agent picked in the composer (OpenCode primary agents). It replaces
 * the permission-mapped session mode and runs under that Agent's own tool
 * rules, so a read-only captured policy ignores it and keeps the strictest mode.
 */
export function harnessTurnNativeAgent(definition: HarnessDefinition, input: {
  requested?: string; sandboxMode?: SandboxMode; unattended: boolean; allowUnattendedFullAccess: boolean
}): string | undefined {
  if (definition.nativeAgents !== 'session-modes') return undefined
  const requested = input.requested?.trim()
  if (!requested) return undefined
  if (input.sandboxMode === 'read-only' || (input.unattended && !input.allowUnattendedFullAccess)) return undefined
  return requested
}
