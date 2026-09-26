import type { GeneratedFileReference } from './types'
import type { CoreTurnItemJson } from './kun-contract-runtime'
import { normalizeGeneratedFileReference, structuredPayloadsFor } from './kun-mapper-core'

export const GENERATED_FILE_TOOL_NAMES = new Set([
  'generate_image',
  'generate_speech',
  'generate_music',
  'generate_video'
])

export function isGeneratedFileToolName(toolName: string | undefined): boolean {
  const name = toolName?.trim()
  if (!name) return false
  if (GENERATED_FILE_TOOL_NAMES.has(name)) return true
  const bridgedName = name.split('__').at(-1)
  return Boolean(bridgedName && GENERATED_FILE_TOOL_NAMES.has(bridgedName))
}

export function extractToolGeneratedFiles(item: CoreTurnItemJson): GeneratedFileReference[] | undefined {
  if (item.kind !== 'tool_result') return undefined
  const payloads = structuredPayloadsFor(item)
  const candidates = [
    ...payloads.flatMap((payload) =>
      Array.isArray(payload.generatedFiles) ? payload.generatedFiles : []
    ),
    ...payloads.flatMap((payload) =>
      Array.isArray(payload.generatedArtifacts) ? payload.generatedArtifacts : []
    ),
    ...(isGeneratedFileToolName(item.toolName)
      ? payloads.flatMap((payload) => Array.isArray(payload.files) ? payload.files : [])
      : [])
  ]
  const generatedFiles: GeneratedFileReference[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const normalized = normalizeGeneratedFileReference(candidate)
    if (!normalized) continue
    const key =
      normalized.artifactId ??
      normalized.id ??
      normalized.absolutePath ??
      normalized.relativePath ??
      normalized.path ??
      normalized.previewUrl ??
      normalized.name
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    generatedFiles.push(normalized)
  }
  return generatedFiles.length > 0 ? generatedFiles : undefined
}
