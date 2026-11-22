import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import type { WriteRichEditorHandle } from '../../../write/tiptap/WriteRichEditor'
import type { WriteMarkdownEditorHandle } from '../write-markdown-editor-types'
import { usePaperPdfFingerprint } from '../../../paper/use-paper-pdf-fingerprint'
import { captureAnnotationAnchor, revealAnnotation, type AnnotationView } from '../../../write/annotations/document-anchors'
import { annotationDocumentKey, registerAnnotationSelection } from '../../../write/annotations/selection-target'
import {
  createWorkAnnotation, reanchorWorkAnnotation, replyWorkAnnotation, resolveWorkAnnotation,
  retryWorkAnnotation, useWorkAnnotationLoadError, useWorkAnnotations
} from '../../../write/work-annotations'
import { WorkAnnotationLayer, type WorkAnnotationView } from './WorkAnnotationLayer'
import { useAnnotationGeometry } from './use-annotation-geometry'
import { WriteEditToast } from '../WriteEditToast'
import { useAnnotationReview } from './use-annotation-review'

type Props = {
  workspaceRoot: string
  filePath: string
  kind: WorkAnnotationAnchor['kind']
  markdown: string
  sourceVersion: string
  pdfData: string
  pane: RefObject<HTMLDivElement | null>
  rich: RefObject<WriteRichEditorHandle | null>
  plain: RefObject<WriteMarkdownEditorHandle | null>
  readOnly: boolean
}

