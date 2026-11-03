import { useCallback, useMemo, useRef, useState } from 'react'
import { modelSupportsImageInput } from '@shared/app-settings-provider-core'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { useChatStore } from '../../store/chat-store'
import type { SideConversation } from '../../store/chat-store-types'
import type { AttachmentReference } from '../../agent/types'
import { uploadRuntimePastedText } from '../../lib/runtime-attachment'
import { modelProfileForComposerSelection } from '../workbench/useWorkbenchComposerCapabilities'
import {
  runtimeImagePreviewUrl,
  runtimeImageSourceForFile,
  uploadRuntimeImageAttachment
} from '../../lib/runtime-image-attachment'

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * Attachment state for one branch conversation. Uploads target the active
 * branch thread, or the unsaved draft, and never the main composer.
 */
export function useSideConversationAttachments(input: {
  attachmentStoreAvailable: boolean
  attachmentWorkspace: string
  runtimeReady: boolean
  activeSide: SideConversation | null
  model: string
  providerId: string
  modelGroups: ModelProviderModelGroup[]
  defaultModelSupportsImageInput: boolean
  t: Translate
}) {
  const {
    attachmentStoreAvailable, attachmentWorkspace, runtimeReady, activeSide,
    model, providerId, modelGroups, defaultModelSupportsImageInput, t
  } = input
  const [draftAttachments, setDraftAttachments] = useState<AttachmentReference[]>([])
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const draftGenerationRef = useRef(0)

  const selectedProviderGroup = providerId.trim()
    ? modelGroups.find((group) => group.providerId === providerId.trim())
    : undefined
  const selectedModelProfile = providerId.trim()
    ? selectedProviderGroup
      ? modelProfileForComposerSelection([selectedProviderGroup], model, providerId.trim())
      : undefined
    : modelProfileForComposerSelection(modelGroups, model)
  const modelSupportsImages = model.trim().toLowerCase() === 'auto'
    ? defaultModelSupportsImageInput
    : selectedModelProfile
      ? modelSupportsImageInput(selectedModelProfile)
      : false
  const uploadEnabled = runtimeReady && attachmentStoreAvailable

  const resetDraftAttachments = useCallback((): void => {
    setDraftAttachments([])
    setUploadError(null)
    draftGenerationRef.current += 1
  }, [])

  const appendUploadedAttachment = useCallback((
    targetSideId: string | null,
    draftGeneration: number,
    attachment: AttachmentReference
  ): void => {
    if (targetSideId) {
      const target = useChatStore.getState().sideConversations[targetSideId]
      if (!target) return
      const byId = new Map(target.attachments.map((item) => [item.id, item]))
      byId.set(attachment.id, attachment)
      useChatStore.getState().setSideAttachments(targetSideId, [...byId.values()])
      return
    }
    if (draftGenerationRef.current !== draftGeneration) return
    setDraftAttachments((current) => {
      const byId = new Map(current.map((item) => [item.id, item]))
      byId.set(attachment.id, attachment)
      return [...byId.values()]
    })
  }, [])

  const pickImages = useCallback(async (
    files?: File[],
    options: { clipboard?: boolean; silentNoImage?: boolean } = {}
  ): Promise<void> => {
    if (!uploadEnabled || !attachmentWorkspace) {
      setUploadError(t('composerAttachmentUnavailable'))
      return
    }
    if (!modelSupportsImages) {
      setUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const imageFiles = files?.filter((file) => file.type.startsWith('image/')) ?? []
    if (!options.clipboard && imageFiles.length !== (files?.length ?? 0)) {
      setUploadError(t('composerAttachmentUnsupportedType'))
      return
    }
    const targetSideId = activeSide?.threadId ?? null
    const draftGeneration = draftGenerationRef.current
    const targetIsCurrent = (): boolean => targetSideId
      ? useChatStore.getState().sidePanel.activeSideId === targetSideId
      : useChatStore.getState().sidePanel.activeSideId === null &&
        draftGenerationRef.current === draftGeneration
    setUploadBusy(true)
    setUploadError(null)
    try {
      const sources = options.clipboard ? [null] : imageFiles
      for (const file of sources) {
        const localFilePath = file && typeof window.kunGui?.getPathForFile === 'function'
          ? window.kunGui.getPathForFile(file)
          : ''
        const result = await uploadRuntimeImageAttachment({
          source: file
            ? await runtimeImageSourceForFile(file, localFilePath)
            : { kind: 'clipboard' },
          ...(file?.name ? { name: file.name } : {}),
          ...(targetSideId ? { threadId: targetSideId } : { workspace: attachmentWorkspace })
        })
        appendUploadedAttachment(targetSideId, draftGeneration, {
          id: result.attachment.id,
          kind: 'image',
          name: result.attachment.name,
          mimeType: result.attachment.mimeType,
          width: result.attachment.width,
          height: result.attachment.height,
          previewUrl: runtimeImagePreviewUrl(result)
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        targetIsCurrent() &&
        (!options.silentNoImage || !/clipboard does not currently contain an image/i.test(message))
      ) {
        setUploadError(message)
      }
    } finally {
      setUploadBusy(false)
    }
  }, [activeSide, appendUploadedAttachment, attachmentWorkspace, modelSupportsImages, t, uploadEnabled])

  const pasteLongText = useCallback(async (text: string): Promise<void> => {
    if (!uploadEnabled || !attachmentWorkspace) {
      setUploadError(t('composerAttachmentUnavailable'))
      return
    }
    const targetSideId = activeSide?.threadId ?? null
    const draftGeneration = draftGenerationRef.current
    setUploadBusy(true)
    setUploadError(null)
    try {
      const attachment = await uploadRuntimePastedText({
        text,
        ...(targetSideId ? { threadId: targetSideId } : { workspace: attachmentWorkspace })
      })
      appendUploadedAttachment(targetSideId, draftGeneration, attachment)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploadBusy(false)
    }
  }, [activeSide, appendUploadedAttachment, attachmentWorkspace, t, uploadEnabled])

  const removeAttachment = useCallback((id: string): void => {
    if (activeSide) {
      useChatStore.getState().setSideAttachments(
        activeSide.threadId,
        activeSide.attachments.filter((attachment) => attachment.id !== id)
      )
      return
    }
    setDraftAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }, [activeSide])

  const attachments = useMemo(
    () => activeSide?.attachments ?? draftAttachments,
    [activeSide, draftAttachments]
  )

  return {
    attachments,
    uploadEnabled,
    uploadBusy,
    uploadError,
    reportError: setUploadError,
    clearUploadError: () => setUploadError(null),
    resetDraftAttachments,
    modelSupportsImages,
    pickImages,
    pasteClipboardImage: (options?: { silentNoImage?: boolean }) =>
      pickImages(undefined, { clipboard: true, silentNoImage: options?.silentNoImage }),
    pasteLongText,
    removeAttachment
  }
}

export type SideConversationAttachmentsState = ReturnType<typeof useSideConversationAttachments>
