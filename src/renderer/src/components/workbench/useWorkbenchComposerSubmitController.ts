import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  isComposerChatModelId,
  modelProfileSupportsTextChat
} from '@shared/app-settings'
import type { AttachmentReference, NormalizedThread } from '../../agent/types'
import type { ChatState, SendMessageOverrides } from '../../store/chat-store-types'
import { useChatStore } from '../../store/chat-store'
import { providerIdForComposerModel } from '../../store/chat-store-helpers'
import { parseClawCommand } from '@shared/claw-commands'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import {
  captureWriteDocumentContext,
  writeDocumentContextMatches
} from '../../write/write-document-context'
import type { WriteRetrievalContext } from '@shared/write-retrieval'
import { composeWritePrompt } from '../../write/quoted-selection'
import { resolveWriteAgentPreset } from '../../write/agent-presets'
import { parseGuiPlanCommand } from '../../plan/plan-command'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import {
  buildComposerFileContextPrompt,
  isComposerDirectoryReference,
  type ComposerFileContextEntry
} from '../../lib/composer-file-references'
import { loadWorkspaceDirectoryContextFiles } from '../../lib/workspace-file-index'
import { resolveCodeCanvasComposerRoute } from '../../design/canvas/code-canvas'
import { useCanvasSelectionStore } from '../../design/canvas/canvas-selection-store'
import {
  composerReasoningEffortRequestValue,
  type ComposerReasoningEffort
} from '../chat/FloatingComposerModelPicker'
import type { ComposerFileReference } from '../chat/FloatingComposer'
import type { ComposerAttachmentScope } from '../workbench-composer-attachments'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import type { CodeCanvasOutboundPromptInput } from '../design/canvas/useCodeCanvasPromptController'
import {
  COMPOSER_DIRECTORY_CONTEXT_MAX_FILES,
  COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS,
  buildComposerDocumentContextPrompt,
  clipComposerFileContext,
  composerReferencesToUserFileReferences,
  stripTransientAttachmentFields
} from './workbench-composer-prompts'

type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  'attachmentIds' | 'attachments' | 'displayText' | 'fileReferences' | 'guiPlan' | 'model' | 'reasoningEffort'
> & {
  workspaceRoot?: string
}

type UseWorkbenchComposerSubmitControllerParams = {
  activeClawChannelId: string
  activeClawChannelModel?: string
  activeClawChannelProviderId?: string
  activeSddDraft: boolean
  activeThreadId: string | null
  attachmentUploadEnabled: boolean
  buildCodeCanvasOutboundPrompt: (input: CodeCanvasOutboundPromptInput) => Promise<string>
  clearComposerAttachments: (scope?: ComposerAttachmentScope) => void
  removeComposerAttachments: (ids: readonly string[], scope?: ComposerAttachmentScope) => void
  clearComposerFileReferences: () => void
  composerAttachments: AttachmentReference[]
  composerFileReferences: ComposerFileReference[]
  composerMode: 'plan' | 'agent'
  composerModelGroups: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  getAttachmentScope: () => ComposerAttachmentScope
  handleGuiPlanCommand: (request?: string) => void | Promise<void>
  input: string
  resetClawChannelSession: (channelId: string) => Promise<void>
  rightPanelMode: RightPanelMode
  route: ChatState['route']
  selectClawChannel: (channelId: string) => Promise<void>
  sendMessage: ChatState['sendMessage']
  sendPlanTurn: (text: string, overrides?: PlanTurnOverrides) => Promise<boolean>
  sendSddAssistantPrompt: (value: string) => Promise<void>
  setAttachmentUploadError: (message: string | null) => void
  setClawChannelModel: (channelId: string, model: string, providerId?: string) => Promise<void>
  setError: (message: string | null) => void
  setInput: Dispatch<SetStateAction<string>>
  threads: NormalizedThread[]
  workspaceRoot: string
  appendLocalClawTurn: (userText: string, replyText: string) => void
  clearWriteQuotedSelections?: () => void
}

