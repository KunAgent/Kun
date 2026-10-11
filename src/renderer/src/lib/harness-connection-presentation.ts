import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  harnessRowUnavailableCode,
  harnessUnavailableLabelKey,
  harnessUnavailableNextStepKey
} from '../store/harness-store'

/** The bundled Cursor SDK reads a provider route, not the Cursor CLI account. */
export function usesProviderOnlySdk(row: AdeHarnessRow): boolean {
  return row.definition.transport === 'cursor-sdk' &&
    row.definition.credentialModes.length === 1 && row.definition.credentialModes[0] === 'provider'
}

export function harnessConnectionPresentation(row: AdeHarnessRow): {
  code: string | null
  labelKey: string | null
  nextStepKey: string | null
  configureProvider: boolean
} {
  const code = harnessRowUnavailableCode(row)
  const configureProvider = usesProviderOnlySdk(row)
  if (configureProvider && (code === 'signed_out' || code === null)) {
    return { code, configureProvider, labelKey: code ? 'adeProviderSelectionRequired' : 'adeCredential.provider', nextStepKey: null }
  }
  return { code, configureProvider,
    labelKey: code ? harnessUnavailableLabelKey(code) : null,
    nextStepKey: code && code !== 'detecting' ? harnessUnavailableNextStepKey(code) : null }
}
