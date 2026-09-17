import {
  ensureDocumentDir,
  flushDocumentsIndex,
  removePersistedDesignDocument
} from './design-document-persistence'
import { createDesignDocumentId } from './design-types'
import type { DesignDocument } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import { projectActiveDoc } from './design-workspace-store/helpers'
import {
  markDesignArtifactRemoved,
  markDesignDocumentRemoved,
  markDesignDocumentUserCreated
} from './design-workspace-registry'
import {
  normalizeDesignWorkspaceRoot,
  resetDesignWorkspaceTransientStores
} from './design-workspace-lifecycle'
import {
  createDesignWorkspaceFolder,
  createDesignWorkspaceFolderId,
  deleteDesignWorkspaceFolder,
  designFolderNameExists,
  renameDesignWorkspaceFolder
} from './design-workspace-folders'

type StoreSet = (
  update: Partial<DesignWorkspaceState> | ((state: DesignWorkspaceState) => Partial<DesignWorkspaceState>)
) => void

type StoreBridge = {
  get: () => DesignWorkspaceState
  set: StoreSet
  persistIndex: () => void
  persistIndexNow: () => void
  indexState: () => Pick<
    DesignWorkspaceState,
    'workspaceRoot' | 'documents' | 'activeDocumentId' | 'workspaceFolders'
  >
}

type DocumentActions = Pick<
  DesignWorkspaceState,
  | 'createDocument'
  | 'beginDrawingCreation'
  | 'beginDrawingSubmission'
  | 'endDrawingSubmission'
  | 'finishDrawingCreation'
  | 'cancelDrawingCreation'
  | 'renameDocument'
  | 'setDocumentEngine'
  | 'moveDocument'
  | 'createWorkspaceFolder'
  | 'renameWorkspaceFolder'
  | 'removeWorkspaceFolder'
  | 'beginDrawingHistoryMutation'
  | 'endDrawingHistoryMutation'
  | 'removeDocument'
  | 'switchActiveDocument'
  | 'ensureActiveDocument'
>

