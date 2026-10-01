import type { WorkbenchExecution } from '@shared/rooms-api'
import type { AdeHarnessRow, AdeHarnessProviderModelGroup } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1 } from '@shared/app-settings-types-kun-runtime'
import { credentialGroupFromKey, credentialGroupKey } from '../../lib/ade-composer-harness'
import { selectHarnessProvider } from '../../lib/harness-provider-selection'

export type WorkbenchModel = NonNullable<WorkbenchExecution['model']>
export const workbenchHarnessId = (model?: WorkbenchModel): string => model?.harnessId || 'kun'
export const workbenchExternalAgent = (model?: WorkbenchModel): boolean => workbenchHarnessId(model) !== 'kun'

/** A card owns its route. Switching engines must never carry another engine's model or credentials. */
export function selectWorkbenchAgent(input: {
  row: AdeHarnessRow
  defaults?: KunHarnessDefaultsEntryV1
  nativeModels: string[]
  nativeDefault?: string
  providerGroups: AdeHarnessProviderModelGroup[]
  previous?: WorkbenchModel
}): WorkbenchModel {
  const { row, defaults } = input
  const harnessId = row.definition.id
  const credentialMode = defaults?.credentialMode && row.definition.credentialModes.includes(defaults.credentialMode)
    ? defaults.credentialMode : row.definition.credentialModes[0]
  if (credentialMode === 'native-login') return {
    harnessId, credentialMode, model: defaults?.model || input.nativeDefault || input.nativeModels[0] || ''
  }
  const selected = selectHarnessProvider(input.providerGroups, defaults, input.previous ?? {})
  return { harnessId, credentialMode, model: selected.model,
    ...(selected.providerId ? { providerId: selected.providerId } : {}) }
}

export function workbenchModelGroup(model?: WorkbenchModel): string {
  if (!model || !workbenchExternalAgent(model)) return model?.providerId ?? ''
  const mode = model.credentialMode ?? 'native-login'
  return mode === 'native-login' ? credentialGroupKey(mode)
    : `${credentialGroupKey(mode)}:${model.providerId ?? ''}`
}

/** Decode the same credential-qualified model groups used in Code. */
export function selectWorkbenchModel(previous: WorkbenchModel | undefined, model: string, groupId: string,
  accountId?: string): WorkbenchModel {
  const credential = credentialGroupFromKey(groupId)
  return {
    model, harnessId: workbenchHarnessId(previous),
    ...(credential ? { credentialMode: credential.mode,
      ...(credential.mode !== 'native-login' && credential.providerId ? { providerId: credential.providerId } : {}) }
      : { providerId: groupId, credentialMode: 'provider' as const }),
    ...(accountId ? { accountId } : {})
  }
}

export function workbenchModelComplete(model?: WorkbenchModel): boolean {
  if (!model) return true // No override: the native runtime uses its configured model.
  return Boolean(model.model.trim() && (model.credentialMode === 'native-login' || model.providerId?.trim()))
}