type ClawComposerModelOption = {
  providerId: string
  model: string
}

function listClawComposerModelOptions(groups: readonly ModelProviderModelGroup[]): ClawComposerModelOption[] {
  const seen = new Set<string>()
  const options: ClawComposerModelOption[] = []
  for (const group of groups) {
    const providerId = group.providerId.trim()
    if (!providerId) continue
    for (const modelId of group.modelIds) {
      const model = modelId.trim()
      if (!model || !isComposerChatModelId(model)) continue
      if (!modelProfileSupportsTextChat(group.modelProfiles?.[model])) continue
      const key = `${providerId}\u0000${model}`
      if (seen.has(key)) continue
      seen.add(key)
      options.push({ providerId, model })
    }
  }
  return options
}

function resolveClawComposerModelByIndex(
  groups: readonly ModelProviderModelGroup[],
  value: string
): ClawComposerModelOption | undefined {
  const raw = value.trim()
  if (!/^\d+$/.test(raw)) return undefined
  const index = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(index) || index < 1) return undefined
  return listClawComposerModelOptions(groups)[index - 1]
}

export type WorkbenchComposerSubmitController = {
  handleSend: () => void
  sendWritePrompt: (value: string) => void
}

export function useWorkbenchComposerSubmitController({
  activeClawChannelId,
  activeClawChannelModel,
  activeClawChannelProviderId,
  activeSddDraft,
  activeThreadId,
  attachmentUploadEnabled,
  buildCodeCanvasOutboundPrompt,
  removeComposerAttachments,
  clearComposerFileReferences,
  composerAttachments,
  composerFileReferences,
  composerMode,
  composerModelGroups,
  composerReasoningEffort,
  getAttachmentScope,
  handleGuiPlanCommand,
  input,
  resetClawChannelSession,
  rightPanelMode,
  route,
  selectClawChannel,
  sendMessage,
  sendPlanTurn,
  sendSddAssistantPrompt,
  setAttachmentUploadError,
  setClawChannelModel,
  setError,
  setInput,
  threads,
  workspaceRoot,
  appendLocalClawTurn
}: UseWorkbenchComposerSubmitControllerParams): WorkbenchComposerSubmitController {
  const { t } = useTranslation('common')

  const mirrorClawCommand = useCallback(async (userText: string, replyText: string): Promise<void> => {
    if (!activeThreadId || typeof window.kunGui?.mirrorClawChannelMessage !== 'function') return
    const userResult = await window.kunGui.mirrorClawChannelMessage(
      activeThreadId,
      userText,
      'user'
    )
    if (!userResult.ok) return
    await window.kunGui.mirrorClawChannelMessage(
      activeThreadId,
      replyText,
      'assistant'
    )
  }, [activeThreadId])

  const clawHelpText = useCallback((): string =>
    [
      t('clawHelpTitle'),
      '',
      `- \`/help\`: ${t('clawHelpCommandHelp')}`,
      `- \`/new\`: ${t('clawHelpCommandNew')}`,
      `- \`/clear\`: ${t('clawHelpCommandClear')}`,
      `- \`/list-model\`: ${t('clawHelpCommandModelList')}`,
      `- \`/model <number>\`: ${t('clawHelpCommandModelSwitch')}`
    ].join('\n'), [t])

  const clawModelListText = useCallback((): string => {
    const options = listClawComposerModelOptions(composerModelGroups)
    const currentProvider = activeClawChannelProviderId?.trim() ?? ''
    const currentModel = activeClawChannelModel?.trim() || 'auto'
    const rows = options.map((option, index) => {
      const marker = option.providerId === currentProvider && option.model === currentModel ? '*' : '-'
      return `${marker} ${index + 1}. \`${option.model}\` · provider \`${option.providerId}\``
    })
    return [
      t('clawModelCurrentWithProvider', {
        provider: currentProvider || 'auto',
        model: currentModel
      }),
      ...(rows.length > 0
        ? [
            t('clawModelAvailableList'),
            ...rows,
            t('clawModelSwitchHint')
          ]
        : [t('clawModelListEmpty')])
    ].join('\n')
  }, [activeClawChannelModel, activeClawChannelProviderId, composerModelGroups, t])

  const readComposerFileContextEntries = useCallback(async (
    references: ComposerFileReference[],
    workspace: string
  ): Promise<ComposerFileContextEntry[]> => {
    const entries: ComposerFileContextEntry[] = []
    const seen = new Set<string>()
    let remainingChars = COMPOSER_FILE_CONTEXT_MAX_TOTAL_CHARS

    const contextKey = (path: string): string =>
      path.trim().replaceAll('\\', '/').replace(/\/+/g, '/').toLowerCase()

    const appendFileEntry = async (
      reference: ComposerFileReference,
      strict: boolean
    ): Promise<void> => {
      if (remainingChars <= 0) return
      const key = contextKey(reference.relativePath || reference.path)
      if (seen.has(key)) return
      const result = await window.kunGui.readWorkspaceFile({
        ...(reference.workspaceRoot === null
          ? {}
          : { workspaceRoot: reference.workspaceRoot || workspace }),
        path: reference.workspaceRoot === null
          ? reference.path
          : (reference.relativePath || reference.path)
      })
      if (!result.ok) {
        if (!strict) return
        throw new Error(t('composerFileReadFailed', {
          path: reference.relativePath,
          message: result.message
        }))
      }
      seen.add(key)
      const clipped = clipComposerFileContext(result.content, remainingChars, result.truncated)
      remainingChars -= clipped.consumed
      entries.push({
        relativePath: reference.relativePath,
        content: clipped.content,
        ...(clipped.truncated ? { truncated: true } : {})
      })
    }

    for (const reference of references) {
      if (remainingChars <= 0) break
      if (isComposerDirectoryReference(reference)) {
        const directoryWorkspace = reference.workspaceRoot || workspace
        const dirFiles = await loadWorkspaceDirectoryContextFiles(
          directoryWorkspace,
          reference.relativePath,
          COMPOSER_DIRECTORY_CONTEXT_MAX_FILES
        ).catch(() => [])
        for (const file of dirFiles) {
          if (remainingChars <= 0) break
          await appendFileEntry({ ...file, workspaceRoot: directoryWorkspace }, false)
        }
        continue
      }
      await appendFileEntry(reference, true)
    }
    return entries
  }, [t])

  const sendWritePrompt = useCallback((value: string): void => {
    const v = value.trim()
    const attachmentScope = getAttachmentScope()
    const attachments = composerAttachments
    const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
    const attachmentIds = attachments.map((attachment) => attachment.id)
    const publicAttachments = stripTransientAttachmentFields(attachments)
    if (!v && attachmentIds.length === 0 && documentAttachments.length === 0) return
    if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
      setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
      return
    }
    const writeState = useWriteWorkspaceStore.getState()
    const writeWorkspaceRoot = writeState.workspaceRoot || workspaceRoot
    const writeDocumentContext = captureWriteDocumentContext({
      ...writeState,
      workspaceRoot: writeWorkspaceRoot
    })
    const writeActiveFilePath = writeState.activeFilePath
    const writeDocumentEpoch = writeState.documentEpoch
    const writeContentRevision = writeState.contentRevision
    const quotedSelections = writeState.quotedSelections.map((selection) => ({
      ...selection,
      ...(selection.rects ? { rects: selection.rects.map((rect) => ({ ...rect })) } : {})
    }))
    const writeContextStillMatches = (): boolean => {
      if (useChatStore.getState().route !== 'write') return false
      const latest = useWriteWorkspaceStore.getState()
      if (writeDocumentContext) return writeDocumentContextMatches(latest, writeDocumentContext)
      return (
        normalizeWorkspaceRoot(latest.workspaceRoot || workspaceRoot) === normalizeWorkspaceRoot(writeWorkspaceRoot) &&
        latest.activeFilePath === writeActiveFilePath &&
        latest.documentEpoch === writeDocumentEpoch
      )
    }
    const restorePrompt = (): void => {
      // The composer state is shared across routes. Never prepend a stale
      // Write prompt to text the user has started composing in Chat/Design.
      if (useChatStore.getState().route !== 'write') return
      setInput((current) => {
        if (!v) return current
        if (!current) return v
        if (current.trim() === v || current.startsWith(`${v}\n\n`)) return current
        return `${v}\n\n${current}`
      })
    }
    const writeDraftStillMatches = (): boolean => {
      const latest = useWriteWorkspaceStore.getState()
      return (
        writeContextStillMatches() &&
        latest.contentRevision === writeContentRevision &&
        latest.saveStatus === 'saved' &&
        latest.fileContent === latest.persistedContent &&
        latest.pendingAgentReview === null &&
        !latest.reviewActive
      )
    }
    const saveActiveDraft = async (): Promise<boolean> => {
      if (!writeContextStillMatches()) return false
      const beforeSave = useWriteWorkspaceStore.getState()
      if (beforeSave.contentRevision !== writeContentRevision) return false
      if (beforeSave.pendingAgentReview || beforeSave.reviewActive) {
        beforeSave.setFileError(t('writeExternalChangeConflict'))
        return false
      }
      // Clean read-only/truncated (or non-text) documents are safe to ask
      // about. Their flushSave path intentionally rejects/no-ops, so avoid it.
      // Normal text files still flush below to drain an older queued save.
      const cleanDocument = beforeSave.fileContent === beforeSave.persistedContent
      if (
        cleanDocument &&
        (beforeSave.fileTruncated || beforeSave.activeFileKind !== 'text' || !beforeSave.activeFilePath)
      ) {
        if (beforeSave.saveStatus !== 'saved') {
          useWriteWorkspaceStore.setState((current) => (
            writeContextStillMatches() &&
            current.contentRevision === writeContentRevision &&
            current.fileContent === current.persistedContent
              ? { saveStatus: 'saved' }
              : {}
          ))
        }
        return writeDraftStillMatches()
      }
      const saved = await beforeSave.flushSave(writeWorkspaceRoot)
      if (!saved) {
        const latest = useWriteWorkspaceStore.getState()
        if (writeContextStillMatches() && !latest.fileError) {
          latest.setFileError(t('writeAssistantSaveBeforeSendFailed'))
        }
        return false
      }
      return writeDraftStillMatches()
    }
    setInput('')
    void (async () => {
      if (!await saveActiveDraft()) {
        restorePrompt()
        return
      }
      const retrievalQuery = [
        ...quotedSelections.map((selection) => selection.text),
        v
      ].join('\n\n').trim()
      let retrieval: WriteRetrievalContext | null = null
      if (retrievalQuery && typeof window.kunGui?.retrieveWriteContext === 'function') {
        try {
          const result = await window.kunGui.retrieveWriteContext({
            workspaceRoot: writeWorkspaceRoot,
            currentFilePath: writeActiveFilePath ?? undefined,
            query: retrievalQuery,
            maxSnippets: 4,
            includeCurrentFile: true
          })
          if (result.ok) retrieval = result.context
        } catch (error) {
          void window.kunGui?.logError?.('write-retrieval', 'Failed to retrieve write context', {
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
      if (!writeDraftStillMatches()) {
        restorePrompt()
        return
      }
      // Retrieval can take long enough for another edit to land. The revision
      // gate above aborts in that case; otherwise this final no-op/flush check
      // guarantees the exact captured draft is still persisted before send.
      if (!await saveActiveDraft()) {
        restorePrompt()
        return
      }
      const messageText = buildComposerDocumentContextPrompt(
        v || (documentAttachments.length > 0 ? t('composerFileOnlyPrompt') : t('composerImageOnlyPrompt')),
        documentAttachments
      )
      const activeAgentPreset = writeState.agentPresets.find(
        (preset) => preset.id === writeState.assistantAgentPresetId
      )
      const agentPersona = activeAgentPreset ? resolveWriteAgentPreset(activeAgentPreset).persona : ''
      const prompt = composeWritePrompt(messageText, quotedSelections, {
        workspaceRoot: writeWorkspaceRoot,
        activeFilePath: writeActiveFilePath,
        retrieval,
        ...(agentPersona ? { agentPersona } : {})
      })
      const model = writeState.assistantModel.trim()
      const providerId =
        writeState.assistantProviderId.trim() || providerIdForComposerModel(composerModelGroups, model)
      const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
      const sent = await sendMessage(prompt, composerMode === 'plan' ? 'plan' : 'agent', {
        ...(!v && documentAttachments.length > 0
          ? { displayText: t('composerFileOnlyDisplay', { count: documentAttachments.length }) }
          : !v && attachmentIds.length > 0
            ? { displayText: t('composerImageOnlyDisplay') }
            : {}),
        ...(model ? { model } : {}),
        ...(providerId ? { providerId } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
        writeContext: {
          workspaceRoot: writeWorkspaceRoot,
          activeFilePath: writeActiveFilePath,
          documentEpoch: writeDocumentEpoch,
          contentRevision: writeContentRevision
        }
      })
      if (sent) {
        // Consume only the captured ids. Quotes/attachments added while the
        // runtime starts remain in the composer, even if the active file moved.
        const latest = useWriteWorkspaceStore.getState()
        quotedSelections.forEach((selection) => latest.removeQuotedSelection(selection.id))
        if (attachmentIds.length > 0) removeComposerAttachments(attachmentIds, attachmentScope)
      } else {
        restorePrompt()
      }
    })()
  }, [
    attachmentUploadEnabled,
    removeComposerAttachments,
    composerAttachments,
    composerMode,
    composerModelGroups,
    composerReasoningEffort,
    getAttachmentScope,
    sendMessage,
    setAttachmentUploadError,
    setInput,
    t,
    workspaceRoot
  ])

  const handleSend = useCallback((): void => {
    void (async (): Promise<void> => {
      const v = input.trim()
      const attachmentScope = getAttachmentScope()
      const attachments = route === 'chat' || route === 'write' ? composerAttachments : []
      const documentAttachments = attachments.filter((attachment) => attachment.kind === 'document')
      const attachmentIds = attachments.map((attachment) => attachment.id)
      const publicAttachments = stripTransientAttachmentFields(attachments)
      const fileReferences = route === 'chat' ? composerFileReferences : []
      const userFileReferences = composerReferencesToUserFileReferences(fileReferences)
      const reasoningEffort = composerReasoningEffortRequestValue(composerReasoningEffort)
      if (!v && attachmentIds.length === 0 && documentAttachments.length === 0 && fileReferences.length === 0) return
      if (attachmentIds.length > 0 && !attachmentUploadEnabled) {
        setAttachmentUploadError(t('composerAttachmentModelUnsupported'))
        return
      }
      const contextAttachmentCount = fileReferences.length + documentAttachments.length
      const emptyPrompt =
        contextAttachmentCount > 0 && attachmentIds.length > 0
          ? t('composerFileAndImageOnlyPrompt')
          : contextAttachmentCount > 0
            ? t('composerFileOnlyPrompt')
            : t('composerImageOnlyPrompt')
      const emptyDisplayText = v
        ? undefined
        : contextAttachmentCount > 0 && attachmentIds.length > 0
          ? t('composerFileAndImageOnlyDisplay', { count: contextAttachmentCount })
          : contextAttachmentCount > 0
            ? t('composerFileOnlyDisplay', { count: contextAttachmentCount })
            : t('composerImageOnlyDisplay')
      const messageText = buildComposerDocumentContextPrompt(v || emptyPrompt, documentAttachments)
      const prepareChatMessage = async (): Promise<{ text: string; displayText?: string } | null> => {
        if (fileReferences.length === 0) {
          return {
            text: messageText,
            ...(emptyDisplayText ? { displayText: emptyDisplayText } : {})
          }
        }
        const workspace = normalizeWorkspaceRoot(
          threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot
        )
        if (!workspace) {
          setError(t('workspaceRequiredToCreateThread'))
          return null
        }
        try {
          const fileContext = await readComposerFileContextEntries(fileReferences, workspace)
          const displayText = v || emptyDisplayText
          return {
            text: buildComposerFileContextPrompt(messageText, fileContext),
            ...(displayText ? { displayText } : {})
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error))
          return null
        }
      }

      if (activeSddDraft && rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi) {
        void sendSddAssistantPrompt(v)
        return
      }
      const planCommand = parseGuiPlanCommand(v)
      if (planCommand) {
        setInput('')
        void handleGuiPlanCommand(planCommand.kind === 'create' ? planCommand.request : undefined)
        return
      }
      if (route === 'chat' && composerMode === 'plan') {
        const prepared = await prepareChatMessage()
        if (!prepared) return
        const sent = await sendPlanTurn(prepared.text, {
          ...(prepared.displayText ? { displayText: prepared.displayText } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
          ...(attachmentIds.length ? { attachmentIds } : {}),
          ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
          ...(userFileReferences.length ? { fileReferences: userFileReferences } : {})
        })
        if (!sent) return
        setInput((current) => current.trim() === v ? '' : current)
        if (attachmentIds.length > 0) removeComposerAttachments(attachmentIds, attachmentScope)
        clearComposerFileReferences()
        return
      }
      if (route === 'write') {
        sendWritePrompt(v)
        return
      }
      if (route === 'claw') {
        const command = parseClawCommand(v)
        if (command?.kind === 'clear') {
          if (!activeClawChannelId) {
            setError(t('clawNoActiveIm'))
            return
          }
          setInput('')
          void (async () => {
            await resetClawChannelSession(activeClawChannelId)
            const replyText = t('clawNewSessionStarted')
            appendLocalClawTurn(v, replyText)
            await mirrorClawCommand(v, replyText)
          })()
          return
        }
        if (command?.kind === 'help') {
          setInput('')
          const replyText = clawHelpText()
          appendLocalClawTurn(v, replyText)
          void mirrorClawCommand(v, replyText)
          return
        }
        if (command?.kind === 'model') {
          if (!activeClawChannelId) {
            setError(t('clawNoActiveIm'))
            return
          }
          setInput('')
          const resolved = resolveClawComposerModelByIndex(composerModelGroups, command.model)
          if (!resolved) {
            const replyText = t('clawModelInvalidNumber', { value: command.model })
            appendLocalClawTurn(v, replyText)
            void mirrorClawCommand(v, replyText)
            return
          }
          void (async () => {
            await setClawChannelModel(activeClawChannelId, resolved.model, resolved.providerId)
            const replyText = t('clawModelChangedWithProvider', {
              model: resolved.model,
              provider: resolved.providerId
            })
            appendLocalClawTurn(v, replyText)
            await mirrorClawCommand(v, replyText)
          })()
          return
        }
        if (command?.kind === 'showModel') {
          if (!activeClawChannelId) {
            setError(t('clawNoActiveIm'))
            return
          }
          setInput('')
          const replyText = clawModelListText()
          appendLocalClawTurn(v, replyText)
          void mirrorClawCommand(v, replyText)
          return
        }
        if (!activeClawChannelId) {
          setError(t('clawNoActiveIm'))
          return
        }
        setInput('')
        void (async () => {
          const taskResult = typeof window.kunGui?.createClawTaskFromText === 'function'
            ? await window.kunGui.createClawTaskFromText(v, {
                channelId: activeClawChannelId,
                modelHint: activeClawChannelModel,
                ...(reasoningEffort ? { reasoningEffort } : {}),
                mode: composerMode
              })
            : { kind: 'noop' as const }
          if (taskResult.kind === 'created') {
            appendLocalClawTurn(v, taskResult.confirmationText)
            await mirrorClawCommand(v, taskResult.confirmationText)
            return
          }
          if (taskResult.kind === 'error') {
            appendLocalClawTurn(v, `Failed to create scheduled task: ${taskResult.message}`)
            return
          }
          if (!activeThreadId) {
            await selectClawChannel(activeClawChannelId)
            await useChatStore.getState().sendMessage(v, composerMode === 'plan' ? 'plan' : 'agent', {
              ...(reasoningEffort ? { reasoningEffort } : {})
            })
            return
          }
          await sendMessage(v, composerMode === 'plan' ? 'plan' : 'agent', {
            ...(reasoningEffort ? { reasoningEffort } : {})
          })
        })()
        return
      }
      const prepared = await prepareChatMessage()
      if (!prepared) return
      let outboundText = prepared.text
      let outboundDisplay = prepared.displayText
      let outboundGuiDesignCanvas = false
      const codeCanvasRoute = resolveCodeCanvasComposerRoute({
        route,
        composerMode,
        userText: v,
        preparedText: prepared.text,
        preparedDisplayText: prepared.displayText,
        emptyPrompt,
        whiteboardOpen: rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.canvas,
        hasSelection: useCanvasSelectionStore.getState().selectedIds.size > 0
      })
      if (codeCanvasRoute) {
        outboundText = await buildCodeCanvasOutboundPrompt({
          baseText: codeCanvasRoute.baseText,
          canvasBrief: codeCanvasRoute.canvasBrief
        })
        outboundDisplay = codeCanvasRoute.displayText
        outboundGuiDesignCanvas = true
      }
      const sent = await sendMessage(outboundText, composerMode === 'plan' ? 'plan' : 'agent', {
        ...(outboundDisplay ? { displayText: outboundDisplay } : {}),
        ...(outboundGuiDesignCanvas ? { guiDesignCanvas: true } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(publicAttachments.length ? { attachments: publicAttachments } : {}),
        ...(userFileReferences.length ? { fileReferences: userFileReferences } : {})
      })
      // Keep the draft and attachments available when a health transition
      // races the send. Only consume the captured composer inputs after the
      // runtime has accepted the turn; this makes reconnect a safe retry.
      if (!sent) return
      setInput((current) => current.trim() === v ? '' : current)
      if (attachmentIds.length > 0) removeComposerAttachments(attachmentIds, attachmentScope)
      clearComposerFileReferences()
    })()
  }, [
    activeClawChannelId,
    activeClawChannelModel,
    activeSddDraft,
    activeThreadId,
    appendLocalClawTurn,
    attachmentUploadEnabled,
    buildCodeCanvasOutboundPrompt,
    clawHelpText,
    clearComposerFileReferences,
    clawModelListText,
    composerAttachments,
    composerFileReferences,
    composerMode,
    composerModelGroups,
    composerReasoningEffort,
    getAttachmentScope,
    handleGuiPlanCommand,
    input,
    mirrorClawCommand,
    readComposerFileContextEntries,
    removeComposerAttachments,
    resetClawChannelSession,
    rightPanelMode,
    route,
    selectClawChannel,
    sendMessage,
    sendPlanTurn,
    sendSddAssistantPrompt,
    sendWritePrompt,
    setAttachmentUploadError,
    setClawChannelModel,
    setError,
    setInput,
    t,
    threads,
    workspaceRoot
  ])

  return { handleSend, sendWritePrompt }
}
