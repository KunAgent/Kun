import type { ComponentPrototypeMetadata } from '../agent/types'
import {
  importConversationHtmlToDesignCanvas,
  type ConversationHtmlCanvasImportResult
} from './conversation-html-canvas-import'

export type ComponentPrototypeCanvasImportResult = ConversationHtmlCanvasImportResult

const COMPONENT_PROTOTYPE_PATH_RE = /^\.kun-design\/component-prototypes\/[^/]+\/prototype\.html$/i

/** Compatibility wrapper for existing component prototype callers. */
export function importComponentPrototypeToDesignCanvas(options: {
  workspaceRoot: string
  prototype: ComponentPrototypeMetadata
}): Promise<ComponentPrototypeCanvasImportResult | null> {
  return importConversationHtmlToDesignCanvas({
    workspaceRoot: options.workspaceRoot,
    source: options.prototype,
    allowedPath: COMPONENT_PROTOTYPE_PATH_RE
  })
}
