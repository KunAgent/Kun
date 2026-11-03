export const CONVERSATION_EXPORT_FORMATS = ['md', 'pdf'] as const
export const CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS = 2_000_000

export type ConversationExportFormat = (typeof CONVERSATION_EXPORT_FORMATS)[number]

export type ConversationExportPayload = {
  title: string
  format: ConversationExportFormat
  markdown: string
  defaultFileName: string
}

export type ConversationExportResult =
  | {
      ok: true
      path: string
      format: ConversationExportFormat
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

export const CONVERSATION_EXPORT_BATCH_MAX_ITEMS = 200
export const CONVERSATION_EXPORT_BATCH_MAX_TOTAL_CHARS = 20_000_000

export type ConversationExportBatchItem = {
  title: string
  markdown: string
  defaultFileName: string
}

/** One file per conversation, written into a dated folder the user picks the parent of. */
export type ConversationExportBatchPayload = {
  format: ConversationExportFormat
  folderName: string
  items: ConversationExportBatchItem[]
}

export type ConversationExportBatchResult =
  | {
      ok: true
      directory: string
      format: ConversationExportFormat
      exportedAt: string
      written: number
      failed: Array<{ title: string; message: string }>
    }
  | {
      ok: false
      canceled: true
    }
  | {
      ok: false
      canceled: false
      message: string
    }
