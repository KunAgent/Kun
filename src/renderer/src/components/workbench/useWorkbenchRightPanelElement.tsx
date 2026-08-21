import type { ComponentProps, ReactElement } from 'react'
import type { SettingsRouteSection } from '../../store/chat-store'
import { WorkbenchPlanPanel, type WorkbenchPlanPanelProps } from './WorkbenchPlanPanelHost'
import { WorkbenchRightPanelHost } from './WorkbenchRightPanelHost'

export type CodeCanvasPanelProps = ComponentProps<typeof WorkbenchRightPanelHost>['canvas']

type RightPanelHostProps = ComponentProps<typeof WorkbenchRightPanelHost>
type DesignImplementProps = RightPanelHostProps['design']['implement']
type DesignAssistantProps = RightPanelHostProps['design']['assistant']
type WriteAssistantProps = RightPanelHostProps['write']
type SddAssistantProps = RightPanelHostProps['sdd']
type BrowserPanelProps = RightPanelHostProps['browser']
type FilePanelProps = RightPanelHostProps['file']
type CanvasPanelProps = RightPanelHostProps['canvas']

type ComposerModelProps<T extends {
  composerModel: string
  composerProviderId?: string
  composerPickList: string[]
  setComposerModel: (modelId: string, providerId?: string) => void
}> = Pick<T, 'composerModel' | 'composerProviderId' | 'composerPickList' | 'setComposerModel'>

type DesignAssistantComposerProps = ComposerModelProps<DesignAssistantProps> & Pick<
  DesignAssistantProps,
  | 'composerReasoningEffort'
  | 'composerFastMode'
  | 'setComposerReasoningEffort'
  | 'setComposerFastMode'
>

type WorkbenchRightPanelElementOptions = Pick<
  RightPanelHostProps,
  | 'visible'
  | 'width'
  | 'route'
  | 'rightPanelMode'
  | 'graphEnabled'
  | 'onBeginResize'
  | 'writeAssistantOpen'
> & {
  shared: RightPanelHostProps['design']['shared']
  planPanelProps: WorkbenchPlanPanelProps
  onCollapse: () => void
  openSettings: (section?: SettingsRouteSection) => void
  onSend: () => void
  design: {
    implementOpen: boolean
    assistantOpen: boolean
    implementTitle: DesignImplementProps['title']
    implementationWorkspaceRoot: DesignImplementProps['workspaceRoot']
    implementationComposer: ComposerModelProps<DesignImplementProps>
    assistantComposer: DesignAssistantComposerProps
    contextChips: DesignAssistantProps['contextChips']
    input: string
    onRemoveContextChip: DesignAssistantProps['onRemoveContextChip']
    onSendPrompt: (prompt: string) => void
    drawingTitle: DesignAssistantProps['drawingTitle']
    onClearHistory: DesignAssistantProps['onClearHistory']
    hasRegisteredHistory: DesignAssistantProps['hasRegisteredHistory']
    threads: DesignAssistantProps['designThreads']
    historyThreadIds: DesignAssistantProps['designHistoryThreadIds']
    onSwitchThread: DesignAssistantProps['onSwitchThread']
  }
  write: Pick<
    WriteAssistantProps,
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'skillCommands'
    | 'disabledSkillIds'
    | 'composerFastMode'
    | 'setComposerModel'
    | 'setComposerFastMode'
    | 'onNewConversation'
    | 'onPickWorkspace'
  >
  sdd: Pick<
    SddAssistantProps,
    | 'draft'
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'composerFastMode'
    | 'setComposerModel'
    | 'setComposerFastMode'
    | 'onApplyFramework'
    | 'onNewConversation'
  >
  changes: {
    blocks: RightPanelHostProps['changes']['blocks']
  }
  browser: Pick<
    BrowserPanelProps,
    | 'blocks'
    | 'preferredUrl'
    | 'workspaceRoot'
    | 'activeThreadId'
    | 'selectedElementCount'
    | 'supportsImageCapture'
    | 'onAttachContext'
    | 'onDocumentChange'
  >
  canvas: Pick<
    CanvasPanelProps,
    | 'workspaceRoot'
    | 'activeThreadId'
    | 'designDocumentId'
    | 'boardArtifactId'
    | 'designTaskActive'
    | 'onRequestImageRegenerate'
    | 'busy'
    | 'onOpenAgentSettings'
    | 'onImplementDesign'
    | 'onScreenCreated'
    | 'onSvgCreated'
    | 'onUseElementAsContext'
    | 'onRuntimeQualityFindings'
    | 'onRequestQualityRepair'
  >
  file: Pick<
    FilePanelProps,
    | 'target'
    | 'openTargets'
    | 'workspaceRoot'
    | 'onSelectTarget'
    | 'onCloseTarget'
    | 'pinnedTargetKeys'
    | 'preserveAcrossThreads'
    | 'onTogglePinnedTarget'
    | 'onCloseOtherTargets'
    | 'onTogglePreserveAcrossThreads'
  >
  extensionView?: RightPanelHostProps['extensionView']
  code?: RightPanelHostProps['code']
  workspaceRoot?: string
}

