export const WRITE_EXPORT_FORMATS = ['html', 'pdf', 'png', 'doc', 'docx'] as const

export type WriteExportFormat = (typeof WRITE_EXPORT_FORMATS)[number]

export const WRITE_RICH_CLIPBOARD_PROFILES = ['online-docs', 'x-articles', 'x-articles-title'] as const

export type WriteRichClipboardProfile = (typeof WRITE_RICH_CLIPBOARD_PROFILES)[number]

export const X_ARTICLE_TITLE_MISSING = 'NO_X_ARTICLE_TITLE'

export type WriteExportPayload = {
  path?: string
  title?: string
  workspaceRoot?: string
  format: WriteExportFormat
  content: string
}

export type WriteRichClipboardPayload = {
  path: string
  workspaceRoot?: string
  content: string
  profile?: WriteRichClipboardProfile
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
    }
  | {
      ok: false
      message: string
    }
