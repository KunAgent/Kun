import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { buildGuiPlanId, buildPlanRelativePath } from '@shared/gui-plan'
import { sddDraftTraceRelativePath } from '@shared/sdd'
import { buildSddTraceSnapshot } from '@shared/sdd-trace'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { AttachmentReference, ChatBlock, RuntimeConnectionStatus } from '../../agent/types'
import type { CoreRuntimeInfoJson } from '../../agent/kun-contract'
import { useChatStore } from '../../store/chat-store'
import type { ChatState, SendMessageOverrides } from '../../store/chat-store-types'
import { providerIdForComposerModel } from '../../store/chat-store-helpers'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { PENDING_INFOGRAPHIC_PROTOCOL } from '../../write/infographic-pending'
import { confirmDialog } from '../../lib/confirm-dialog'
import { uploadRuntimeImageAttachment } from '../../lib/runtime-image-attachment'
import {
  composerReasoningEffortRequestValue,
  type ComposerReasoningEffort
} from '../chat/FloatingComposerModelPicker'
import { serviceTierForComposerSelection } from '../chat/composer-fast-mode'
import {
  firstVisionCapableComposerModel
} from './useWorkbenchComposerCapabilities'
import type { ComposerAttachmentScope } from '../workbench-composer-attachments'
import {
  buildComposerDocumentContextPrompt,
  stripTransientAttachmentFields
} from './workbench-composer-prompts'
import {
  collectSddDraftImages,
  withAttachmentIds,
  type SddDraftImageReference
} from '../../sdd/sdd-draft-images'
import { forgetRememberedSddDraft, useSddDraftStore, type SddDraft } from '../../sdd/sdd-draft-store'
import { saveActiveSddDraftToDisk } from '../../sdd/sdd-draft-actions'
import {
  releaseSddAssistantThreadsForDraft,
  showSddAssistantThreadInSidebar
} from '../../sdd/sdd-thread-registry'
import { composeSddAssistantPrompt } from '../../sdd/sdd-assistant-prompt'
import { frameworkById } from '../../sdd/pm-skill-frameworks'
import { buildSddDraftToPlanPrompt } from '../../sdd/sdd-plan-prompt'
import type { GuiPlanArtifact } from '../../plan/plan-store'
import { createWriteTurnReferenceAttachments } from '../../write/write-turn-reference-context'
import type { WriteQuotedSelection } from '../../write/quoted-selection'

type PendingSddPlanTarget = {
  draft: SddDraft
  planId: string
  relativePath: string
  workspaceRoot: string
}

type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  | 'attachmentIds'
  | 'attachments'
  | 'displayText'
  | 'fileReferences'
  | 'guiPlan'
  | 'model'
  | 'providerId'
  | 'reasoningEffort'
  | 'serviceTier'
> & {
  workspaceRoot?: string
}

type UseWorkbenchSddTurnControllerParams = {
  activeGuiPlan: GuiPlanArtifact | null
  attachmentUploadEnabled: boolean
  blocks: ChatBlock[]
  busy: boolean
  composerAttachments: AttachmentReference[]
  composerMode: 'plan' | 'agent' | 'auto'
  composerModelGroups: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  composerFastMode: boolean
  input: string
  resolvedWriteAssistantProviderId: string
  runtimeConnection: RuntimeConnectionStatus
  runtimeInfo: CoreRuntimeInfoJson | null
  selectedModelSupportsImageInput: boolean
  sendMessage: ChatState['sendMessage']
  sendPlanTurn: (text: string, overrides?: PlanTurnOverrides) => Promise<boolean>
  setAttachmentUploadError: (message: string | null) => void
  setComposerMode: (mode: 'plan' | 'agent') => void
  setError: (message: string | null) => void
  setInput: (value: string) => void
  setWriteAssistantModel: (model: string, providerId?: string) => void
  writeAssistantModel: string
  clearComposerAttachments: (scope?: ComposerAttachmentScope) => void
  ensureSddAssistantThreadForDraft: (draft: SddDraft) => Promise<string | null>
  getAttachmentScope: () => ComposerAttachmentScope
  openSddAssistantPanel: () => Promise<void>
  startNewSddAssistantConversation: () => void
}

