import {
  CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS,
  type ConversationExportFormat
} from '@shared/conversation-export'
import type { ChatBlock, NormalizedThread } from '../../agent/types'
import {
  buildConversationExportDocument,
  type ConversationExportInclude,
  type ConversationExportLabels
} from '../../lib/conversation-export'
import { loadConversationBlocks } from '../../lib/conversation-export-loader'
import { buildMergedConversationMarkdown } from '../../lib/conversation-export-merge'
import { localDateToken, type ExportLayout } from './conversation-export-model'

export type ExportFailureReason = 'empty' | 'tooLarge' | 'error'

export type ExportFailure = { id: string; title: string; reason: ExportFailureReason; message?: string }

export type ExportProgress = {
  index: number
  total: number
  doneIds: string[]
  failedIds: string[]
  currentId: string | null
}

/** The open conversation is already loaded in the store and may be mid-turn. */
export type ActiveConversationSnapshot = {
  threadId: string | null
  blocks: ChatBlock[]
  busy: boolean
  currentTurnId?: string | null
  currentTurnUserId?: string | null
}

export type ExportOutcome =
  | { kind: 'saved'; location: string; written: number; failures: ExportFailure[]; messageCount: number }
  | { kind: 'canceled' }
  | { kind: 'failed'; message: string; failures: ExportFailure[] }

type BuiltDocument = { id: string; title: string; markdown: string; defaultFileName: string; messageCount: number }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function buildDocuments(options: {
  threads: NormalizedThread[]
  active: ActiveConversationSnapshot
  include: ConversationExportInclude
  labels: ConversationExportLabels
  locale: string
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}): Promise<{ documents: BuiltDocument[]; failures: ExportFailure[] }> {
  const documents: BuiltDocument[] = []
  const failures: ExportFailure[] = []
  const exportedAt = new Date()
  const total = options.threads.length
  const doneIds: string[] = []
  const failedIds: string[] = []
  const report = (index: number, currentId: string | null): void =>
    options.onProgress({ index, total, doneIds: [...doneIds], failedIds: [...failedIds], currentId })

  for (const [position, thread] of options.threads.entries()) {
    if (options.signal.aborted) break
    report(position, thread.id)
    const fail = (reason: ExportFailureReason, message?: string): void => {
      failures.push({ id: thread.id, title: thread.title, reason, ...(message ? { message } : {}) })
      failedIds.push(thread.id)
    }
    try {
      const isActive = thread.id === options.active.threadId
      const loaded = isActive
        ? {
            blocks: options.active.blocks,
            busy: options.active.busy,
            currentTurnId: options.active.currentTurnId,
            currentTurnUserId: options.active.currentTurnUserId
          }
        : await loadConversationBlocks(thread.id, options.signal).then((result) => ({
            blocks: result.blocks,
            busy: result.activeTurnId !== null,
            currentTurnId: result.activeTurnId,
            currentTurnUserId: null
          }))
      const document = buildConversationExportDocument({
        title: thread.title,
        blocks: loaded.blocks,
        locale: options.locale,
        exportedAt,
        labels: options.labels,
        busy: loaded.busy,
        currentTurnId: loaded.currentTurnId,
        currentTurnUserId: loaded.currentTurnUserId,
        include: options.include
      })
      if (document.messageCount === 0) fail('empty')
      else if (document.markdown.length > CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS) fail('tooLarge')
      else {
        documents.push({ id: thread.id, title: thread.title, ...document })
        doneIds.push(thread.id)
      }
    } catch (error) {
      if (options.signal.aborted) break
      fail('error', errorMessage(error))
    }
  }
  report(total, null)
  return { documents, failures }
}

export async function runConversationExport(options: {
  threads: NormalizedThread[]
  active: ActiveConversationSnapshot
  format: ConversationExportFormat
  layout: ExportLayout
  include: ConversationExportInclude
  labels: ConversationExportLabels
  locale: string
  mergedTitle: string
  folderName: string
  contentsLabel: string
  signal: AbortSignal
  onProgress: (progress: ExportProgress) => void
}): Promise<ExportOutcome> {
  const bridge = window.kunGui
  if (typeof bridge?.exportConversation !== 'function' || typeof bridge.exportConversationBatch !== 'function') {
    return { kind: 'failed', message: 'unavailable', failures: [] }
  }
  const { documents, failures } = await buildDocuments(options)
  if (options.signal.aborted) return { kind: 'canceled' }
  if (documents.length === 0) return { kind: 'failed', message: '', failures }
  const messageCount = documents.reduce((sum, document) => sum + document.messageCount, 0)

  try {
    if (documents.length === 1 || options.layout === 'merge') {
      const single = documents.length === 1 ? documents[0]! : null
      const exportedAt = new Date()
      const markdown = single
        ? single.markdown
        : buildMergedConversationMarkdown({
            title: options.mergedTitle,
            exportedAtLabel: options.labels.exportedAt,
            exportedAt: exportedAt.toLocaleString(options.locale),
            contentsLabel: options.contentsLabel,
            entries: documents.map((document) => ({ title: document.title, markdown: document.markdown }))
          })
      if (markdown.length > CONVERSATION_EXPORT_MAX_MARKDOWN_CHARS) {
        return { kind: 'failed', message: 'tooLarge', failures }
      }
      const result = await bridge.exportConversation({
        title: single ? single.title : options.mergedTitle,
        format: options.format,
        markdown,
        defaultFileName: single ? single.defaultFileName : `${options.mergedTitle}-${localDateToken(exportedAt)}`
      })
      if (result.ok) return { kind: 'saved', location: result.path, written: 1, failures, messageCount }
      return result.canceled ? { kind: 'canceled' } : { kind: 'failed', message: result.message, failures }
    }

    const result = await bridge.exportConversationBatch({
      format: options.format,
      folderName: options.folderName,
      items: documents.map((document) => ({
        title: document.title,
        markdown: document.markdown,
        defaultFileName: document.defaultFileName
      }))
    })
    if (!result.ok) return result.canceled ? { kind: 'canceled' } : { kind: 'failed', message: result.message, failures }
    const writeFailures = result.failed.map((entry): ExportFailure => {
      const match = documents.find((document) => document.title === entry.title)
      return { id: match?.id ?? entry.title, title: entry.title, reason: 'error', message: entry.message }
    })
    return {
      kind: 'saved',
      location: result.directory,
      written: result.written,
      failures: [...failures, ...writeFailures],
      messageCount
    }
  } catch (error) {
    return { kind: 'failed', message: errorMessage(error), failures }
  }
}