function resolveDesignPanelMode({
  route,
  implementOpen,
  assistantOpen
}: {
  route: string
  implementOpen: boolean
  assistantOpen: boolean
}): RightPanelHostProps['design']['panelMode'] {
  if (route !== 'design') return 'hidden'
  if (implementOpen) return 'implement'
  if (assistantOpen) return 'assistant'
  return 'hidden'
}

export function useWorkbenchRightPanelElement({
  visible,
  width,
  route,
  rightPanelMode,
  graphEnabled,
  onBeginResize,
  writeAssistantOpen,
  shared,
  planPanelProps,
  onCollapse,
  openSettings,
  onSend,
  design,
  write,
  sdd,
  changes,
  browser,
  canvas,
  file,
  extensionView,
  code,
  workspaceRoot
}: WorkbenchRightPanelElementOptions): ReactElement | null {
  const designPanelMode = resolveDesignPanelMode({
    route,
    implementOpen: design.implementOpen,
    assistantOpen: design.assistantOpen
  })

  return (
    <WorkbenchRightPanelHost
      visible={visible}
      width={width}
      route={route}
      rightPanelMode={rightPanelMode}
      graphEnabled={graphEnabled}
      onBeginResize={onBeginResize}
      design={{
        panelMode: designPanelMode,
        shared,
        implement: {
          title: design.implementTitle,
          workspaceRoot: design.implementationWorkspaceRoot,
          ...design.implementationComposer,
          onSend,
          onOpenSettings: () => openSettings('agents'),
          onClose: onCollapse
        },
        assistant: {
          ...design.assistantComposer,
          contextChips: design.contextChips,
          onRemoveContextChip: design.onRemoveContextChip,
          onSend: () => design.onSendPrompt(design.input),
          onOpenSettings: (section) => openSettings((section ?? 'design') as SettingsRouteSection),
          drawingTitle: design.drawingTitle,
          onClearHistory: design.onClearHistory,
          hasRegisteredHistory: design.hasRegisteredHistory,
          designThreads: design.threads,
          designHistoryThreadIds: design.historyThreadIds,
          onSwitchThread: (id) => void design.onSwitchThread(id),
          onCollapse
        }
      }}
      writeAssistantOpen={writeAssistantOpen}
      write={{
        ...write,
        onSend,
        onOpenSettings: () => openSettings('agents'),
        onCollapse
      }}
      sdd={{
        ...sdd,
        onSend,
        onOpenSettings: () => openSettings('agents'),
        onCollapse
      }}
      changes={{ blocks: changes.blocks, onCollapse }}
      browser={{
        ...browser,
        onCollapse
      }}
      planPanel={<WorkbenchPlanPanel {...planPanelProps} />}
      canvas={{
        ...canvas,
        onCollapse
      }}
      file={{
        ...file,
        onClose: onCollapse
      }}
      mcpSkills={{
        onOpenSettings: () => openSettings('agents')
      }}
      extensionView={extensionView}
      code={code}
      workspaceRoot={workspaceRoot}
      onCollapse={onCollapse}
    />
  )
}