export type SddPrototypeTurnPayload = {
  prompt: string
  displayText: string
  image?: { absolutePath: string; alt: string }
}

export type WorkbenchSddTurnController = {
  applySddFramework: (frameworkId: string) => void
  handleSddNextStep: () => Promise<void>
  sendSddAssistantPrompt: (value: string) => Promise<void>
  sendSddPrototypeTurn: (payload: SddPrototypeTurnPayload) => Promise<boolean>
  startNewSddAssistantConversation: () => void
}

function fileNameFromPath(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'image'
}

function sddDraftPlanRelativePath(draft: SddDraft): string {
  const parts = draft.relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  const draftFolder = parts.at(-2)?.trim() || draft.id.split(':').pop()?.trim() || `draft-${Date.now()}`
  return buildPlanRelativePath(`sdd-${draftFolder}`)
}

function sddDraftSourceRequest(markdown: string, fallbackPath: string): string {
  const firstMeaningfulLine = markdown
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean)
  return (firstMeaningfulLine || fallbackPath).slice(0, 160)
}

function sddPlanMatchesPendingTarget(
  plan: { id: string; workspaceRoot: string; relativePath: string } | null,
  target: PendingSddPlanTarget | null
): boolean {
  if (!plan || !target) return false
  if (plan.id === target.planId) return true
  return buildGuiPlanId(plan.workspaceRoot, plan.relativePath) === target.planId
}

function sddAssistantContextFromBlocks(blocks: ChatBlock[], maxMessages = 10): string {
  const messages: string[] = []
  for (const block of blocks) {
    if (block.kind !== 'user' && block.kind !== 'assistant') continue
    if (block.kind === 'user' && block.meta?.displayText) continue
    const text = block.text.trim()
    if (!text) continue
    messages.push(`${block.kind === 'user' ? 'User' : 'Requirement AI'}:\n${text}`)
  }
  return messages.slice(-maxMessages).join('\n\n').slice(0, 12_000)
}

