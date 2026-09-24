import { useCallback, useEffect, useState } from 'react'
import type { AttachmentReference } from '../../agent/types'
import type { CoreRuntimeInfoJson } from '../../agent/kun-contract'
import { getProvider } from '../../agent/registry'
import { isChatAttachmentUploadEnabled } from '../../lib/attachment-upload-availability'
import { useWorkbenchAttachmentController } from '../../components/workbench/useWorkbenchAttachmentController'
import { useWorkbenchComposerCapabilities } from '../../components/workbench/useWorkbenchComposerCapabilities'
import type { ChatState } from '../../store/chat-store-types'

export function useMobileCodeAttachments(input: {
  activeThreadId: string | null
  mode: ChatState['composerMode']
  model: string
  providerId: string
  modelGroups: ChatState['composerModelGroups']
  runtimeConnection: ChatState['runtimeConnection']
  workspaceRoot: string
}) {
  const [attachments, setAttachments] = useState<AttachmentReference[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfoJson | null>(null)

  useEffect(() => {
    let cancelled = false
    if (input.runtimeConnection !== 'ready') {
      setRuntimeInfo(null)
      return undefined
    }
    const provider = getProvider()
    void (provider.getRuntimeInfo?.() ?? Promise.resolve(null)).then((info) => {
      if (!cancelled) setRuntimeInfo(info)
    }).catch(() => { if (!cancelled) setRuntimeInfo(null) })
    return () => { cancelled = true }
  }, [input.runtimeConnection])

  useEffect(() => {
    setAttachments([])
    setError(null)
  }, [input.activeThreadId])

  const capabilities = useWorkbenchComposerCapabilities({
    route: 'chat', rightPanelMode: null,
    designAssistantModel: '', resolvedDesignAssistantProviderId: '',
    writeAssistantModel: '', resolvedWriteAssistantProviderId: '',
    composerModel: input.model, composerProviderId: input.providerId,
    composerModelGroups: input.modelGroups, runtimeInfo
  })
  const enabled = isChatAttachmentUploadEnabled({
    runtimeConnection: input.runtimeConnection,
    route: 'chat', mode: input.mode,
    attachmentStoreAvailable: runtimeInfo?.capabilities.attachments.available,
    modelSupportsImageInput: capabilities.selectedModelSupportsImageInput
  })
  const update = useCallback((updater: AttachmentReference[] | ((current: AttachmentReference[]) => AttachmentReference[])) => {
    setAttachments((current) => typeof updater === 'function' ? updater(current) : updater)
  }, [])
  const controller = useWorkbenchAttachmentController({
    attachmentUploadEnabled: enabled,
    selectedModelSupportsImageInput: capabilities.selectedModelSupportsImageInput,
    attachmentCapabilities: runtimeInfo?.capabilities.attachments,
    activeThreadId: input.activeThreadId,
    setAttachmentUploadBusy: setBusy,
    setAttachmentUploadError: setError,
    setComposerAttachmentsForScope: (_scope, updater) => update(updater),
    setComposerAttachments: update,
    getAttachmentScope: () => 'chat',
    getActiveWorkspace: () => input.workspaceRoot || undefined
  })
  return {
    attachments,
    busy,
    error,
    enabled,
    pick: controller.handlePickAttachments,
    remove: controller.removeComposerAttachment,
    clear: () => setAttachments([]),
    /** Puts back attachments of a rejected send ahead of any picked since. */
    restore: (items: readonly AttachmentReference[]) => setAttachments((current) => [
      ...items,
      ...current.filter((item) => !items.some((restored) => restored.id === item.id))
    ])
  }
}
