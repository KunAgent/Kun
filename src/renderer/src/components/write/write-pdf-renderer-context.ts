import { createContext, useContext, type ComponentType, type RefObject } from 'react'
import type { WriteEditorSelectionState } from './WriteMarkdownEditor'
import { WritePdfViewer } from './WritePdfViewer'

/** Props every Work-surface PDF renderer must accept. */
export type WritePdfRendererProps = {
  filePath: string
  dataBase64: string
  size: number
  mtimeMs: number
  workspaceRoot: string
  /** R2.3: 'translated' renders the read-only side-by-side mirror. */
  pdfView?: 'translated'
  viewerRef?: RefObject<HTMLDivElement | null>
  onSelectionChange: (selection: WriteEditorSelectionState) => void
}

/**
 * The document pane renders PDFs through this context so the paper-mode
 * workbench can mount its enhanced reader (marks, translation, drawers)
 * without forking the pane. Defaults to the ordinary WritePdfViewer.
 */
const WritePdfRendererContext = createContext<ComponentType<WritePdfRendererProps>>(WritePdfViewer)

export function useWritePdfRenderer(): ComponentType<WritePdfRendererProps> {
  return useContext(WritePdfRendererContext)
}

export const WritePdfRendererProvider = WritePdfRendererContext.Provider