export function createDesignWorkspaceDocumentActions({
  get,
  set,
  persistIndex,
  persistIndexNow,
  indexState
}: StoreBridge): DocumentActions {
  return {
    createDocument: (title, options) => {
      const id = createDesignDocumentId()
      const createdAt = new Date().toISOString()
      if (!options?.transient) markDesignDocumentUserCreated(get().workspaceRoot, id)
      set((state) => {
        const order = state.documents.reduce((max, d) => Math.max(max, d.order), -1) + 1
        const requestedFolderId = options?.folderId ?? state.drawingCreationFolderId
        const folderId = requestedFolderId && state.workspaceFolders.some((folder) => folder.id === requestedFolderId)
          ? requestedFolderId
          : null
        const doc: DesignDocument = {
          id,
          title: (title ?? '').trim() || id,
          ...(options?.titleOrigin ? { titleOrigin: options.titleOrigin } : {}),
          createdAt,
          updatedAt: createdAt,
          order,
          folderId,
          artifacts: [],
          activeArtifactId: null,
          ...(options?.engine === 'excalidraw' ? { engine: 'excalidraw' as const } : {})
        }
        const documents = [...state.documents, doc]
        return {
          documents,
          activeDocumentId: id,
          ...(options?.transient ? { drawingCreationDocumentId: id } : {}),
          ...projectActiveDoc(documents, id),
          fileError: null
        }
      })
      void ensureDocumentDir(get().workspaceRoot, id)
      if (options?.transient) persistIndex()
      else persistIndexNow()
      return id
    },

    beginDrawingCreation: (options) => {
      if (get().drawingCreationSubmitting) return
      resetDesignWorkspaceTransientStores()
      set((state) => {
        const provisionalId =
          state.drawingCreationDocumentId &&
          state.documents.some((document) => document.id === state.drawingCreationDocumentId)
            ? state.drawingCreationDocumentId
            : null
        return {
          drawingCreationOpen: true,
          drawingCreationFolderId:
            options?.folderId && state.workspaceFolders.some((folder) => folder.id === options.folderId)
              ? options.folderId
              : null,
          drawingCreationReturnDocumentId:
            state.drawingCreationOpen
              ? state.drawingCreationReturnDocumentId
              : state.activeDocumentId,
          activeDocumentId: provisionalId,
          ...projectActiveDoc(state.documents, provisionalId),
          fileError: null
        }
      })
    },

    beginDrawingSubmission: () => {
      if (get().drawingCreationSubmitting) return false
      set({ drawingCreationSubmitting: true })
      return true
    },

    endDrawingSubmission: () => set({ drawingCreationSubmitting: false }),

    finishDrawingCreation: (documentId) => {
      const targetId = (documentId ?? get().activeDocumentId ?? '').trim()
      if (!targetId || !get().documents.some((doc) => doc.id === targetId)) {
        set({ drawingCreationSubmitting: false })
        return
      }
      markDesignDocumentUserCreated(get().workspaceRoot, targetId)
      set((state) => ({
        drawingCreationOpen: false,
        drawingCreationReturnDocumentId: null,
        drawingCreationDocumentId: null,
        drawingCreationSubmitting: false,
        drawingCreationFolderId: null,
        activeDocumentId: targetId,
        ...projectActiveDoc(state.documents, targetId),
        fileError: null
      }))
      persistIndexNow()
    },

    cancelDrawingCreation: () => {
      set((state) => {
        if (!state.drawingCreationOpen) return { drawingCreationSubmitting: false }
        const committedDocuments = state.documents.filter(
          (document) => document.id !== state.drawingCreationDocumentId
        )
        const targetId =
          state.drawingCreationReturnDocumentId &&
          committedDocuments.some((doc) => doc.id === state.drawingCreationReturnDocumentId)
            ? state.drawingCreationReturnDocumentId
            : committedDocuments[0]?.id ?? null
        return {
          drawingCreationOpen: false,
          drawingCreationReturnDocumentId: null,
          drawingCreationSubmitting: false,
          drawingCreationFolderId: null,
          activeDocumentId: targetId,
          ...projectActiveDoc(state.documents, targetId),
          fileError: null
        }
      })
    },

    renameDocument: (documentId, title, options) => {
      const trimmed = title.trim()
      if (!trimmed) return
      set((state) => ({
        documents: state.documents.map((d) =>
          d.id === documentId
            ? {
                ...d,
                title: trimmed,
                titleOrigin: options?.titleOrigin ?? 'user',
                updatedAt: new Date().toISOString()
              }
            : d
        )
      }))
      persistIndexNow()
    },

    setDocumentEngine: (documentId, engine) => {
      const current = get().documents.find((document) => document.id === documentId)
      if (!current) return false
      if (current.artifacts.some((artifact) => artifact.kind === 'html' || artifact.kind === 'svg')) return false
      const nextEngine = engine === 'excalidraw' ? 'excalidraw' as const : undefined
      if ((current.engine ?? 'kun') === (nextEngine ?? 'kun')) return true
      set((state) => ({
        documents: state.documents.map((document) => {
          if (document.id !== documentId) return document
          if (nextEngine) return { ...document, engine: nextEngine, updatedAt: new Date().toISOString() }
          const { engine: _removed, ...rest } = document
          return { ...rest, updatedAt: new Date().toISOString() }
        })
      }))
      persistIndexNow()
      return true
    },

    moveDocument: (documentId, folderId) => {
      const targetFolderId = folderId?.trim() || null
      set((state) => {
        const document = state.documents.find((item) => item.id === documentId)
        if (!document) return {}
        if (targetFolderId && !state.workspaceFolders.some((folder) => folder.id === targetFolderId)) return {}
        if ((document.folderId ?? null) === targetFolderId) return {}
        return {
          documents: state.documents.map((item) =>
            item.id === documentId
              ? { ...item, folderId: targetFolderId, updatedAt: new Date().toISOString() }
              : item
          )
        }
      })
      persistIndexNow()
    },

    createWorkspaceFolder: (name, parentId = null) => {
      const state = get()
      const targetParentId = parentId?.trim() || null
      if (designFolderNameExists(state.workspaceFolders, name, targetParentId)) return null
      const id = createDesignWorkspaceFolderId()
      const workspaceFolders = createDesignWorkspaceFolder(state.workspaceFolders, {
        id,
        name,
        parentId: targetParentId
      })
      if (!workspaceFolders.some((folder) => folder.id === id)) return null
      set({ workspaceFolders })
      persistIndexNow()
      return id
    },

    renameWorkspaceFolder: (folderId, name) => {
      const workspaceFolders = renameDesignWorkspaceFolder(get().workspaceFolders, folderId, name)
      if (workspaceFolders === get().workspaceFolders) return
      set({ workspaceFolders })
      persistIndexNow()
    },

    removeWorkspaceFolder: (folderId) => {
      const state = get()
      const deleted = deleteDesignWorkspaceFolder(state.workspaceFolders, folderId)
      if (!state.workspaceFolders.some((folder) => folder.id === folderId)) return
      set({
        workspaceFolders: deleted.folders,
        documents: state.documents.map((document) =>
          document.folderId === folderId
            ? { ...document, folderId: deleted.parentId, updatedAt: new Date().toISOString() }
            : document
        )
      })
      persistIndexNow()
    },

    beginDrawingHistoryMutation: (workspaceRoot, documentId, kind) => {
      const normalizedWorkspaceRoot = normalizeDesignWorkspaceRoot(workspaceRoot)
      const normalizedDocumentId = documentId.trim()
      if (!normalizedWorkspaceRoot || !normalizedDocumentId || get().drawingHistoryMutation) {
        return false
      }
      set({
        drawingHistoryMutation: {
          workspaceRoot: normalizedWorkspaceRoot,
          documentId: normalizedDocumentId,
          kind
        }
      })
      return true
    },

    endDrawingHistoryMutation: (workspaceRoot, documentId) => {
      const current = get().drawingHistoryMutation
      if (
        !current ||
        current.workspaceRoot !== normalizeDesignWorkspaceRoot(workspaceRoot) ||
        current.documentId !== documentId.trim()
      ) return
      set({ drawingHistoryMutation: null })
    },

    removeDocument: async (documentId) => {
      const snapshot = get()
      const workspaceRoot = snapshot.workspaceRoot
      const doc = snapshot.documents.find((d) => d.id === documentId)
      if (!workspaceRoot || !doc) return false
      const removingProvisionalDrawing = snapshot.drawingCreationDocumentId === documentId
      const fallbackDocuments = removingProvisionalDrawing
        ? snapshot.documents.filter((document) => document.id !== documentId)
        : snapshot.documents
      const fallbackActiveDocumentId = removingProvisionalDrawing
        ? snapshot.drawingCreationReturnDocumentId &&
            fallbackDocuments.some(
              (document) => document.id === snapshot.drawingCreationReturnDocumentId
            )
          ? snapshot.drawingCreationReturnDocumentId
          : fallbackDocuments[0]?.id ?? null
        : snapshot.activeDocumentId
      const removed = await removePersistedDesignDocument({
        workspaceRoot,
        documentId,
        fallbackDocuments,
        fallbackActiveDocumentId,
        fallbackFolders: snapshot.workspaceFolders
      })
      if (!removed) return false

      markDesignDocumentRemoved(workspaceRoot, documentId)
      for (const artifact of doc.artifacts) {
        markDesignArtifactRemoved(workspaceRoot, artifact.id)
      }
      if (
        normalizeDesignWorkspaceRoot(get().workspaceRoot) !==
          normalizeDesignWorkspaceRoot(workspaceRoot)
      ) return true
      set((state) => {
        const documents = state.documents.filter((d) => d.id !== documentId)
        const activeDocumentId =
          state.activeDocumentId === documentId ? documents[0]?.id ?? null : state.activeDocumentId
        const drawingCreationReturnDocumentId =
          state.drawingCreationReturnDocumentId === documentId
            ? documents[0]?.id ?? null
            : state.drawingCreationReturnDocumentId
        return {
          documents,
          activeDocumentId,
          drawingCreationReturnDocumentId,
          drawingCreationDocumentId:
            state.drawingCreationDocumentId === documentId
              ? null
              : state.drawingCreationDocumentId,
          ...projectActiveDoc(documents, activeDocumentId),
          fileError: null
        }
      })
      // A debounced index write can be scheduled while the directory deletion
      // is in flight. Replace it with the final in-memory projection so that a
      // stale documents.json cannot resurrect the deleted drawing.
      const finalIndexState = indexState()
      await flushDocumentsIndex(
        finalIndexState.workspaceRoot,
        finalIndexState.documents,
        finalIndexState.activeDocumentId,
        finalIndexState.workspaceFolders
      )
      return true
    },

    switchActiveDocument: (documentId) => {
      set((state) => {
        if (!state.documents.some((d) => d.id === documentId)) return {}
        return { activeDocumentId: documentId, ...projectActiveDoc(state.documents, documentId), fileError: null }
      })
      persistIndex()
    },

    ensureActiveDocument: () => {
      const state = get()
      if (state.activeDocumentId && state.documents.some((d) => d.id === state.activeDocumentId)) {
        return state.activeDocumentId
      }
      if (state.documents.length > 0) {
        const id = state.documents[0].id
        set({ activeDocumentId: id, ...projectActiveDoc(state.documents, id) })
        persistIndex()
        return id
      }
      return get().createDocument(undefined, { transient: true })
    }
  }
}
