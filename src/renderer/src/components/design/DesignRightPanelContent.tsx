import type { ComponentProps, ReactElement } from 'react'
import { DesignAIRail } from './DesignAIRail'
import { DesignImplementPanel } from './DesignImplementPanel'

type ImplementPanelProps = ComponentProps<typeof DesignImplementPanel>
type AssistantPanelProps = ComponentProps<typeof DesignAIRail>

export type DesignRightPanelMode = 'implement' | 'assistant' | 'hidden'

export type DesignRightPanelSharedProps = Pick<
  ImplementPanelProps,
  | 'input'
  | 'setInput'
  | 'mode'
  | 'setMode'
  | 'busy'
  | 'runtimeConnection'
  | 'activeThreadId'
  | 'blocks'
  | 'liveReasoning'
  | 'liveAssistant'
  | 'composerModelGroups'
  | 'composerReasoningEffort'
  | 'setComposerReasoningEffort'
  | 'queuedMessages'
  | 'removeQueuedMessage'
  | 'guideQueuedMessage'
  | 'attachments'
  | 'attachmentUploadEnabled'
  | 'attachmentUploadBusy'
  | 'attachmentUploadError'
  | 'onPickAttachments'
  | 'onPasteClipboardImage'
  | 'onPasteLongText'
  | 'onRemoveAttachment'
  | 'onInterrupt'
  | 'onRetryConnection'
  | 'onConfigureProviders'
>

export type DesignRightPanelContentProps = {
  panelMode: DesignRightPanelMode
  shared: DesignRightPanelSharedProps
  implement: Pick<
    ImplementPanelProps,
    | 'title'
    | 'workspaceRoot'
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'setComposerModel'
    | 'onSend'
    | 'onOpenSettings'
    | 'onClose'
  >
  assistant: Pick<
    AssistantPanelProps,
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'setComposerModel'
    | 'composerReasoningEffort'
    | 'composerFastMode'
    | 'setComposerReasoningEffort'
    | 'setComposerFastMode'
    | 'contextChips'
    | 'onRemoveContextChip'
    | 'onSend'
    | 'onOpenSettings'
    | 'drawingTitle'
    | 'onClearHistory'
    | 'hasRegisteredHistory'
    | 'designThreads'
    | 'designHistoryThreadIds'
    | 'onSwitchThread'
    | 'onCollapse'
  >
  className?: string
}

export function DesignRightPanelContent({
  panelMode,
  shared,
  implement,
  assistant,
  className = 'h-full max-h-full w-full'
}: DesignRightPanelContentProps): ReactElement | null {
  if (panelMode === 'implement') {
    return (
      <DesignImplementPanel
        {...shared}
        {...implement}
        className={className}
      />
    )
  }
  if (panelMode === 'assistant') {
    return (
      <DesignAIRail
        {...shared}
        {...assistant}
        className={className}
      />
    )
  }
  return null
}
