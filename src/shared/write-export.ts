export const WRITE_EXPORT_FORMATS = ['html', 'pdf', 'png', 'doc', 'docx'] as const

export type WriteExportFormat = (typeof WRITE_EXPORT_FORMATS)[number]

export const WRITE_RICH_CLIPBOARD_PROFILES = [
  'online-docs',
  'x-articles',
  'x-articles-image'
] as const

export type WriteRichClipboardProfile = (typeof WRITE_RICH_CLIPBOARD_PROFILES)[number]

export const X_ARTICLE_IMAGE_MISSING = 'NO_X_ARTICLE_IMAGE'

export type WriteExportPayload = {
  path?: string
  title?: string
  workspaceRoot?: string
  format: WriteExportFormat
  content: string
  /**
   * Pre-rendered mermaid SVG keyed by exact fence source. The renderer
   * generates these before invoking the export IPC so the main process can
   * inject identical diagrams without running mermaid offscreen.
   */
  renderedDiagrams?: Record<string, string>
}

export type WriteRichClipboardPayload = {
  path: string
  workspaceRoot?: string
  content: string
  profile?: WriteRichClipboardProfile
  imageIndex?: number
}

export type WriteExportResult =
  | {
      ok: true
      path: string
      format: WriteExportFormat
      exportedAt: string
    }
  | {
      ok: false
      canceled: true
      message?: string
    }
  | {
      ok: false
      canceled: false
      message: string
    }

export type WriteRichClipboardResult =
  | {
      ok: true
      copiedAt: string
      profile: WriteRichClipboardProfile
      title?: string
      simplified?: boolean
      overLimit?: boolean
      imageCount?: number
      imageIndex?: number
    }
  | {
      ok: false
      message: string
    }
