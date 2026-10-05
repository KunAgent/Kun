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
  const requested = input.requested?.trim()
  // Older Devin ACP versions call their approval-gated mode normal/auto.
  // Negotiate that mode only when the host allows writes with approval; newer
  // versions may narrow it to ask. An explicit read-only ask never widens.
  if (definition.id === 'devin' && !readOnly &&
    ((!requested && ceiling < 2) || requested === 'normal' || requested === 'auto')) return 'normal'
  if (requested) {
    const resolved = resolvePermissionMode(definition, requested, input.unattended, input.allowUnattendedFullAccess)
    return allowed.find((mode) => mode.id === resolved)?.id ?? allowed[0]!.id
  }
  // No native override: honor the permission the user selected in the composer,
  // instead of always forcing the first (often read-only) harness mode.
  return allowed.at(-1)!.id
}
