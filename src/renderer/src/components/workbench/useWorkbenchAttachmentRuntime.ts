import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoreRuntimeInfoJson } from '../../agent/kun-contract'
import type { AttachmentReference, NormalizedThread, RuntimeConnectionStatus } from '../../agent/types'
import type { CanvasDocument } from '../../design/canvas/canvas-types'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { getProvider } from '../../agent/registry'
import { attachmentPreviewLoader } from '../chat/attachment-preview-loader'
import { isChatAttachmentUploadEnabled } from '../../lib/attachment-upload-availability'
import { useSddDraftStore } from '../../sdd/sdd-draft-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { useCanvasImageAutoAttachment } from '../design/useCanvasImageAutoAttachment'
import {
  composerAttachmentScopeForSurface,
  createEmptyComposerAttachmentsByScope,
  removeComposerAttachmentsById,
  updateComposerAttachmentsByScope,
  type ComposerAttachmentScope,
  type ComposerAttachmentUpdater
} from '../workbench-composer-attachments'
import { useWorkbenchAttachmentController } from './useWorkbenchAttachmentController'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import type { ComposerFileReference } from '../chat/FloatingComposer'
import {
  runtimeImagePreviewUrl,
  uploadRuntimeImageAttachment
} from '../../lib/runtime-image-attachment'

type WorkbenchAttachmentRuntimeOptions = {
  activeThreadId: string | null
  canvasDocument: CanvasDocument
  canvasSelectedIds: ReadonlySet<string>
  composerMode: 'plan' | 'agent' | 'auto'
  modelUnsupportedMessage: string
  rightPanelMode: RightPanelMode | null
  route: string
  taskSurface?: 'code' | 'design'
  runtimeConnection: RuntimeConnectionStatus
  runtimeInfo: CoreRuntimeInfoJson | null
  selectedModelSupportsImageInput: boolean
  threads: NormalizedThread[]
  workspaceRoot: string
  onFallbackToFileReference?: (reference: ComposerFileReference) => void
}