export function WorkAnnotationHost({ workspaceRoot, filePath, kind, markdown, sourceVersion, pdfData, pane, rich, plain, readOnly }: Props) {
  const { t } = useTranslation('common')
  const scope = useMemo(() => ({ workspaceRoot, filePath }), [workspaceRoot, filePath])
  const key = annotationDocumentKey(workspaceRoot, filePath)
  const annotations = useWorkAnnotations(scope)
  const loadError = useWorkAnnotationLoadError(scope)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ id: string; anchor: WorkAnnotationAnchor; resolved: false } | null>(null)
  const [reattachId, setReattachId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fingerprint = usePaperPdfFingerprint(pdfData)
  const version = kind === 'pdf' ? fingerprint ?? '' : sourceVersion
  const view = useCallback((): AnnotationView | null => pane.current
    ? { root: pane.current, markdown, version, richEditor: rich.current?.getEditor() }
    : null, [pane, rich, markdown, version])
  const review = useAnnotationReview(scope, readOnly, () => rich.current ?? plain.current, setError, annotations)
  const newItem = draft && !annotations.some((annotation) => annotation.id === draft.id) ? draft : null
  const items = useMemo(() => newItem ? [...annotations, newItem] : annotations, [annotations, newItem])
  const layout = useAnnotationGeometry(view, items, activeId, review.visible)
  const report = (cause: unknown): void => setError(cause instanceof Error ? cause.message : String(cause))

  const revealFrame = useRef<number | null>(null)
  useLayoutEffect(() => () => {
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current)
  }, [])
  const revealAfterLayout = useCallback((anchor: WorkAnnotationAnchor): void => {
    const root = pane.current
    if (revealFrame.current !== null) cancelAnimationFrame(revealFrame.current)
    revealFrame.current = requestAnimationFrame(() => {
      revealFrame.current = null
      const doc = view()
      if (doc && doc.root === root && root?.isConnected) revealAnnotation(doc, anchor)
    })
  }, [pane, view])

  useLayoutEffect(() => registerAnnotationSelection(key, (selection) => {
    const doc = view()
    if (!doc || review.visible || (kind !== 'markdown' && !version)) return false
    const anchor = captureAnnotationAnchor(doc, kind, selection)
    if (!anchor) return false
    setError('')
    if (reattachId) {
      const id = reattachId
      void reanchorWorkAnnotation(scope, id, anchor).then(() => {
        setReattachId(null)
        setActiveId(id)
      }).catch(report)
    } else {
      const id = crypto.randomUUID()
      setDraft({ id, anchor, resolved: false })
      setActiveId(id)
      revealAfterLayout(anchor)
    }
    return true
  }), [key, view, scope, kind, version, reattachId, review.visible, revealAfterLayout])

  const submitting = useRef(new Set<string>())
  const submit = async (id: string, text: string, askKun: boolean): Promise<void> => {
    if (submitting.current.has(id)) return
    submitting.current.add(id)
    try {
      if (newItem?.id === id) {
        await createWorkAnnotation(scope, newItem.anchor, text, askKun, id)
      } else {
        await replyWorkAnnotation(scope, id, text, askKun)
      }
    } finally { submitting.current.delete(id) }
  }
  const views: WorkAnnotationView[] = annotations.map((item) => {
    const failed = item.messages.filter((m) => m.status === 'failed').at(-1)
    return {
      id: item.id, quote: item.anchor.quote, resolved: item.resolved,
      detached: layout.detached[item.id], busy: item.messages.some((m) => m.status === 'pending'),
      error: failed?.error, canPreview: !readOnly && kind === 'markdown',
      messages: item.messages.map((m) => ({ id: m.id, author: m.role === 'assistant' ? 'kun' : 'user',
        text: m.text, suggestion: m.suggestion }))
    }
  })
  if (newItem) views.push({ id: newItem.id, quote: newItem.anchor.quote, resolved: false, messages: [] })
  const open = (id: string): void => {
    setActiveId(id)
    setReattachId(null)
    setError('')
    const item = items.find((entry) => entry.id === id)
    if (item) revealAfterLayout(item.anchor)
  }

  return <>
    {review.canUndo && <WriteEditToast onUndo={review.undo} onDismiss={review.dismissUndo} />}
    {!review.visible && <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {layout.highlight.map((rect, index) => <span key={index} className="absolute rounded-sm bg-amber-400/25" style={rect} />)}
    </div>}
    <WorkAnnotationLayer documentKey={key} annotations={views} activeId={review.visible ? null : activeId}
      markerTops={review.visible ? {} : layout.tops} onOpen={open}
      onClose={() => { setActiveId(null); setDraft(null); setError('') }}
      onSubmit={submit}
      onResolve={(id, resolved) => { void resolveWorkAnnotation(scope, id, resolved).catch(report) }}
      onReattach={(id) => { setReattachId(id); setActiveId(null); setError('') }}
      onRetry={(id) => {
        const failed = annotations.find((a) => a.id === id)?.messages.filter((m) => m.status === 'failed').at(-1)
        if (failed) void retryWorkAnnotation(scope, id, failed.id).catch(report)
      }}
      onPreview={!readOnly && kind === 'markdown' ? (id, messageId) => {
        const item = annotations.find((entry) => entry.id === id)
        const message = item?.messages.find((entry) => entry.id === messageId)
        if (item && message) { setError(''); review.preview(item, message) }
      } : undefined}
    />
    {(error || loadError || reattachId || review.visible) && <div data-annotation-review={review.visible || undefined} data-selection-ignore="true"
      className="absolute bottom-3 left-1/2 z-40 flex max-w-[95%] -translate-x-1/2 items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-xs text-ds-ink shadow-md">
      {loadError ? <span role="alert">{loadError}</span> : error ? <><span role="alert">{error}</span><button type="button" onClick={() => setError('')}>{t('close')}</button></>
        : review.visible ? <><span>{t('writeAnnotationPreview')}</span>
          <button className="write-review-button" type="button" onClick={review.reject}>{t('workReviewReject')}</button>
          <button className="write-review-button is-strong" type="button" onClick={review.accept}>{t('workReviewAccept')}</button></>
        : <><span role="status">{t('writeAnnotationReattachHint')}</span><button type="button" onClick={() => setReattachId(null)}>{t('cancel')}</button></>}
    </div>}
  </>
}
