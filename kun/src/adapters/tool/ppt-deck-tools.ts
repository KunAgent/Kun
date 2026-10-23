import type { LocalTool } from './local-tool-host.js'
import { createPptImportAssetTool, PPT_IMPORT_ASSET_TOOL_NAME } from './ppt-deck-asset-tool.js'
import { createPptExportTool, PPT_EXPORT_TOOL_NAME } from './ppt-deck-export-tool.js'
import { createPptPreviewTool, PPT_PREVIEW_TOOL_NAME } from './ppt-deck-preview-tool.js'
import type { PptDeckToolOptions } from './ppt-deck-tool-support.js'

export { PPT_EXPORT_TOOL_NAME, PPT_IMPORT_ASSET_TOOL_NAME, PPT_PREVIEW_TOOL_NAME }
export type { PptDeckToolOptions }

export const PPT_DECK_PROVIDER_ID = 'ppt-deck' as const

/**
 * The three deterministic tools behind the `slides` skill. Agents author the
 * PPTD deck with their ordinary file tools; these only render previews, copy
 * image bytes, and export plus verify the PPTX. They are keyed by deck path,
 * hold no workflow state, and remain available without an experimental switch.
 */
export function buildPptDeckTools(options: PptDeckToolOptions = {}): LocalTool[] {
  return [
    createPptPreviewTool(options),
    createPptExportTool(options),
    createPptImportAssetTool(options)
  ]
}
