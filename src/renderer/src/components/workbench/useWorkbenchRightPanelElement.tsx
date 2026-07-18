import type { ComponentProps, ReactElement } from 'react'
import type { SettingsRouteSection } from '../../store/chat-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { WorkbenchPlanPanel, type WorkbenchPlanPanelProps } from './WorkbenchPlanPanelHost'
import { WorkbenchRightPanelHost } from './WorkbenchRightPanelHost'

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

type WorkbenchRightPanelElementOptions = Pick<
  RightPanelHostProps,
  'visible' | 'width' | 'route' | 'rightPanelMode' | 'onBeginResize' | 'writeAssistantOpen'
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
    assistantComposer: ComposerModelProps<DesignAssistantProps>
    contextChips: DesignAssistantProps['contextChips']
    input: string
    onRemoveContextChip: DesignAssistantProps['onRemoveContextChip']
    onSendPrompt: (prompt: string) => void
    createThread: (workspaceRoot?: string, docId?: string) => Promise<string | null>
    threads: DesignAssistantProps['designThreads']
    onSwitchThread: DesignAssistantProps['onSwitchThread']
    fallbackWorkspaceRoot: string
  }
  write: Pick<
    WriteAssistantProps,
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'skillCommands'
    | 'disabledSkillIds'
    | 'setComposerModel'
    | 'onNewConversation'
    | 'onPickWorkspace'
  >
  sdd: Pick<
    SddAssistantProps,
    | 'draft'
    | 'composerModel'
    | 'composerProviderId'
    | 'composerPickList'
    | 'setComposerModel'
    | 'onApplyFramework'
    | 'onNewConversation'
  >
  changes: {
    blocks: RightPanelHostProps['changes']['blocks']
  }
  todo: {
    onOpenPlan: RightPanelHostProps['todo']['onOpenPlan']
  }
  browser: Pick<BrowserPanelProps, 'blocks' | 'preferredUrl'>
  canvas: Pick<CanvasPanelProps, 'workspaceRoot' | 'activeThreadId'>
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
  todo,
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
          onNewConversation: () => {
            const designStore = useDesignWorkspaceStore.getState()
            const root = designStore.workspaceRoot || design.fallbackWorkspaceRoot
            if (root) void design.createThread(root, designStore.ensureActiveDocument())
          },
          designThreads: design.threads,
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
      todo={{ onCollapse, onOpenPlan: todo.onOpenPlan }}
      browser={{
        blocks: browser.blocks,
        preferredUrl: browser.preferredUrl,
        onCollapse
      }}
      planPanel={<WorkbenchPlanPanel {...planPanelProps} />}
      canvas={{
        workspaceRoot: canvas.workspaceRoot,
        activeThreadId: canvas.activeThreadId,
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
