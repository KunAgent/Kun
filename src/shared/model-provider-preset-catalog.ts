import type { ModelProviderPreset } from './model-provider-preset-types'
import { MODEL_PROVIDER_PRESETS_CORE } from './model-provider-preset-catalog-core'
import { MODEL_PROVIDER_PRESETS_EXTENDED } from './model-provider-preset-catalog-extended'
import { MODEL_PROVIDER_PRESETS_THIRDPARTY } from './model-provider-preset-catalog-thirdparty'

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  ...MODEL_PROVIDER_PRESETS_CORE,
  ...MODEL_PROVIDER_PRESETS_EXTENDED,
  ...MODEL_PROVIDER_PRESETS_THIRDPARTY
]
