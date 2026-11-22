import i18n from '../i18n'
import { useEffect } from 'react'
import type { WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import type { WorkAnnotation, WorkAnnotationDocument, WorkAnnotationMessage } from '@shared/work-annotations'
import { annotationDocumentKey, mutateAnnotation, normalizeAnnotationDocument } from './work-annotation-storage'
import { notifyAnnotationChange, useAnnotationSnapshot } from './work-annotation-subscriptions'
import { dispatchAnnotation } from './work-annotation-dispatch'

export { moveWorkAnnotations } from './work-annotation-subscriptions'

export function useWorkAnnotations(document: WorkAnnotationDocument | null): WorkAnnotation[] {
  const { records } = useAnnotationSnapshot(document)
  useEffect(() => {
    for (const annotation of records) {
      for (const message of annotation.messages) {
        if (message.status === 'pending' && message.request) dispatchAnnotation(annotation.id, message.request.id, true)
      }
    }
  }, [records])
  return records
}

export function useWorkAnnotationLoadError(document: WorkAnnotationDocument | null): string | null {
  return useAnnotationSnapshot(document).error
}

function append(record: WorkAnnotation, draft: string, askKun: boolean): WorkAnnotation {
  const text = draft.trim()
  if (!text || text.length > 16_000) throw new Error(i18n.t('common:writeAnnotationTextLength'))
  if (askKun && record.messages.some((msg) => msg.status === 'pending')) throw new Error(i18n.t('common:writeAnnotationBusy'))
  const now = new Date().toISOString()
  const additions: WorkAnnotationMessage[] = [{ id: crypto.randomUUID(), createdAt: now, role: 'user', text }]
  if (askKun) additions.push({
    id: crypto.randomUUID(), createdAt: now, role: 'assistant', text: '', status: 'pending',
    request: { id: crypto.randomUUID(), anchor: structuredClone(record.anchor) }
  })
  return { ...record, updatedAt: now, messages: [...record.messages, ...additions] }
}

function commit(record: WorkAnnotation, askKun: boolean): void {
  const last = record.messages.at(-1)
  if (askKun && last?.request && last.status === 'pending') dispatchAnnotation(record.id, last.request.id)
  notifyAnnotationChange(record)
}

export async function createWorkAnnotation(document: WorkAnnotationDocument, anchor: WorkAnnotationAnchor, text: string,
  askKun = false, id: string = crypto.randomUUID()): Promise<WorkAnnotation> {
  const doc = normalizeAnnotationDocument(document)
  const record = await mutateAnnotation(id, (existing) => {
    if (existing) {
      if (annotationDocumentKey(existing) !== annotationDocumentKey(doc)) throw new Error('This annotation belongs to another document.')
      return existing
    }
    const now = new Date().toISOString()
    return append({ id, ...doc, anchor, createdAt: now, updatedAt: now, resolved: false, messages: [] }, text, askKun)
  })
  commit(record, askKun)
  return record
}

async function update(document: WorkAnnotationDocument, id: string, apply: (record: WorkAnnotation) => WorkAnnotation): Promise<WorkAnnotation> {
  return mutateAnnotation(id, (record) => {
    if (!record || annotationDocumentKey(record) !== annotationDocumentKey(document)) {
      throw new Error(i18n.t('common:writeAnnotationWrongDocument'))
    }
    return apply(record)
  })
}

export async function replyWorkAnnotation(document: WorkAnnotationDocument, id: string, text: string, askKun = false): Promise<void> {
  commit(await update(document, id, (record) => append(record, text, askKun)), askKun)
}

export async function resolveWorkAnnotation(document: WorkAnnotationDocument, id: string, resolved: boolean): Promise<void> {
  commit(await update(document, id, (record) => ({ ...record, resolved, updatedAt: new Date().toISOString() })), false)
}

export async function reanchorWorkAnnotation(document: WorkAnnotationDocument, id: string, anchor: WorkAnnotationAnchor): Promise<void> {
  commit(await update(document, id, (record) => ({ ...record, anchor, updatedAt: new Date().toISOString() })), false)
}

export async function retryWorkAnnotation(document: WorkAnnotationDocument, id: string, messageId?: string): Promise<void> {
  let requestId: string | undefined
  const record = await update(document, id, (row) => {
    if (row.messages.some((msg) => msg.status === 'pending')) return row
    const message = [...row.messages].reverse().find((msg) => msg.status === 'failed' && (!messageId || msg.id === messageId))
    if (!message?.request) return row
    // Reconnect to an uncertain admission. A confirmed terminal failure requires a new turn.
    const request = message.request.terminal ? { id: crypto.randomUUID(), anchor: message.request.anchor } : message.request
    requestId = request.id
    return { ...row, updatedAt: new Date().toISOString(), messages: row.messages.map((msg) =>
      msg === message ? { ...msg, status: 'pending', error: undefined, request } : msg) }
  })
  if (requestId) dispatchAnnotation(id, requestId)
  notifyAnnotationChange(record)
}

export async function markWorkAnnotationSuggestionApplied(document: WorkAnnotationDocument, id: string, messageId: string, applied = true): Promise<void> {
  commit(await update(document, id, (row) => ({ ...row, updatedAt: new Date().toISOString(), messages: row.messages.map((msg) =>
    msg.id === messageId && msg.suggestion ? { ...msg, suggestion: { ...msg.suggestion, applied } } : msg) })), false)
}