export function buildSddAssistantModelOverrides(input: {
  model: string
  providerId: string
  reasoningEffort: ComposerReasoningEffort
  fastMode: boolean
  modelGroups: readonly ModelProviderModelGroup[]
}): Pick<SendMessageOverrides, 'model' | 'providerId' | 'reasoningEffort' | 'serviceTier'> {
  const model = input.model.trim()
  const providerId = input.providerId.trim()
  const reasoningEffort = composerReasoningEffortRequestValue(input.reasoningEffort)
  const serviceTier = serviceTierForComposerSelection(
    input.fastMode,
    input.modelGroups,
    model,
    providerId
  )
  return {
    ...(model ? { model } : {}),
    ...(providerId ? { providerId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {})
  }
}

export function createSddReferenceContexts(input: {
  workspaceRoot: string
  query: string
  selections: readonly WriteQuotedSelection[]
}) {
  return createWriteTurnReferenceAttachments({
    workspaceRoot: input.workspaceRoot,
    selections: input.selections,
    retrieval: null,
    officeDocument: null,
    query: input.query
  })
}

export function resolveSddAssistantUserPrompt(
  value: string,
  referenceCount: number,
  referenceOnlyPrompt: string
): string {
  return value.trim() || (referenceCount > 0 ? referenceOnlyPrompt.trim() : '')
}

export function isSddDraftStillActive(
  activeDraft: Pick<SddDraft, 'id'> | null,
  expectedDraft: Pick<SddDraft, 'id'>
): boolean {
  return activeDraft?.id === expectedDraft.id
}

export function useWorkbenchSddTurnController({
  activeGuiPlan,
  attachmentUploadEnabled,
  blocks,
  busy,
  composerAttachments,
  composerMode,
  composerModelGroups,
  composerReasoningEffort,
  composerFastMode,
  input,
  resolvedWriteAssistantProviderId,
  runtimeConnection,
  runtimeInfo,
  selectedModelSupportsImageInput,
  sendMessage,
  sendPlanTurn,
  setAttachmentUploadError,
  setComposerMode,
  setError,
  setInput,
  setWriteAssistantModel,
  writeAssistantModel,
  clearComposerAttachments,
  ensureSddAssistantThreadForDraft,
  getAttachmentScope,
  openSddAssistantPanel,
  startNewSddAssistantConversation: startThreadSddAssistantConversation
}: UseWorkbenchSddTurnControllerParams): WorkbenchSddTurnController {
  const { t } = useTranslation('common')
  const pendingSddFrameworkRef = useRef<string | null>(null)
  const pendingSddFrameworkPromptRef = useRef<string | null>(null)
  const sddUpgradeInFlightRef = useRef(false)
  const sddUpgradeTargetRef = useRef<PendingSddPlanTarget | null>(null)
  const sddDraftOperationStatus = useSddDraftStore((s) => s.operationStatus)

  useEffect(() => {
    if (
      !activeGuiPlan ||
      !sddUpgradeInFlightRef.current ||
      !sddPlanMatchesPendingTarget(activeGuiPlan, sddUpgradeTargetRef.current)
    ) {
      return
    }
    const completedTarget = sddUpgradeTargetRef.current
    sddUpgradeInFlightRef.current = false
    sddUpgradeTargetRef.current = null
    useSddDraftStore.getState().setOperationStatus('idle')
    const completedDraft = completedTarget?.draft ?? null
    const releasedCompletedThreads = completedDraft
      ? releaseSddAssistantThreadsForDraft(completedDraft)
      : false
    if (completedDraft) forgetRememberedSddDraft(completedDraft)
    if (completedDraft && useSddDraftStore.getState().activeDraft?.id === completedDraft.id) {
      useSddDraftStore.getState().clearActiveDraft()
    }
    if (releasedCompletedThreads) void useChatStore.getState().refreshThreads()
  }, [activeGuiPlan])

  useEffect(() => {
    if (
      busy ||
      !sddUpgradeInFlightRef.current ||
      sddDraftOperationStatus !== 'upgrading' ||
      sddPlanMatchesPendingTarget(activeGuiPlan, sddUpgradeTargetRef.current)
    ) {
      return
    }
    const timeout = window.setTimeout(() => {
      if (!sddUpgradeInFlightRef.current) return
      if (useSddDraftStore.getState().operationStatus !== 'upgrading') return
      sddUpgradeInFlightRef.current = false
      sddUpgradeTargetRef.current = null
      useSddDraftStore.getState().setOperationStatus('error', t('planToolResultMissing'))
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [activeGuiPlan, busy, sddDraftOperationStatus, t])

  const applySddFramework = useCallback((frameworkId: string): void => {
    const framework = frameworkById(frameworkId)
    if (!framework?.promptKey) return
    const promptText = t(framework.promptKey)
    setInput(input.trim() ? `${input.trim()}\n\n${promptText}` : promptText)
    pendingSddFrameworkRef.current = framework.guidance ? framework.id : null
    pendingSddFrameworkPromptRef.current = framework.guidance ? promptText : null
  }, [input, setInput, t])

  const uploadSddImagesAsAttachments = useCallback(async (
    images: SddDraftImageReference[],
    threadId: string,
    workspace: string
  ): Promise<{ images: SddDraftImageReference[]; attachmentIds: string[] }> => {
    const attachmentCapabilities = runtimeInfo?.capabilities.attachments
    if (!attachmentCapabilities || typeof window.kunGui?.uploadRuntimeImageAttachment !== 'function') {
      throw new Error(t('composerAttachmentUnavailable'))
    }
    const attachmentIds: string[] = []
    for (const image of images) {
      const result = await uploadRuntimeImageAttachment({
        source: {
          kind: 'base64',
          dataBase64: image.dataBase64,
          mimeType: image.mimeType
        },
        name: fileNameFromPath(image.relativePath),
        threadId,
        workspace
      })
      attachmentIds.push(result.attachment.id)
    }
    return { images: withAttachmentIds(images, attachmentIds), attachmentIds }
  }, [runtimeInfo?.capabilities.attachments, t])

  const sendSddAssistantPrompt = useCallback(async (value: string): Promise<void> => {
    const snapshot = useSddDraftStore.getState()
    const draft = snapshot.activeDraft
    const sentQuoteIds = snapshot.assistantQuotedSelections.map((selection) => selection.id)
    const v = resolveSddAssistantUserPrompt(
      value,
      snapshot.assistantQuotedSelections.length,
      t('writeAssistantPolishSelectionPrompt')
    )
    const attachmentScope = getAttachmentScope()
    const attachments = composerAttachments
    const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const publicAttachments = stripTransientAttachmentFields(attachments)
    if ((!v && attachmentIds.length === 0 && documentAttachments.length === 0) || !draft) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return
    const afterThreadResolution = useSddDraftStore.getState()
    if (!isSddDraftStillActive(afterThreadResolution.activeDraft, draft)) return
    let composerContexts
    try {
      composerContexts = await createSddReferenceContexts({
        workspaceRoot: draft.workspaceRoot,
        selections: snapshot.assistantQuotedSelections,
        query: v
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return
    }
    const beforeSend = useSddDraftStore.getState()
    if (!isSddDraftStillActive(beforeSend.activeDraft, draft)) return
    void saveActiveSddDraftToDisk()
    const userPrompt = buildComposerDocumentContextPrompt(
      v || (documentAttachments.length > 0 ? t('composerFileOnlyPrompt') : t('composerImageOnlyPrompt')),
      documentAttachments
    )
    const pendingPrompt = pendingSddFrameworkPromptRef.current
    const frameworkId =
      pendingSddFrameworkRef.current && pendingPrompt && value.includes(pendingPrompt)
        ? pendingSddFrameworkRef.current
        : null
    const prompt = composeSddAssistantPrompt({
      userPrompt,
      draftMarkdown: beforeSend.content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot,
      ...(frameworkId ? { frameworkIds: [frameworkId] } : {})
    })
    setInput('')
    const modelOverrides = buildSddAssistantModelOverrides({
      model: writeAssistantModel,
      providerId: resolvedWriteAssistantProviderId,
      reasoningEffort: composerReasoningEffort,
      fastMode: composerFastMode,
      modelGroups: composerModelGroups
    })
    const sent = await sendMessage(prompt, composerMode === 'plan' ? 'plan' : 'agent', {
      displayText: v || (documentAttachments.length > 0
        ? t('composerFileOnlyDisplay', { count: documentAttachments.length })
        : t('composerImageOnlyDisplay')),
      ...modelOverrides,
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
      ...(composerContexts.length ? { composerContexts } : {})
    })
    if (sent) {
      if (showSddAssistantThreadInSidebar(threadId)) {
        void useChatStore.getState().refreshThreads()
      }
      pendingSddFrameworkRef.current = null
      pendingSddFrameworkPromptRef.current = null
      if (isSddDraftStillActive(useSddDraftStore.getState().activeDraft, draft)) {
        useSddDraftStore.getState().removeAssistantQuotedSelections(sentQuoteIds)
      }
      if (attachments.length > 0) clearComposerAttachments(attachmentScope)
    } else {
      setInput(v)
    }
  }, [
    attachmentUploadEnabled,
    clearComposerAttachments,
    composerAttachments,
    composerMode,
    composerFastMode,
    composerModelGroups,
    composerReasoningEffort,
    ensureSddAssistantThreadForDraft,
    getAttachmentScope,
    resolvedWriteAssistantProviderId,
    sendMessage,
    setAttachmentUploadError,
    setInput,
    t,
    writeAssistantModel
  ])

  const firstVisionCapableModel = useCallback((): { modelId: string; providerId?: string } | null => {
    return firstVisionCapableComposerModel(composerModelGroups)
  }, [composerModelGroups])

  const sendSddPrototypeTurn = useCallback(async (
    payload: SddPrototypeTurnPayload
  ): Promise<boolean> => {
    const draft = useSddDraftStore.getState().activeDraft
    if (!draft) return false
    if (runtimeConnection !== 'ready') {
      useSddDraftStore.getState().setOperationStatus('error', t('runtimeActionNeedsConnection'))
      return false
    }

    if (payload.image && !selectedModelSupportsImageInput) {
      const visionSelection = firstVisionCapableModel()
      if (!visionSelection) {
        useSddDraftStore.getState().setOperationStatus('error', t('sddPrototypeNoVisionModel'))
        return false
      }
      const switchModel = await confirmDialog(
        t('sddPrototypeSwitchVisionModel', { model: visionSelection.modelId })
      )
      if (!switchModel) return false
      setWriteAssistantModel(visionSelection.modelId, visionSelection.providerId)
    }

    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) return false
    await openSddAssistantPanel()

    let attachmentIds: string[] = []
    if (payload.image) {
      try {
        const read = await window.kunGui.readWorkspaceImage({
          path: payload.image.absolutePath,
          workspaceRoot: draft.workspaceRoot
        })
        if (!read.ok) throw new Error(read.message)
        const dataBase64 = read.dataUrl.split(';base64,', 2)[1] ?? ''
        if (!dataBase64) throw new Error(t('composerAttachmentUnavailable'))
        const uploaded = await uploadSddImagesAsAttachments(
          [
            {
              index: 1,
              alt: payload.image.alt,
              markdownPath: payload.image.absolutePath,
              relativePath: payload.image.absolutePath,
              mimeType: read.mimeType,
              dataBase64,
              byteSize: read.size
            }
          ],
          threadId,
          draft.workspaceRoot
        )
        attachmentIds = uploaded.attachmentIds
      } catch (error) {
        useSddDraftStore.getState().setOperationStatus(
          'error',
          error instanceof Error ? error.message : String(error)
        )
        return false
      }
    }

    const assistantSelection = useWriteWorkspaceStore.getState()
    const model = assistantSelection.assistantModel.trim()
    const providerId =
      assistantSelection.assistantProviderId.trim() || providerIdForComposerModel(composerModelGroups, model)
    const sent = await sendMessage(payload.prompt, 'agent', {
      displayText: payload.displayText,
      ...buildSddAssistantModelOverrides({
        model,
        providerId,
        reasoningEffort: composerReasoningEffort,
        fastMode: composerFastMode,
        modelGroups: composerModelGroups
      }),
      ...(attachmentIds.length ? { attachmentIds } : {})
    })
    if (sent && showSddAssistantThreadInSidebar(threadId)) {
      void useChatStore.getState().refreshThreads()
    }
    return sent
  }, [
    composerModelGroups,
    composerFastMode,
    composerReasoningEffort,
    ensureSddAssistantThreadForDraft,
    firstVisionCapableModel,
    openSddAssistantPanel,
    runtimeConnection,
    selectedModelSupportsImageInput,
    sendMessage,
    setWriteAssistantModel,
    t,
    uploadSddImagesAsAttachments
  ])

  const handleSddNextStep = useCallback(async (): Promise<void> => {
    const snapshot = useSddDraftStore.getState()
    const draft = snapshot.activeDraft
    if (!draft) return
    if (sddUpgradeInFlightRef.current || snapshot.operationStatus === 'upgrading') return
    if (!snapshot.content.trim()) {
      useSddDraftStore.getState().setOperationStatus('error', t('sddEmptyDraftError'))
      return
    }
    if (snapshot.content.includes(PENDING_INFOGRAPHIC_PROTOCOL)) {
      useSddDraftStore.getState().setOperationStatus('error', t('sddPendingImageBlocked'))
      return
    }
    const chatSnapshot = useChatStore.getState()
    if (chatSnapshot.busy || threadHasPendingRuntimeWork(chatSnapshot.blocks)) {
      setError(t('composerQueuePlaceholder'))
      return
    }
    if (chatSnapshot.runtimeConnection !== 'ready') {
      setError(t('runtimeActionNeedsConnection'))
      return
    }
    sddUpgradeInFlightRef.current = true
    useSddDraftStore.getState().setOperationStatus('upgrading')
    const saved = await saveActiveSddDraftToDisk()
    if (!saved) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('error', useSddDraftStore.getState().error)
      return
    }

    const threadId = await ensureSddAssistantThreadForDraft(draft)
    if (!threadId) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('idle')
      return
    }

    const collected = await collectSddDraftImages({
      markdown: useSddDraftStore.getState().content,
      draftRelativePath: draft.relativePath,
      workspaceRoot: draft.workspaceRoot
    })
    if (collected.errors.length > 0) {
      sddUpgradeInFlightRef.current = false
      useSddDraftStore.getState().setOperationStatus('error', collected.errors.join('\n'))
      return
    }

    const supportsImageAttachments =
      collected.images.length > 0 &&
      runtimeInfo?.capabilities.model.inputModalities.includes('image') === true &&
      runtimeInfo.capabilities.attachments.available === true &&
      typeof window.kunGui?.uploadRuntimeImageAttachment === 'function'

    let imagesForPrompt = collected.images
    let attachmentIds: string[] = []
    let imageMode: 'attachments' | 'base64' | 'none' =
      collected.images.length === 0 ? 'none' : 'base64'

    if (supportsImageAttachments) {
      try {
        const uploaded = await uploadSddImagesAsAttachments(collected.images, threadId, draft.workspaceRoot)
        imagesForPrompt = uploaded.images
        attachmentIds = uploaded.attachmentIds
        imageMode = 'attachments'
      } catch (error) {
        sddUpgradeInFlightRef.current = false
        useSddDraftStore.getState().setOperationStatus(
          'error',
          error instanceof Error ? error.message : String(error)
        )
        return
      }
    }

    const latestDraftContent = useSddDraftStore.getState().content
    const planRelativePath = sddDraftPlanRelativePath(draft)
    const planId = buildGuiPlanId(draft.workspaceRoot, planRelativePath)
    const sourceRequest = sddDraftSourceRequest(latestDraftContent, draft.relativePath)
    const assistantContext = sddAssistantContextFromBlocks(blocks)
    const prompt = buildSddDraftToPlanPrompt({
      draftMarkdown: latestDraftContent,
      draftRelativePath: draft.relativePath,
      planRelativePath,
      assistantContext,
      workspaceRoot: draft.workspaceRoot,
      images: imagesForPrompt,
      imageMode,
      ...(draft.designContext ? { designContext: draft.designContext } : {})
    })
    sddUpgradeTargetRef.current = {
      draft,
      planId,
      relativePath: planRelativePath,
      workspaceRoot: draft.workspaceRoot
    }
    setComposerMode('plan')
    const modelOverrides = buildSddAssistantModelOverrides({
      model: writeAssistantModel,
      providerId: resolvedWriteAssistantProviderId,
      reasoningEffort: composerReasoningEffort,
      fastMode: composerFastMode,
      modelGroups: composerModelGroups
    })
    const sent = await sendPlanTurn(prompt, {
      displayText: t('sddGeneratePlanAction'),
      workspaceRoot: draft.workspaceRoot,
      ...modelOverrides,
      guiPlan: {
        operation: 'draft',
        workspaceRoot: draft.workspaceRoot,
        relativePath: planRelativePath,
        planId,
        sourceRequest
      },
      ...(attachmentIds.length ? { attachmentIds } : {})
    })
    if (!sent) {
      sddUpgradeInFlightRef.current = false
      sddUpgradeTargetRef.current = null
      useSddDraftStore.getState().setOperationStatus('idle')
      return
    }
    if (showSddAssistantThreadInSidebar(threadId)) {
      void useChatStore.getState().refreshThreads()
    }
    const tracePath = sddDraftTraceRelativePath(draft.relativePath)
    if (tracePath) {
      await window.kunGui
        .writeWorkspaceFile({
          workspaceRoot: draft.workspaceRoot,
          path: tracePath,
          content: JSON.stringify(
            buildSddTraceSnapshot(latestDraftContent, planRelativePath),
            null,
            2
          )
        })
        .catch(() => undefined)
    }
  }, [
    blocks,
    composerFastMode,
    composerModelGroups,
    composerReasoningEffort,
    ensureSddAssistantThreadForDraft,
    resolvedWriteAssistantProviderId,
    runtimeInfo,
    sendPlanTurn,
    setComposerMode,
    setError,
    t,
    uploadSddImagesAsAttachments,
    writeAssistantModel
  ])

  const startNewSddAssistantConversation = useCallback((): void => {
    pendingSddFrameworkRef.current = null
    pendingSddFrameworkPromptRef.current = null
    startThreadSddAssistantConversation()
  }, [startThreadSddAssistantConversation])

  return {
    applySddFramework,
    handleSddNextStep,
    sendSddAssistantPrompt,
    sendSddPrototypeTurn,
    startNewSddAssistantConversation
  }
}
