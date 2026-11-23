import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkAnnotation, WorkAnnotationMessage } from '@shared/work-annotations'
import type { WriteDocumentReviewHandle } from '../write-document-editor-handle'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { writeDocumentKey } from '../../../write/write-editor-layout'
import { clearAbandonedSelectionReview } from '../../../write/selection-review-state'
import { resolveMarkdownAnnotation } from '../../../write/annotations/document-anchors'
import { annotationProposal } from '../../../write/annotations/annotation-proposal'
import { useAnnotationReviewOwner } from '../../../write/annotations/annotation-review-owner'
import { markWorkAnnotationSuggestionApplied } from '../../../write/work-annotations'
import { annotationDocumentKey } from '../../../write/annotations/selection-target'

type Preview = {
  handle: WriteDocumentReviewHandle
  baseline: string
  annotation: WorkAnnotation
  message: WorkAnnotationMessage
}
type Scope = { workspaceRoot: string; filePath: string }

export function useAnnotationReview(scope: Scope, readOnly: boolean, getHandle: () => WriteDocumentReviewHandle | null,
  report: (message: string) => void, annotations: readonly WorkAnnotation[]) {
  const { t } = useTranslation('common')
  const [visible, setVisible] = useState(false)
  const current = useRef<Preview | null>(null)
  const [applied, setApplied] = useState<{ preview: Preview; revision: number } | null>(null)
  const revision = useWriteWorkspaceStore((state) => state.contentRevision)
  const key = annotationDocumentKey(scope.workspaceRoot, scope.filePath)
  const close = useCallback((accept: boolean): void => {
    const pending = current.current
    if (!pending) return
    current.current = null
    if (accept) pending.handle.acceptAllDiff()
    else pending.handle.rejectAllDiff({ preserveDraft: true })
    setVisible(false)
    if (useAnnotationReviewOwner.getState().key === key) useAnnotationReviewOwner.setState({ key: null })
  }, [key])
  useLayoutEffect(() => () => {
    if (!current.current) return
    const { handle } = current.current
    current.current = null
    handle.rejectAllDiff({ preserveDraft: true })
    clearAbandonedSelectionReview(scope.filePath)
    if (useAnnotationReviewOwner.getState().key === key) useAnnotationReviewOwner.setState({ key: null })
  }, [key, scope.filePath])

  // An external edit arriving during preview must get its own review.
  const externalReview = useWriteWorkspaceStore((state) => state.pendingAgentReview)
  useLayoutEffect(() => {
    if (current.current && externalReview?.filePath === scope.filePath) {
      close(false)
      report(t('writeAnnotationSourceChanged'))
    }
  }, [externalReview, scope.filePath, close, report, t])

  const preview = (annotation: WorkAnnotation, message: WorkAnnotationMessage): void => {
    const handle = getHandle()
    const state = useWriteWorkspaceStore.getState()
    if (readOnly || !handle || !message.suggestion || message.suggestion.applied) return
    if (state.reviewActive || handle.isDiffReviewActive() || current.current) {
      report(t('writeAnnotationPreviewBusy'))
      return
    }
    const anchor = annotation.anchor
    if (anchor.kind !== 'markdown' || state.workspaceRoot !== scope.workspaceRoot || state.activeFilePath !== scope.filePath) return
    const baseline = state.fileContent
    const target = resolveMarkdownAnnotation(baseline, anchor)
    const originalAnchor = message.suggestion.anchor
    const original = originalAnchor?.kind === 'markdown' ? resolveMarkdownAnnotation(baseline, originalAnchor) : null
    if (!target) {
      report(t('writeAnnotationSourceChanged'))
      return
    }
    if (!original || original.from !== target.from || original.to !== target.to) {
      report(t('writeAnnotationEarlierSuggestion'))
      return
    }
    const nextDoc = annotationProposal(baseline, target, message.suggestion)
    if (!nextDoc || !handle.beginDiffReview({ original: baseline, nextDoc, origin: 'selection' })) {
      report(t('writeEditUnchanged'))
      return
    }
    setApplied(null)
    current.current = { handle, baseline, annotation, message }
    useAnnotationReviewOwner.setState({ key })
    setVisible(true)
  }
  const accept = (): void => {
    const pending = current.current
    const state = useWriteWorkspaceStore.getState()
    if (!pending) return
    const doc = state.documentsByPath[writeDocumentKey(scope.filePath)]
    const latest = annotations.find((item) => item.id === pending.annotation.id)
    const suggestion = latest?.messages.find((item) => item.id === pending.message.id)?.suggestion
    if (!latest || latest.resolved || !suggestion || suggestion.applied ||
        JSON.stringify(latest.anchor) !== JSON.stringify(pending.annotation.anchor) ||
        getHandle() !== pending.handle || !pending.handle.isDiffReviewActive() ||
        state.workspaceRoot !== scope.workspaceRoot || state.activeFilePath !== scope.filePath ||
        doc?.fileContent !== pending.baseline || state.pendingAgentReview || doc.pendingAgentReview || readOnly) {
      close(false)
      report(t('writeAnnotationSourceChanged'))
      return
    }
    close(true)
    setApplied({ preview: pending, revision: useWriteWorkspaceStore.getState().contentRevision })
    void markWorkAnnotationSuggestionApplied(scope, pending.annotation.id, pending.message.id)
      .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)))
  }
  const undo = (): void => {
    setApplied(null)
    const state = useWriteWorkspaceStore.getState()
    if (!applied || state.workspaceRoot !== scope.workspaceRoot || state.activeFilePath !== scope.filePath ||
        state.contentRevision !== applied.revision || state.reviewActive || getHandle() !== applied.preview.handle) return
    if (applied.preview.handle.undoLast()) {
      void markWorkAnnotationSuggestionApplied(scope, applied.preview.annotation.id, applied.preview.message.id, false)
        .catch((error: unknown) => report(error instanceof Error ? error.message : String(error)))
    }
  }
  return { visible, preview, accept, reject: () => close(false), canUndo: !!applied && applied.revision === revision,
    undo, dismissUndo: () => setApplied(null) }
}
