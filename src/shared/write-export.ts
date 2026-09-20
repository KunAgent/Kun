export const WRITE_EXPORT_FORMATS = ['html', 'pdf', 'png', 'doc', 'docx'] as const

export type WriteExportFormat = (typeof WRITE_EXPORT_FORMATS)[number]

export const WRITE_RICH_CLIPBOARD_PROFILES = ['online-docs', 'x-articles'] as const

export type WriteRichClipboardProfile = (typeof WRITE_RICH_CLIPBOARD_PROFILES)[number]

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
      simplified?: boolean
      overLimit?: boolean
    }
  | {
      ok: false
      message: string
    }
