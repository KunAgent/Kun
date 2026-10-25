import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  WorkspaceOfficePreviewResult,
  WorkspaceOfficeSelection,
  WorkspacePresentationViewReference
} from '@shared/office-document'
import type { WorkbenchChatStageProps } from '../../components/workbench/WorkbenchChatStage'
import { useWorkspaceOfficePreview } from '../../components/useWorkspaceOfficePreview'
import type { WorkspaceDocumentQuoteDraft } from '../../lib/workspace-document-quote'
import type { LibraryArtifact } from '../artifact-types'
import {
  ARTIFACT_SELECTION_CHIP_ID,
  ARTIFACT_VIEW_CHIP_ID,
  EMPTY_ARTIFACT_CHAT_VIEW,
  artifactSelectionQuote,
  type ArtifactChatView
} from './artifact-chat-context'
import {
  loadArtifactVersions,
  noteExternalChange,
  observeArtifactBusy,
  observeArtifactPreview
} from './artifact-chat-session'

/** The slice of the Code conversation stage the artifact chat panel runs on. */
export type ArtifactChatHost = Pick<WorkbenchChatStageProps,
  'blocks' | 'liveReasoning' | 'liveAssistant' | 'activeThreadId' | 'busy' |
  'runtimeConnection' | 'composerProps' | 'onRetryConnection' | 'onOpenSettings'>

export type ArtifactOfficeSession = {
  officeResult: WorkspaceOfficePreviewResult | null
  officeLoading: boolean
  officeAgentEditing: boolean
  officeRefreshError: string | null
  view: ArtifactChatView
  onSelectionChange: (selection: WorkspaceOfficeSelection) => void
  onPresentationViewChange: (view: WorkspacePresentationViewReference | null) => void
  onQuoteSelection: (draft: WorkspaceDocumentQuoteDraft) => boolean
  removeChip: (id: string) => void
  clearSentContext: () => void
}

export function useArtifactOfficeSession(
  artifact: LibraryArtifact,
  host: Pick<ArtifactChatHost, 'activeThreadId' | 'busy' | 'composerProps'> | null,
  boundThreadId: string | null
): ArtifactOfficeSession {
  const target = useMemo(() => ({ path: artifact.path, workspaceRoot: artifact.workspaceRoot }), [artifact.path, artifact.workspaceRoot])
  const { officeResult, officeLoading, officeAgentEditing, officeRefreshError } = useWorkspaceOfficePreview({
    target, workspaceRoot: artifact.workspaceRoot, enabled: true
  })
  const [view, setView] = useState<ArtifactChatView>(EMPTY_ARTIFACT_CHAT_VIEW)
  const lastShaRef = useRef<string | null>(null)
  // Library rescans hand over fresh artifact objects; identity is the id.
  const artifactRef = useRef(artifact)
  artifactRef.current = artifact

  useEffect(() => {
    setView(EMPTY_ARTIFACT_CHAT_VIEW)
    lastShaRef.current = null
    void loadArtifactVersions(artifactRef.current)
  }, [artifact.id])

  const sha = officeResult?.ok ? officeResult.sourceSha256 : null
  useEffect(() => {
    if (!officeResult?.ok) return
    const previous = lastShaRef.current
    lastShaRef.current = officeResult.sourceSha256
    if (previous && previous !== officeResult.sourceSha256) noteExternalChange(artifact.id, officeResult.sourceSha256)
    void observeArtifactPreview(artifactRef.current, officeResult)
    // The preview identity is its SHA; data arrives with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id, sha])

  const busy = Boolean(host?.busy && boundThreadId && host.activeThreadId === boundThreadId)
  const queued = host?.composerProps.queuedMessages.length ?? 0
  useEffect(() => {
    observeArtifactBusy(artifactRef.current, boundThreadId, busy, queued)
  }, [artifact.id, boundThreadId, busy, queued])

  const onSelectionChange = useCallback((selection: WorkspaceOfficeSelection): void => {
    setView((current) => {
      const next = selection.charCount > 0 ? selection : null
      if (!next && !current.selection) return current
      return { ...current, selection: next, detached: next ? false : current.detached }
    })
  }, [])

  const onPresentationViewChange = useCallback((next: WorkspacePresentationViewReference | null): void => {
    setView((current) => {
      if (current.presentation?.slide === next?.slide && current.presentation?.sourceSha256 === next?.sourceSha256) return current
      // Moving to another slide brings the automatic chip back.
      return { ...current, presentation: next, detached: current.presentation?.slide === next?.slide ? current.detached : false }
    })
  }, [])

  const onQuoteSelection = useCallback((draft: WorkspaceDocumentQuoteDraft): boolean => {
    const quote = artifactSelectionQuote({
      sourceKind: 'word', sourceFormat: 'docx', text: draft.text, charCount: Array.from(draft.text).length,
      pageStart: draft.pageStart, pageEnd: draft.pageEnd
    }, artifact)
    if (!quote) return false
    setView((current) => ({ ...current, quotes: [...current.quotes, quote].slice(-4) }))
    return true
  }, [artifact])

  const removeChip = useCallback((id: string): void => {
    setView((current) => id === ARTIFACT_VIEW_CHIP_ID || id === ARTIFACT_SELECTION_CHIP_ID
      ? { ...current, detached: true }
      : { ...current, quotes: current.quotes.filter((quote) => quote.id !== id) })
  }, [])

  const clearSentContext = useCallback((): void => {
    setView((current) => ({ ...current, quotes: [], selection: null }))
  }, [])

  return {
    officeResult, officeLoading, officeAgentEditing, officeRefreshError,
    view, onSelectionChange, onPresentationViewChange, onQuoteSelection, removeChip, clearSentContext
  }
}
