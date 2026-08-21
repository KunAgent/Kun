import { useEffect } from 'react'
import i18n from '../../i18n'
import {
  projectFocusedDocument,
  writeDocumentKey
} from '../../write/write-editor-layout'
import { startWriteWorkspaceFileWatch } from '../../write/write-file-watch'
import { startWriteOfficeSessionWatch } from '../../write/write-office-session-watch'
import { emptySelection } from '../../write/write-workspace-store-helpers'
import { isWriteWorkspaceSaveContentPending } from '../../write/write-save-coordinator'
import {
  useWriteWorkspaceStore,
  type WriteDocumentSession,
  type WriteEditorLayoutV1
} from '../../write/write-workspace-store'
import type { WorkspaceOfficePreviewSuccess } from '@shared/office-document'

type Options = {
  workspaceRoot: string
  editorLayout: WriteEditorLayoutV1
}

const spreadsheetRebaseGenerations = new Map<string, number>()

export function useWriteEditorGroupFileWatches({ workspaceRoot, editorLayout }: Options): void {
  const visibleKey = editorLayout.groups
    .map((group) => group.activePath ?? '')
    .filter(Boolean)
    .sort()
    .join('\0')

  useEffect(() => {
    if (!workspaceRoot.trim()) return
    if (
      typeof window.kunGui?.watchWorkspaceFile !== 'function' ||
      typeof window.kunGui?.unwatchWorkspaceFile !== 'function' ||
      typeof window.kunGui?.onWorkspaceFileChanged !== 'function'
    ) return

    const state = useWriteWorkspaceStore.getState()
    const paths = [...new Set(state.editorLayout.groups.map((group) => group.activePath).filter((path): path is string => Boolean(path)))]
    const cleanups = paths.flatMap((path) => {
      const document = state.documentsByPath[writeDocumentKey(path)]
      if (!document || document.kind === 'pdf') return []
      if (document.kind === 'office') {
        return [startWriteOfficeSessionWatch({
          api: window.kunGui,
          workspaceRoot,
          path,
          callbacks: {
            onLoading: (officeLoading) => patchOfficeDocument(path, { officeLoading }),
            onAgentEditing: (officeAgentEditing) => patchOfficeDocument(path, { officeAgentEditing }),
            onRefreshError: (officeRefreshError) => patchOfficeDocument(path, { officeRefreshError }),
            onPreview: (officePreview) => {
              void reconcileWriteOfficePreview(path, officePreview)
            }
          }
        })]
      }
      return [startWriteWorkspaceFileWatch({
        api: window.kunGui,
        workspaceRoot,
        path,
        kind: document.kind === 'image' ? 'image' : 'text',
        onTextSnapshot: (snapshot) => {
          useWriteWorkspaceStore.setState((current) => {
            const key = writeDocumentKey(path)
            const latest = current.documentsByPath[key]
            if (!latest || (latest.kind !== 'text' && latest.kind !== 'code')) return {}
            if (snapshot.message) {
              const documentsByPath = {
                ...current.documentsByPath,
                [key]: {
                  ...latest,
                  fileError: snapshot.message,
                  saveStatus: latest.kind === 'text' ? 'error' as const : 'saved' as const
                }
              }
              return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
            }
            if (typeof snapshot.content !== 'string') return {}
            const content = snapshot.content
            if (latest.kind === 'code') {
              const documentsByPath = {
                ...current.documentsByPath,
                [key]: {
                  ...latest,
                  fileContent: content,
                  persistedContent: content,
                  fileSize: snapshot.size ?? content.length,
                  fileTruncated: snapshot.truncated === true,
                  fileError: null,
                  saveStatus: 'saved' as const
                }
              }
              return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
            }
            if (isWriteWorkspaceSaveContentPending(workspaceRoot, path, content)) return {}
            const dirty = latest.fileContent !== latest.persistedContent
            if (dirty && content !== latest.persistedContent && content !== latest.fileContent) {
              const documentsByPath = {
                ...current.documentsByPath,
                [key]: {
                  ...latest,
                  persistedContent: content,
                  pendingAgentReview: {
                    workspaceRoot,
                    filePath: path,
                    documentEpoch: latest.documentEpoch,
                    nextContent: content
                  },
                  reviewActive: true,
                  fileError: i18n.t('common:writeExternalChangeConflict')
                }
              }
              return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
            }
            const documentsByPath = {
              ...current.documentsByPath,
              [key]: {
                ...latest,
                fileContent: dirty ? latest.fileContent : content,
                persistedContent: content,
                fileSize: snapshot.size ?? content.length,
                fileTruncated: snapshot.truncated === true,
                saveStatus: dirty && latest.fileContent !== content ? 'dirty' as const : 'saved' as const,
                fileError: null
              }
            }
            return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
          })
        },
        onImageChanged: () => {
          void window.kunGui.readWorkspaceImage({ path, workspaceRoot }).then((result) => {
            if (!result.ok) return
            useWriteWorkspaceStore.setState((current) => {
              const key = writeDocumentKey(path)
              const latest = current.documentsByPath[key]
              if (!latest || latest.kind !== 'image') return {}
              const documentsByPath = {
                ...current.documentsByPath,
                [key]: {
                  ...latest,
                  imageDataUrl: result.dataUrl,
                  imageMimeType: result.mimeType,
                  fileSize: result.size,
                  fileError: null
                }
              }
              return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
            })
          })
        },
        onError: (message) => {
          useWriteWorkspaceStore.setState((current) => {
            const key = writeDocumentKey(path)
            const latest = current.documentsByPath[key]
            if (!latest) return {}
            const documentsByPath = { ...current.documentsByPath, [key]: { ...latest, fileError: message } }
            return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
          })
        }
      })]
    })
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [visibleKey, workspaceRoot])
}

export async function reconcileWriteOfficePreview(
  path: string,
  officePreview: WorkspaceOfficePreviewSuccess
): Promise<void> {
  const key = writeDocumentKey(path)
  const initial = useWriteWorkspaceStore.getState().documentsByPath[key]
  if (!initial || initial.kind !== 'office') return
  const authoritativeSha256 = initial.spreadsheetSourceSha256 || initial.officePreview?.sourceSha256 || ''
  const trueExternalSpreadsheet =
    officePreview.sourceFormat === 'xlsx' &&
    authoritativeSha256 !== officePreview.sourceSha256 &&
    initial.spreadsheetMutations.length > 0
  if (!trueExternalSpreadsheet) {
    patchOfficePreview(path, (latest) => applyWriteOfficePreviewUpdate(
      latest,
      officePreview,
      i18n.t('common:writeSpreadsheetExternalConflict')
    ))
    return
  }

  const generation = (spreadsheetRebaseGenerations.get(key) ?? 0) + 1
  spreadsheetRebaseGenerations.set(key, generation)
  const mutationSignature = JSON.stringify(initial.spreadsheetMutations)
  try {
    const { evaluateSpreadsheetExternalRebase, spreadsheetConflictTargetLabel } =
      await import('../../lib/workspace-spreadsheet-rebase')
    const rebase = await evaluateSpreadsheetExternalRebase({
      preview: officePreview,
      mutations: initial.spreadsheetMutations,
      baseFingerprints: initial.spreadsheetMutationBaseFingerprints
    })
    if (spreadsheetRebaseGenerations.get(key) !== generation) return
    patchOfficePreview(path, (latest) => {
      const latestAuthoritativeSha256 = latest.spreadsheetSourceSha256 || latest.officePreview?.sourceSha256 || ''
      if (
        latestAuthoritativeSha256 !== authoritativeSha256 ||
        JSON.stringify(latest.spreadsheetMutations) !== mutationSignature
      ) return latest
      if (rebase.conflictTargets.length > 0) {
        const labels = rebase.conflictTargets.slice(0, 3).map(spreadsheetConflictTargetLabel)
        const message = i18n.t('common:writeSpreadsheetExternalConflictTargets', {
          count: rebase.conflictTargets.length,
          targets: labels.join(', ')
        })
        return {
          ...latest,
          spreadsheetConflictPreview: officePreview,
          spreadsheetConflictTargets: rebase.conflictTargets,
          spreadsheetConflictBaseFingerprints: rebase.externalBaseFingerprints,
          officeLoading: false,
          officeRefreshError: message,
          fileError: message,
          saveStatus: 'error'
        }
      }
      const accepted = applyWriteOfficePreviewUpdate(
        { ...latest, spreadsheetMutations: [] },
        officePreview,
        i18n.t('common:writeSpreadsheetExternalConflict')
      )
      return {
        ...accepted,
        spreadsheetMutations: latest.spreadsheetMutations,
        spreadsheetMutationBaseFingerprints: rebase.externalBaseFingerprints,
        spreadsheetConflictTargets: [],
        spreadsheetConflictBaseFingerprints: {},
        saveStatus: 'dirty',
        fileError: null,
        officeRefreshError: null
      }
    })
  } catch (error) {
    if (spreadsheetRebaseGenerations.get(key) !== generation) return
    const message = error instanceof Error ? error.message : String(error)
    patchOfficeDocument(path, { officeLoading: false, officeRefreshError: message })
  }
}

function patchOfficePreview(
  path: string,
  update: (document: WriteDocumentSession) => WriteDocumentSession
): void {
  useWriteWorkspaceStore.setState((current) => {
    const key = writeDocumentKey(path)
    const latest = current.documentsByPath[key]
    if (!latest || latest.kind !== 'office') return {}
    const next = update(latest)
    if (next === latest) return {}
    const documentsByPath = { ...current.documentsByPath, [key]: next }
    return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
  })
}

export function applyWriteOfficePreviewUpdate(
  latest: WriteDocumentSession,
  officePreview: WorkspaceOfficePreviewSuccess,
  conflictMessage: string
): WriteDocumentSession {
  const authoritativeSha256 = latest.spreadsheetSourceSha256 || latest.officePreview?.sourceSha256 || ''
  const sourceChanged = authoritativeSha256 !== officePreview.sourceSha256
  const editableSpreadsheet = latest.officePreview?.sourceFormat === 'xlsx' || officePreview.sourceFormat === 'xlsx'
  if (
    sourceChanged &&
    editableSpreadsheet &&
    latest.spreadsheetMutations.length > 0 &&
    latest.saveStatus !== 'saving'
  ) {
    return {
      ...latest,
      spreadsheetConflictPreview: officePreview,
      officeLoading: false,
      officeRefreshError: conflictMessage,
      fileError: conflictMessage,
      saveStatus: 'error'
    }
  }
  return {
    ...latest,
    officePreview,
    spreadsheetSourceSha256: officePreview.sourceSha256,
    spreadsheetConflictPreview: null,
    officeLoading: false,
    officeRefreshError: null,
    fileError: null,
    fileSize: officePreview.size,
    ...(sourceChanged ? {
      officeSemanticText: '',
      officeSemanticSha256: '',
      officeSemanticTruncated: false,
      selection: emptySelection()
    } : {})
  }
}

function patchOfficeDocument(
  path: string,
  patch: Partial<Pick<
    import('../../write/write-workspace-store').WriteDocumentSession,
    'officeLoading' | 'officeAgentEditing' | 'officeRefreshError'
  >>
): void {
  useWriteWorkspaceStore.setState((current) => {
    const key = writeDocumentKey(path)
    const latest = current.documentsByPath[key]
    if (!latest || latest.kind !== 'office') return {}
    const documentsByPath = {
      ...current.documentsByPath,
      [key]: { ...latest, ...patch }
    }
    return { documentsByPath, ...projectFocusedDocument(current.editorLayout, documentsByPath) }
  })
}
