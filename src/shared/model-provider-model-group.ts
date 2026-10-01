import type { ModelProviderModelProfileV1, ModelProviderProfileV1 } from './app-settings'

export type ModelProviderModelGroup = {
  providerId: string
  /** Actual runtime kind for legacy harness inference; never inferred from branding. */
  kind?: ModelProviderProfileV1['kind']
  /** Stable built-in preset identity; survives multi-account ids such as codex-2. */
  presetSource?: string
  label: string
  modelIds: string[]
  modelProfiles?: Record<string, ModelProviderModelProfileV1>
  nativeHarnessId?: string
  modelInfo?: Record<string, import('../../kun/src/contracts/harness-models').HarnessModelInfo>
  /** Opaque account reference used only for an acknowledged extension binding. */
  accountId?: string
  extensionProvider?: {
    extensionId: string
    extensionVersion: string
    localProviderId: string
  }
}