export function useWorkbenchAttachmentRuntime({
  activeThreadId,
  canvasDocument,
  canvasSelectedIds,
  composerMode,
  modelUnsupportedMessage,
  rightPanelMode,
  route,
  taskSurface = 'code',
  runtimeConnection,
  runtimeInfo,
  selectedModelSupportsImageInput,
  threads,
  workspaceRoot,
  onFallbackToFileReference
}: WorkbenchAttachmentRuntimeOptions) {
  const [composerAttachmentsByScope, setComposerAttachmentsByScope] = useState(
    createEmptyComposerAttachmentsByScope
  )
  const [attachmentUploadBusy, setAttachmentUploadBusy] = useState(false)
  const [attachmentUploadError, setAttachmentUploadError] = useState<string | null>(null)
  const composerAttachmentScope = composerAttachmentScopeForSurface(route, rightPanelMode)
  const composerAttachmentScopeRef = useRef<ComposerAttachmentScope>(composerAttachmentScope)

  useEffect(() => {
    composerAttachmentScopeRef.current = composerAttachmentScope
  }, [composerAttachmentScope])

  const composerAttachments = composerAttachmentsByScope[composerAttachmentScope]
  const setComposerAttachmentsForScope = useCallback((
    scope: ComposerAttachmentScope,
    updater: ComposerAttachmentUpdater
  ): void => {
    setComposerAttachmentsByScope((current) => updateComposerAttachmentsByScope(current, scope, updater))
  }, [])
  const setComposerAttachments = useCallback((updater: ComposerAttachmentUpdater): void => {
    setComposerAttachmentsForScope(composerAttachmentScopeRef.current, updater)
  }, [setComposerAttachmentsForScope])
  const attachmentUploadEnabled = isChatAttachmentUploadEnabled({
    runtimeConnection,
    route,
    mode: composerMode,
    attachmentStoreAvailable: runtimeInfo?.capabilities.attachments.available,
    modelSupportsImageInput: selectedModelSupportsImageInput
  })
  const webAccessAvailable =
    runtimeInfo?.capabilities.web.fetch.available === true ||
    runtimeInfo?.capabilities.web.search.available === true

  useEffect(() => {
    setAttachmentUploadError((prev) => {
      if (prev !== modelUnsupportedMessage) return prev
      if (composerAttachments.length === 0 || selectedModelSupportsImageInput) return null
      return prev
    })
  }, [composerAttachments.length, modelUnsupportedMessage, selectedModelSupportsImageInput])

  useEffect(() => {
    setAttachmentUploadError(null)
  }, [composerAttachmentScope])

  const activeComposerWorkspace = useCallback((): string | undefined => {
    const sddDraft = useSddDraftStore.getState().activeDraft
    if (rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi && sddDraft?.workspaceRoot) return sddDraft.workspaceRoot
    const designWorkspace = useDesignWorkspaceStore.getState().workspaceRoot
    if ((route === 'design' || taskSurface === 'design') && designWorkspace.trim()) {
      return designWorkspace
    }
    const writeWorkspace = useWriteWorkspaceStore.getState().workspaceRoot
    if (route === 'write' && writeWorkspace.trim()) return writeWorkspace
    return threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot || undefined
  }, [activeThreadId, rightPanelMode, route, taskSurface, threads, workspaceRoot])

  const { clearAutoAttachment: clearCanvasImageAutoAttachment } = useCanvasImageAutoAttachment({
    route: taskSurface === 'design' && route === 'chat' ? 'design' : route,
    attachmentScope: composerAttachmentScope === 'chat' ? 'chat' : 'design',
    selectedIds: canvasSelectedIds,
    document: canvasDocument,
    workspaceRoot,
    activeThreadId,
    attachmentCapabilities: runtimeInfo?.capabilities.attachments,
    setComposerAttachmentsForScope,
    getActiveWorkspace: activeComposerWorkspace
  })

  const clearComposerAttachments = (scope = composerAttachmentScopeRef.current): void => {
    setComposerAttachmentsForScope(scope, [])
    if (scope === 'design' || (scope === 'chat' && taskSurface === 'design')) {
      clearCanvasImageAutoAttachment()
    }
  }

  const removeComposerAttachments = (
    ids: readonly string[],
    scope = composerAttachmentScopeRef.current
  ): void => {
    if (ids.length === 0) return
    setComposerAttachmentsForScope(
      scope,
      (current) => removeComposerAttachmentsById(current, ids)
    )
  }

  const addComposerImageBase64 = useCallback(async (input: {
    dataBase64: string
    mimeType: string
    name: string
  }): Promise<string | null> => {
    if (!attachmentUploadEnabled || !selectedModelSupportsImageInput) return null
    const scope = composerAttachmentScopeRef.current
    setAttachmentUploadBusy(true)
    setAttachmentUploadError(null)
    try {
      const workspace = activeComposerWorkspace()
      const result = await uploadRuntimeImageAttachment({
        source: {
          kind: 'base64',
          dataBase64: input.dataBase64,
          mimeType: input.mimeType
        },
        name: input.name,
        ...(activeThreadId ? { threadId: activeThreadId } : {}),
        ...(workspace ? { workspace } : {})
      })
      const attachment: AttachmentReference = {
        id: result.attachment.id,
        kind: 'image',
        name: result.attachment.name,
        mimeType: result.attachment.mimeType,
        width: result.attachment.width,
        height: result.attachment.height,
        previewUrl: runtimeImagePreviewUrl(result)
      }
      setComposerAttachmentsForScope(scope, (current) => {
        const byId = new Map(current.map((item) => [item.id, item]))
        byId.set(attachment.id, attachment)
        return [...byId.values()]
      })
      return attachment.id
    } catch (error) {
      setAttachmentUploadError(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      setAttachmentUploadBusy(false)
    }
  }, [
    activeThreadId,
    activeComposerWorkspace,
    attachmentUploadEnabled,
    selectedModelSupportsImageInput,
    setComposerAttachmentsForScope
  ])

  const {
    handlePickAttachments,
    handlePasteClipboardImage,
    removeComposerAttachment
  } = useWorkbenchAttachmentController({
    attachmentUploadEnabled,
    selectedModelSupportsImageInput,
    attachmentCapabilities: runtimeInfo?.capabilities.attachments,
    activeThreadId,
    setAttachmentUploadBusy,
    setAttachmentUploadError,
    setComposerAttachmentsForScope,
    setComposerAttachments,
    getAttachmentScope: () => composerAttachmentScopeRef.current,
    getActiveWorkspace: activeComposerWorkspace,
    onFallbackToFileReference
  })

  // Returns a queued message's attachments to the composer: merge references
  // by id (documents are restored as reference chips only), then lazily fetch
  // missing image thumbnails from the attachment store. Preview failures stay
  // silent; the composer already renders a file-name chip for attachments
  // without a previewUrl.
  const restoreComposerAttachments = useCallback(async (
    attachments: readonly AttachmentReference[],
    scope = composerAttachmentScopeRef.current
  ): Promise<void> => {
    if (attachments.length === 0) return
    setComposerAttachmentsForScope(scope, (current) => {
      const byId = new Map(current.map((item) => [item.id, item]))
      for (const attachment of attachments) byId.set(attachment.id, attachment)
      return [...byId.values()]
    })
    const images = attachments.filter((attachment) => attachment.kind !== 'document')
    if (images.length === 0) return
    const workspace = activeComposerWorkspace()
    const provider = getProvider()
    await Promise.all(images.map(async (attachment) => {
      if (attachment.previewUrl) return
      if (typeof provider.getAttachmentContent !== 'function') return
      try {
        const preview = await attachmentPreviewLoader.load(
          JSON.stringify(['attachment', attachment.id, activeThreadId ?? '', workspace ?? '']),
          async () => {
            const content = await provider.getAttachmentContent!(attachment.id, {
              ...(activeThreadId ? { threadId: activeThreadId } : {}),
              ...(workspace ? { workspace } : {})
            })
            return {
              previewUrl: `data:${content.attachment.mimeType};base64,${content.dataBase64}`
            }
          }
        )
        setComposerAttachmentsForScope(scope, (current) => current.map((item) =>
          item.id === attachment.id ? { ...item, previewUrl: preview.previewUrl } : item
        ))
      } catch {
        // Keep the name chip; the queued send already holds the attachment id.
      }
    }))
  }, [
    activeThreadId,
    activeComposerWorkspace,
    setComposerAttachmentsForScope
  ])

  return {
    attachmentUploadBusy,
    attachmentUploadEnabled,
    attachmentUploadError,
    addComposerImageBase64,
    clearComposerAttachments,
    composerAttachments,
    getAttachmentScope: () => composerAttachmentScopeRef.current,
    handlePasteClipboardImage,
    handlePickAttachments,
    removeComposerAttachments,
    removeComposerAttachment,
    restoreComposerAttachments,
    setAttachmentUploadError,
    webAccessAvailable
  }
}
