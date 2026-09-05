import type { Dispatch, SetStateAction } from 'react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  isComposerChatModelId,
  modelProfileSupportsTextChat
} from '@shared/app-settings-provider-core'
import type { AttachmentReference, NormalizedThread } from '../../agent/types'
import type { ChatState, SendMessageOverrides } from '../../store/chat-store-types'
import type { CodeCanvasOutboundPromptInput } from '../design/canvas/useCodeCanvasPromptController'
import type { ComposerReasoningEffort } from '../chat/FloatingComposerModelPicker'
import type { ComposerFileReference } from '../chat/FloatingComposer'
import type { ComposerAttachmentScope } from '../workbench-composer-attachments'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import type { RequestAutoPlanBuild } from '../../plan/use-auto-plan-build-controller'

export type PlanTurnOverrides = Pick<
  SendMessageOverrides,
  | 'attachmentIds'
  | 'agentSurface'
  | 'attachments'
  | 'clientRequestId'
  | 'displayText'
  | 'fileReferences'
  | 'guiPlan'
  | 'model'
  | 'providerId'
  | 'reasoningEffort'
  | 'serviceTier'
  | 'waitForRuntimeAdmission'
> & {
  workspaceRoot?: string
}

export type UseWorkbenchComposerSubmitControllerParams = {
  activeClawChannelId: string
  activeClawChannelModel?: string
  activeClawChannelProviderId?: string
  activeSddDraft: boolean
  activeThreadId: string | null
  taskSurface?: 'code' | 'design'
  attachmentUploadEnabled: boolean
  buildCodeCanvasOutboundPrompt: (input: CodeCanvasOutboundPromptInput) => Promise<string>
  clearComposerAttachments: (scope?: ComposerAttachmentScope) => void
  removeComposerAttachments: (ids: readonly string[], scope?: ComposerAttachmentScope) => void
  clearComposerFileReferences: () => void
  restoreComposerAttachments: (attachments: readonly AttachmentReference[], scope?: ComposerAttachmentScope) => Promise<void>
  restoreComposerFileReferences: (references: readonly ComposerFileReference[]) => void
  composerAttachments: AttachmentReference[]
  composerFileReferences: ComposerFileReference[]
  composerMode: 'plan' | 'agent' | 'auto'
  composerModel: string
  composerProviderId: string
  composerModelGroups: ModelProviderModelGroup[]
  composerReasoningEffort: ComposerReasoningEffort
  composerFastMode: boolean
  getAttachmentScope: () => ComposerAttachmentScope
  handleGuiPlanCommand: (request?: string) => void | Promise<void>
  input: string
  resetClawChannelSession: (channelId: string) => Promise<void>
  requestAutoPlanBuild: RequestAutoPlanBuild
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

export type ClawComposerModelOption = {
  providerId: string
  model: string
}

export function listClawComposerModelOptions(groups: readonly ModelProviderModelGroup[]): ClawComposerModelOption[] {
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

export function resolveClawComposerModelByIndex(
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
