import type {
  AdeHarnessCommand,
  AdeHarnessCredentialMode,
  AdeHarnessProviderModelGroup,
  AdeHarnessRow
} from '@shared/ade-harnesses'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { MODEL_REASONING_EFFORTS, type ModelReasoningEffort, type ModelProviderModelProfileV1 } from '@shared/app-settings'
import type { HarnessModelInfo } from '../../../../kun/src/contracts/harness-models'

export function harnessModelProfiles(models: readonly HarnessModelInfo[] = [], nativeReasoning = false): Record<string, ModelProviderModelProfileV1> {
  return Object.fromEntries(models.flatMap((model) => {
    if (!model.inputModalities) return []
    const inputModalities = model.inputModalities.filter((value): value is 'text' | 'image' => value === 'text' || value === 'image')
    return [[model.id, { inputModalities, outputModalities: ['text'], supportsToolCalling: true,
      messageParts: inputModalities.includes('image') ? ['text', 'image_url', 'input_image'] : ['text'],
      ...(nativeReasoning ? { reasoning: {
        supportedEfforts: (model.reasoningEfforts ?? []).filter((effort): effort is ModelReasoningEffort => MODEL_REASONING_EFFORTS.includes(effort as ModelReasoningEffort)),
        defaultEffort: MODEL_REASONING_EFFORTS.includes(model.defaultReasoningEffort as ModelReasoningEffort) ? model.defaultReasoningEffort as ModelReasoningEffort : 'auto' as const,
        requestProtocol: 'none' as const } } : {}) } satisfies ModelProviderModelProfileV1]]
  }))
}

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

/**
 * Sentinel group keys are `ade-cred:<mode>` for native sign-in and
 * `ade-cred:<mode>:<providerId>` for the per-provider groups provider-backed
 * modes list. Returns the credential mode plus the addressed provider.
 */
export function credentialGroupFromKey(
  groupKey: string | undefined
): { mode: AdeHarnessCredentialMode; providerId?: string } | null {
  const raw = groupKey?.trim() ?? ''
  if (!raw.startsWith(ADE_CREDENTIAL_GROUP_PREFIX)) return null
  const rest = raw.slice(ADE_CREDENTIAL_GROUP_PREFIX.length)
  const sep = rest.indexOf(':')
  const mode = (sep === -1 ? rest : rest.slice(0, sep)) as AdeHarnessCredentialMode
  if (mode !== 'native-login' && mode !== 'provider' && mode !== 'kun-gateway') return null
  const providerId = sep === -1 ? undefined : rest.slice(sep + 1)
  return providerId === '' ? null : { mode, providerId }
}

/** Resolve the harness a turn on this thread would use (store → thread → kun). */
export function effectiveHarnessId(
  composerHarnessId: string,
  threadHarnessId: string | undefined,
  providerKind?: ModelProviderModelGroup['kind']
): string {
  const legacy = providerKind === 'agent-sdk' ? 'claude-code'
    : providerKind === 'cursor-sdk' ? 'cursor'
      : providerKind === 'antigravity-cli' ? 'antigravity' : 'kun'
  return composerHarnessId.trim() || threadHarnessId?.trim() || legacy
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
 * Synthesize pick-list groups: `native-login` lists the harness's own models;
 * `provider`/`kun-gateway` list one group per exposable configured provider
 * (P3-05) so a picked entry pins both the credential mode and the provider —
 * the raw model id plus `providerId` resolves to the `kun/<provider>/<model>`
 * route in `parseGatewayModelId` semantics. Provider modes stay hidden when
 * no provider is configured or none are exposable.
 */
export function adeHarnessModelGroups(input: {
  row: AdeHarnessRow | undefined
  models: readonly string[]
  modelInfo?: readonly HarnessModelInfo[]
  providerGroups?: readonly AdeHarnessProviderModelGroup[]
  labels: AdeCredentialGroupLabels
  hasConfiguredProvider: boolean
}): ModelProviderModelGroup[] {
  const { row, models, providerGroups = [], labels, hasConfiguredProvider } = input
  if (!row) return []
  const labelFor: Record<AdeHarnessCredentialMode, string> = {
    'native-login': labels.nativeLogin,
    provider: labels.provider,
    'kun-gateway': labels.kunGateway
  }
  const groups: ModelProviderModelGroup[] = []
  for (const mode of row.definition.credentialModes) {
    if (mode === 'native-login') {
      groups.push({
        providerId: credentialGroupKey(mode),
        label: labelFor[mode],
        modelIds: [...models],
        ...(input.modelInfo ? { modelProfiles: harnessModelProfiles(input.modelInfo, row.definition.id === 'devin') } : {}),
        ...(input.modelInfo ? { nativeHarnessId: row.definition.id,
          modelInfo: Object.fromEntries(input.modelInfo.map((entry) => [entry.id, entry])) } : {})
      })
      continue
    }
    if (!hasConfiguredProvider) continue
    for (const provider of providerGroups) {
      if (provider.models.length === 0) continue
      groups.push({
        providerId: `${credentialGroupKey(mode)}:${provider.providerId}`,
        label: `${labelFor[mode]} · ${provider.label}`,
        modelIds: [...provider.models],
        ...(provider.modelInfo ? { modelProfiles: harnessModelProfiles(provider.modelInfo) } : {})
      })
    }
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
 * explicit override wins, else an eligible Code composer selection applies.
 * An unpinned legacy Code send retains runtime provider-kind inference.
 */
export function resolveSendHarnessSelection(args: {
  queued?: { harnessId?: string; credentialMode?: string } | undefined
  overrides?: { harnessId?: string; credentialMode?: string } | undefined
  adeEligible: boolean
  composerHarnessId: string
  composerCredentialMode: string
}): { harnessId: string; credentialMode: string } {
  if (args.queued) {
    return { harnessId: args.queued.harnessId?.trim() ?? '', credentialMode: args.queued.credentialMode?.trim() ?? '' }
  }
  const harnessId = args.overrides?.harnessId?.trim() ||
    (args.adeEligible ? args.composerHarnessId?.trim() ?? '' : '')
  const credentialMode = harnessId
    ? args.overrides?.credentialMode?.trim() ||
      args.composerCredentialMode?.trim() || ''
    : ''
  return { harnessId, credentialMode }
}
