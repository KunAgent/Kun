import { parseCodexModelDescriptors } from '../../kun/src/services/provider-model-descriptors'

/** Main and Runtime share exactly the same account catalog parser. */
export function parseCodexModelCatalog(body: string) {
  const result = parseCodexModelDescriptors(body)
  return { modelIds: result.models, modelProfiles: result.modelProfiles }
}
