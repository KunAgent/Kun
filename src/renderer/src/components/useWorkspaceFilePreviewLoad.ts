import {
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from 'react'
import type {
  WorkspaceFileReadResult,
  WorkspaceFileTarget,
  WorkspaceImageReadResult,
  WorkspacePdfReadResult,
  WorkspacePreviewLeaseResult,
  WorkspaceTextEncoding
} from '@shared/workspace-file'
import {
  isWorkspaceTextBackedPreviewKind,
  workspaceFilePreviewKind
} from '../lib/workspace-text-preview'
import type { CachedTextDraft } from './workspace-file-preview-support'
import { useWorkspaceOfficePreview } from './useWorkspaceOfficePreview'

type PreviewKind = ReturnType<typeof workspaceFilePreviewKind>

/** A known-binary file only needs its head for the card and the hex view. */
const BINARY_PROBE_BYTES = 4096

type LoadParams = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  activeTargetKey: string
  previewKind: PreviewKind
  /** Reopen text with this encoding; null detects one. */
  encoding: WorkspaceTextEncoding | null
  /** Bytes of text to read; null reads the default head. */
  maxBytes: number | null
  /** Bumped to read the same file again. */
  reloadNonce: number
  textDraftsRef: MutableRefObject<Map<string, CachedTextDraft>>
  setSvgRendered: Dispatch<SetStateAction<boolean>>
  setHtmlRendered: Dispatch<SetStateAction<boolean>>
  setTextDraft: Dispatch<SetStateAction<string>>
  setTextSaveError: Dispatch<SetStateAction<string | null>>
  setSavingText: Dispatch<SetStateAction<boolean>>
  setEditingText: Dispatch<SetStateAction<boolean>>
  setDiskConflict: Dispatch<SetStateAction<boolean>>
}

function failure(error: unknown): { ok: false; message: string } {
  return { ok: false, message: error instanceof Error ? error.message : String(error) }
}

export function useWorkspaceFilePreviewLoad({
  target,
  workspaceRoot,
  activeTargetKey,
  previewKind,
  encoding,
  maxBytes,
  reloadNonce,
  textDraftsRef,
  setSvgRendered,
  setHtmlRendered,
  setTextDraft,
  setTextSaveError,
  setSavingText,
  setEditingText,
  setDiskConflict
}: LoadParams) {
  const [result, setResult] = useState<WorkspaceFileReadResult | null>(null)
  const [imageResult, setImageResult] = useState<WorkspaceImageReadResult | null>(null)
  const [pdfResult, setPdfResult] = useState<WorkspacePdfReadResult | null>(null)
  const [previewLease, setPreviewLease] = useState<WorkspacePreviewLeaseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const {
    officeResult,
    officeLoading,
    officeAgentEditing,
    officeRefreshError
  } = useWorkspaceOfficePreview({
    target,
    workspaceRoot,
    enabled: previewKind === 'office'
  })

  useEffect(() => {
    if (!target) {
      setResult(null)
      setImageResult(null)
      setPdfResult(null)
      setPreviewLease(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setSvgRendered(true)
    setHtmlRendered(false)
    setTextSaveError(null)
    setSavingText(false)
    setEditingText(false)
    setDiskConflict(false)
    setLoading(true)
    setImageResult(null)
    setPdfResult(null)
    setPreviewLease(null)
    // Keep the shown text while "load more" or a re-encode refetches the same file.
    if (maxBytes === null && encoding === null) {
      setTextDraft('')
      setResult(null)
    }

    const readTarget = {
      ...target,
      workspaceRoot: target.workspaceRoot ?? workspaceRoot
    }

    if (previewKind === 'image') {
      void window.kunGui
        .readWorkspaceImage(readTarget)
        .then((next) => {
          if (!cancelled) setImageResult(next)
        })
        .catch((error) => {
          if (!cancelled) setImageResult(failure(error))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    if (previewKind === 'pdf') {
      void window.kunGui
        .readWorkspacePdf(readTarget)
        .then((next) => {
          if (!cancelled) setPdfResult(next)
        })
        .catch((error) => {
          if (!cancelled) setPdfResult(failure(error))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    if (previewKind === 'office') {
      setLoading(false)
      return () => {
        cancelled = true
      }
    }

    if (previewKind === 'audio' || previewKind === 'video') {
      let leaseId = ''
      void window.kunGui
        .openWorkspacePreviewResource({
          path: readTarget.path,
          workspaceRoot: readTarget.workspaceRoot ?? workspaceRoot
        })
        .then((next) => {
          if (next.ok) leaseId = next.leaseId
          if (!cancelled) setPreviewLease(next)
        })
        .catch((error) => {
          if (!cancelled) setPreviewLease(failure(error))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
      return () => {
        cancelled = true
        if (leaseId) void window.kunGui.releaseWorkspacePreviewResource({ leaseId })
      }
    }

    let leaseId = ''
    const textBacked = isWorkspaceTextBackedPreviewKind(previewKind)
    void (async () => {
      const [next, htmlLease] = await Promise.all([
        window.kunGui.readWorkspaceFile({
          ...readTarget,
          ...(previewKind === 'binary' ? { maxBytes: BINARY_PROBE_BYTES } : {}),
          ...(textBacked && maxBytes !== null ? { maxBytes } : {}),
          ...(textBacked && encoding ? { encoding } : {})
        }),
        previewKind === 'html'
          ? window.kunGui.openWorkspacePreviewResource({
              path: readTarget.path,
              workspaceRoot: readTarget.workspaceRoot ?? workspaceRoot
            })
          : Promise.resolve(null)
      ])
      if (htmlLease?.ok) leaseId = htmlLease.leaseId
      if (!cancelled) {
        setResult(next)
        if (next.ok) {
          const cached = textDraftsRef.current.get(activeTargetKey)
          setTextDraft(cached?.content ?? next.content)
        }
        if (htmlLease) setPreviewLease(htmlLease)
      }
    })()
      .catch((error) => {
        if (!cancelled) setResult(failure(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      if (leaseId) void window.kunGui.releaseWorkspacePreviewResource({ leaseId })
    }
  }, [
    activeTargetKey,
    encoding,
    maxBytes,
    previewKind,
    reloadNonce,
    setDiskConflict,
    setEditingText,
    setHtmlRendered,
    setSavingText,
    setSvgRendered,
    setTextDraft,
    setTextSaveError,
    target,
    textDraftsRef,
    workspaceRoot
  ])

  return {
    result,
    setResult,
    imageResult,
    pdfResult,
    officeResult,
    officeAgentEditing,
    officeRefreshError,
    previewLease,
    loading: previewKind === 'office' ? officeLoading : loading,
    setLoading
  }
}
