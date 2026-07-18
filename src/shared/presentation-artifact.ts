export const PRESENTATION_STUDIO_EXTENSION_ID = 'kun-examples.presentation-studio'

export const PRESENTATION_STUDIO_WRITE_TOOL_NAMES = [
  'presentation-create',
  'presentation-apply',
  'presentation-export-copy'
] as const

export type PresentationStudioWriteToolName = typeof PRESENTATION_STUDIO_WRITE_TOOL_NAMES[number]

export function presentationStudioCanonicalToolId(name: PresentationStudioWriteToolName): string {
  return `extension:${PRESENTATION_STUDIO_EXTENSION_ID}/${name}`
}

// extensionToolModelAlias hashes the stable extension id with SHA-256. Keeping
// the namespace here lets the renderer recognize direct calls without trusting
// a tool-controlled output field. Gateway calls carry the canonical id instead.
const PRESENTATION_STUDIO_MODEL_ALIAS_NAMESPACE = 'e1d66f1c97'

export function presentationStudioModelAlias(name: PresentationStudioWriteToolName): string {
  return `ext_${PRESENTATION_STUDIO_MODEL_ALIAS_NAMESPACE}_${name}`
}
