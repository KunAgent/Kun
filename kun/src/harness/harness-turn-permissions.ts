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
  // Older Devin ACP versions call their approval-gated mode normal/auto.
  // Negotiate that mode only when the host allows writes with approval; newer
  // versions may narrow it to ask. An explicit read-only ask never widens.
  if (definition.id === 'devin' && !readOnly) {
    // Reviewer-approved host scope maps to Devin's Smart mode; older CLIs
    // without it fall back to the legacy approval mode, then read-only Ask.
    if (!requested && ceiling === 1) return 'smart'
    if ((!requested && ceiling < 1) || requested === 'normal' || requested === 'auto') return 'normal'
  }
  if (requested) {
    const resolved = resolvePermissionMode(definition, requested, input.unattended, input.allowUnattendedFullAccess)
    return allowed.find((mode) => mode.id === resolved)?.id ?? allowed[0]!.id
  }
  // No native override: honor the permission the user selected in the composer,
  // instead of always forcing the first (often read-only) harness mode.
  return allowed.at(-1)!.id
}
