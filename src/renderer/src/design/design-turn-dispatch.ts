import type { AttachmentReference } from '../agent/types'
import type { GuiDesignArtifactMessageContext, SendMessageOverrides } from '../store/chat-store-types'
import type { DesignTurnTarget } from './design-turn-prompt'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import type {
  DesignDocumentTarget,
  DesignImagePlacementTarget,
  DesignTaskProfileInput
} from '../agent/design-task-profile'

export type DesignTurnPromptState = Pick<
  DesignWorkspaceState,
  'assistantModel' | 'assistantProviderId'
>

export type DesignAssistantModelOptions = {
  promptState: DesignTurnPromptState
  resolveProviderId: (model: string) => string
  model?: string
  providerId?: string
  reasoningEffort?: string
  serviceTier?: 'priority'
  expectedThreadId?: string
}

export type DesignTurnSendOptions = DesignAssistantModelOptions & {
  displayText: string
  target: DesignTurnTarget
  attachmentIds?: string[]
  attachments?: AttachmentReference[]
  guiDesignArtifact?: GuiDesignArtifactMessageContext
  designProfile?: DesignTaskProfileInput
  designDocumentTarget?: DesignDocumentTarget
  designImagePlacementTarget?: DesignImagePlacementTarget
  waitForRuntimeAdmission?: boolean
  canvasEngine?: 'kun' | 'excalidraw'
  messageSource?: 'design_continuation'
}

export type CodeCanvasSendOptions = {
  displayText?: string
  reasoningEffort?: string
  canvasEngine?: 'kun' | 'excalidraw'
}

function buildAssistantModelOverrides({
  promptState,
  resolveProviderId,
  model: selectedModel,
  providerId: selectedProviderId,
  reasoningEffort,
  serviceTier,
  expectedThreadId
}: DesignAssistantModelOptions): SendMessageOverrides {
  const model = selectedModel?.trim() || promptState.assistantModel.trim()
  const providerId = selectedProviderId?.trim() ||
    promptState.assistantProviderId.trim() ||
    resolveProviderId(model)
  return {
    ...(model ? { model } : {}),
    ...(providerId ? { providerId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(expectedThreadId ? { expectedThreadId } : {})
  }
}

export function buildDesignTurnSendOverrides(options: DesignTurnSendOptions): SendMessageOverrides {
  const attachmentIds = options.attachmentIds ?? []
  const attachments = options.attachments ?? []
  return {
    displayText: options.displayText,
    agentSurface: 'design',
    ...buildAssistantModelOverrides(options),
    ...(options.designProfile ? { designProfile: options.designProfile } : {}),
    ...(options.designDocumentTarget
      ? { designDocumentTarget: options.designDocumentTarget }
      : {}),
    ...(options.designImagePlacementTarget
      ? { designImagePlacementTarget: options.designImagePlacementTarget }
      : {}),
    ...(options.waitForRuntimeAdmission ? { waitForRuntimeAdmission: true } : {}),
    ...(options.messageSource ? { messageSource: options.messageSource } : {}),
    ...(options.target === 'canvas' && options.canvasEngine !== 'excalidraw'
      ? { guiDesignCanvas: true, guiDesignMode: true }
      : {}),
    ...(options.target === 'canvas' && options.canvasEngine === 'excalidraw'
      ? { guiExcalidrawCanvas: true }
      : {}),
    ...(options.target === 'svg' ? {
      guiDesignMode: true,
      ...(options.guiDesignArtifact ? { guiDesignArtifact: options.guiDesignArtifact } : {})
    } : options.guiDesignArtifact?.kind === 'html' ? { guiDesignArtifact: options.guiDesignArtifact } : {}),
    ...(attachmentIds.length ? { attachmentIds, attachments } : {})
  }
}

export function buildCodeCanvasSendOverrides(options: CodeCanvasSendOptions): SendMessageOverrides {
  return {
    ...(options.displayText ? { displayText: options.displayText } : {}),
    ...(options.canvasEngine === 'excalidraw'
      ? { guiExcalidrawCanvas: true }
      : { guiDesignCanvas: true }),
    agentSurface: 'code',
    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {})
  }
}

const RESERVED_HTML_PATH = /^\.kun-design\/.+\/v\d+\.html$/i
const RESERVED_DESIGN_NOTES_PATH = /^\.kun-design\/.+\/DESIGN\.md$/

/**
 * The page a screen/HTML turn owns, so the runtime can refuse writes to its
 * siblings. Paths that do not match the runtime contract are omitted rather
 * than sent, since an invalid value would reject the whole turn.
 */
export function reservedHtmlArtifactContext(target: {
  htmlArtifactId?: string
  artifactRelativePath: string
  designNotesPath?: string
}): GuiDesignArtifactMessageContext | undefined {
  if (!target.htmlArtifactId || !RESERVED_HTML_PATH.test(target.artifactRelativePath)) return undefined
  const notes = target.designNotesPath
  return {
    kind: 'html',
    artifactId: target.htmlArtifactId,
    relativePath: target.artifactRelativePath,
    ...(notes && RESERVED_DESIGN_NOTES_PATH.test(notes) ? { designMdPath: notes } : {})
  }
}
