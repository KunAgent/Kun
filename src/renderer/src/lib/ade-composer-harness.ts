import type {
  AdeHarnessCommand,
  AdeHarnessCredentialMode,
  AdeHarnessRow
} from '@shared/ade-harnesses'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

/**
 * ADE composer harness/model resolution (docs/ade/12 §7.2).
 *
 * Harness model catalogs are flat id lists; the composer regroups them by
 * `credentialModes` so a harness that supports both its native subscription
 * and Kun's provider/gateway shows one section per credential path. Group
 * providerIds are sentinel keys — `credentialModeFromGroupKey` maps them back
 * to the wire `credentialMode` the turn request carries.
 */

export const ADE_CREDENTIAL_GROUP_PREFIX = 'ade-cred:'

export function credentialGroupKey(mode: AdeHarnessCredentialMode): string {
  return `${ADE_CREDENTIAL_GROUP_PREFIX}${mode}`
}

export function credentialModeFromGroupKey(
  groupKey: string | undefined
): AdeHarnessCredentialMode | null {
  const raw = groupKey?.trim() ?? ''
  if (!raw.startsWith(ADE_CREDENTIAL_GROUP_PREFIX)) return null
  const mode = raw.slice(ADE_CREDENTIAL_GROUP_PREFIX.length)
  return mode === 'native-login' || mode === 'provider' || mode === 'kun-gateway'
    ? mode
    : null
}

/** Resolve the harness a turn on this thread would use (store → thread → kun). */
export function effectiveHarnessId(
  composerHarnessId: string,
  threadHarnessId: string | undefined
): string {
  return composerHarnessId.trim() || threadHarnessId?.trim() || 'kun'
}

/** The native Kun loop keeps the provider-registry model groups untouched. */
export function harnessUsesProviderGroups(harnessId: string): boolean {
  return effectiveHarnessId(harnessId, undefined) === 'kun'
}

export type AdeCredentialGroupLabels = {
  nativeLogin: string
  provider: string
  kunGateway: string
}

/**
 * Synthesize pick-list groups: one per credential mode the harness declares,
 * filtered to modes that can actually work. `provider`/`kun-gateway` modes
 * stay available only when a configured provider exists to route through.
 */
export function adeHarnessModelGroups(input: {
  row: AdeHarnessRow | undefined
  models: readonly string[]
  labels: AdeCredentialGroupLabels
  hasConfiguredProvider: boolean
}): ModelProviderModelGroup[] {
  const { row, models, labels, hasConfiguredProvider } = input
  if (!row) return []
  const labelFor: Record<AdeHarnessCredentialMode, string> = {
    'native-login': labels.nativeLogin,
    provider: labels.provider,
    'kun-gateway': labels.kunGateway
  }
  const groups: ModelProviderModelGroup[] = []
  for (const mode of row.definition.credentialModes) {
    if (mode !== 'native-login' && !hasConfiguredProvider) continue
    groups.push({
      providerId: credentialGroupKey(mode),
      label: labelFor[mode],
      modelIds: [...models]
    })
  }
  return groups
}

/** Credential mode for a route when the user never picked one explicitly. */
export function defaultCredentialModeForRow(row: AdeHarnessRow | undefined): string {
  return row?.definition.credentialModes[0] ?? ''
}

/**
 * Whether switching harness/model on a thread that already has turns needs
 * the handoff confirmation (12 §7.2): the runtime opens a fresh native
 * session and carries context via the deterministic handoff brief.
 */
export function harnessSwitchNeedsConfirmation(input: {
  threadHasUserMessages: boolean
  currentHarnessId: string
  nextHarnessId: string
}): boolean {
  const next = input.nextHarnessId.trim() || 'kun'
  const current = input.currentHarnessId.trim() || 'kun'
  return input.threadHasUserMessages && next !== current
}

/** Model ids grouped under the picker's harness section for a native command. */
export function harnessSlashCommandText(command: AdeHarnessCommand): string {
  const name = command.name.trim()
  return name.startsWith('/') ? name : `/${name}`
}

/**
 * Resolve the harness/credential pair for one submission: a frozen queued or
 * explicit override wins, else the composer selection applies to ADE threads
 * (and ADE-route new sessions) only — Code sends never carry these fields.
 */
export function resolveSendHarnessSelection(args: {
  queued?: { harnessId?: string; credentialMode?: string } | undefined
  overrides?: { harnessId?: string; credentialMode?: string } | undefined
  adeEligible: boolean
  composerHarnessId: string
  composerCredentialMode: string
}): { harnessId: string; credentialMode: string } {
  const harnessId = args.queued?.harnessId?.trim() || args.overrides?.harnessId?.trim() ||
    (args.adeEligible ? args.composerHarnessId.trim() : '')
  const credentialMode = harnessId
    ? args.queued?.credentialMode?.trim() || args.overrides?.credentialMode?.trim() ||
      args.composerCredentialMode.trim()
    : ''
  return { harnessId, credentialMode }
}
