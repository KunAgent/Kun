import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type PointerEventHandler,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  DesignRightPanelContent,
  type DesignRightPanelContentProps
} from '../design/DesignRightPanelContent'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import type { RegisteredContribution } from '../../extensions/contribution-registry'
import type { ExtensionRightRailViewEntry } from '../../extensions/contribution-registry'
import { ExtensionViewOutlet } from '../../extensions/ControlledContributionSurfaces'
import {
  BUILTIN_RIGHT_PANEL_IDS,
  isExtensionContributionId,
  type RightPanelContributionId
} from '../../extensions/contribution-ids'
import type { CodeRightTabsState } from './code-right-tabs-state'
import { codeRightTabsForGraphVisibility } from './code-right-tabs-state'
import { CodeRightPanelTabs, codeRightTabDomIds } from './CodeRightPanelTabs'
import {
  WorkbenchFileTreeSidePanel,
  type WorkbenchFileTreeSidePanelProps
} from './WorkbenchFileTreeSidePanel'
import { workbenchDividerClassName } from './workbench-divider'

const ChangeInspector = lazy(() =>
  import('../ChangeInspector').then((module) => ({ default: module.ChangeInspector }))
)
const DevBrowserPanel = lazy(() =>
  import('../DevBrowserPanel').then((module) => ({ default: module.DevBrowserPanel }))
)
const WorkspaceFilePreviewPanel = lazy(() =>
  import('../WorkspaceFilePreviewPanel').then((module) => ({
    default: module.WorkspaceFilePreviewPanel
  }))
)
const CodeCanvasPanel = lazy(() =>
  import('../design/canvas/CodeCanvasPanel').then((module) => ({ default: module.CodeCanvasPanel }))
)
const SubagentDetailPanel = lazy(() =>
  import('../subagents/SubagentDetailPanel').then((module) => ({ default: module.SubagentDetailPanel }))
)
const WriteAssistantPanel = lazy(() =>
  import('../write/WriteAssistantPanel').then((module) => ({ default: module.WriteAssistantPanel }))
)
const SddAssistantPanel = lazy(() =>
  import('../sdd/SddAssistantPanel').then((module) => ({ default: module.SddAssistantPanel }))
)
const SideConversationPanel = lazy(() =>
  import('../chat/SideConversationPanel').then((module) => ({ default: module.SideConversationPanel }))
)
const McpSkillsPanel = lazy(() =>
  import('./McpSkillsPanel').then((module) => ({ default: module.McpSkillsPanel }))
)
const UsageQuotaPanel = lazy(() =>
  import('./UsageQuotaPanel').then((module) => ({ default: module.UsageQuotaPanel }))
)
const GraphModePanel = lazy(() =>
  import('../graph/GraphModePanel').then((module) => ({ default: module.GraphModePanel }))
)

type WriteAssistantPanelProps = ComponentProps<typeof WriteAssistantPanel>
type SddAssistantPanelProps = ComponentProps<typeof SddAssistantPanel>
type ChangeInspectorProps = ComponentProps<typeof ChangeInspector>
type DevBrowserPanelProps = ComponentProps<typeof DevBrowserPanel>
type CodeCanvasPanelProps = ComponentProps<typeof CodeCanvasPanel>
type WorkspaceFilePreviewPanelProps = ComponentProps<typeof WorkspaceFilePreviewPanel>

export type WorkbenchCodeRightWorkspaceProps = {
  state: CodeRightTabsState
  activeThreadId: string | null
  threadRunning: boolean
  sideConversationCount: number
  sideConversationRunningCount: number
  sideAttachmentStoreAvailable: boolean
  sideDefaultModelSupportsImageInput: boolean
  files: WorkbenchFileTreeSidePanelProps
  extensionItems: readonly ExtensionRightRailViewEntry[]
  extensionViews: readonly RegisteredContribution<'views.rightSidebar'>[]
  onOpen: (id: RightPanelContributionId) => void
  onActivate: (id: RightPanelContributionId) => void
  onClose: (id: RightPanelContributionId) => void
  onToggleFiles: () => void
  onNewSideConversation: () => void
}

export type WorkbenchRightPanelProps = {
  visible: boolean
  width: number
  route: string
  rightPanelMode: RightPanelMode | null
  graphEnabled?: boolean
  onBeginResize: PointerEventHandler<HTMLDivElement>
  design: DesignRightPanelContentProps
  writeAssistantOpen: boolean
  write: Omit<WriteAssistantPanelProps, 'className'>
  sdd: Omit<SddAssistantPanelProps, 'draft' | 'className'> & {
    draft: SddAssistantPanelProps['draft'] | null
  }
  changes: Omit<ChangeInspectorProps, 'className'>
  browser: Omit<DevBrowserPanelProps, 'className'>
  planPanel: ReactElement
  canvas: Omit<CodeCanvasPanelProps, 'className'>
  file: Omit<WorkspaceFilePreviewPanelProps, 'className'>
  mcpSkills: {
    onOpenSettings: () => void
  }
  extensionView?: RegisteredContribution<'views.rightSidebar'>
  code?: WorkbenchCodeRightWorkspaceProps
  workspaceRoot?: string
  onCollapse: () => void
}

export function WorkbenchRightPanel({
  visible,
  width,
  route,
  rightPanelMode,
  graphEnabled = false,
  onBeginResize,
  design,
  writeAssistantOpen,
  write,
  sdd,
  changes,
  browser,
  planPanel,
  canvas,
  file,
  mcpSkills,
  extensionView,
  code,
  workspaceRoot,
  onCollapse
}: WorkbenchRightPanelProps): ReactElement | null {
  if (route === 'chat' && rightPanelMode !== BUILTIN_RIGHT_PANEL_IDS.sddAi && code) {
    const visibleCodeState = codeRightTabsForGraphVisibility(code.state, graphEnabled)
    if (
      (!visible && visibleCodeState.tabs.length === 0) ||
      (code.state.tabs.length > 0 && visibleCodeState.tabs.length === 0)
    ) return null
    return (
      <CodeRightPanelWorkspace
        visible={visible}
        width={width}
        onBeginResize={onBeginResize}
        code={{ ...code, state: visibleCodeState }}
        changes={changes}
        browser={browser}
        planPanel={planPanel}
        canvas={canvas}
        file={file}
        mcpSkills={mcpSkills}
        workspaceRoot={workspaceRoot}
        onCollapse={onCollapse}
      />
    )
  }
  if (!visible) return null
  if (!graphEnabled && rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.graph) return null
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className={workbenchDividerClassName(route)}
        onPointerDown={onBeginResize}
      />
      <div className="ds-sidebar-surface h-full min-h-0 shrink-0" style={{ width }}>
        <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
          {design.panelMode !== 'hidden' ? (
            <DesignRightPanelContent {...design} />
          ) : route === 'write' && writeAssistantOpen ? (
            <WriteAssistantPanel {...write} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.sddAi && sdd.draft ? (
            <SddAssistantPanel {...sdd} draft={sdd.draft} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.subagents ? (
            <SubagentDetailPanel className="h-full max-h-full w-full" onCollapse={onCollapse} />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.changes ? (
            <ChangeInspector {...changes} className="h-full max-h-full w-full flex-col" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.browser ? (
            <DevBrowserPanel {...browser} className="h-full max-h-full w-full flex-col" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.plan ? (
            planPanel
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.canvas ? (
            <CodeCanvasPanel {...canvas} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.file ? (
            <WorkspaceFilePreviewPanel {...file} className="h-full max-h-full w-full" />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.mcpSkills ? (
            <McpSkillsPanel workspaceRoot={workspaceRoot} onOpenSettings={mcpSkills.onOpenSettings} />
          ) : rightPanelMode === BUILTIN_RIGHT_PANEL_IDS.graph ? (
            <GraphModePanel
              className="h-full max-h-full w-full"
              onCollapse={onCollapse}
              active={visible}
            />
          ) : rightPanelMode && isExtensionContributionId(rightPanelMode) && extensionView?.id === rightPanelMode ? (
            <ExtensionViewOutlet contribution={extensionView} workspaceRoot={workspaceRoot} onClose={onCollapse} />
          ) : (
            <div role="alert" className="flex h-full items-center justify-center bg-ds-sidebar px-6 text-center text-[12px] text-ds-muted">
              This workbench contribution is unavailable.
            </div>
          )}
        </Suspense>
      </div>
    </>
  )
}

function CodeRightPanelWorkspace({
  visible,
  width,
  onBeginResize,
  code,
  changes,
  browser,
  planPanel,
  canvas,
  file,
  mcpSkills,
  workspaceRoot,
  onCollapse
}: Pick<
  WorkbenchRightPanelProps,
  | 'visible'
  | 'width'
  | 'onBeginResize'
  | 'changes'
  | 'browser'
  | 'planPanel'
  | 'canvas'
  | 'file'
  | 'mcpSkills'
  | 'workspaceRoot'
  | 'onCollapse'
> & { code: WorkbenchCodeRightWorkspaceProps }): ReactElement {
  const { t } = useTranslation('common')
  const reactId = useId()
  const domIdPrefix = `code-right-${reactId}`
  const [visited, setVisited] = useState<Set<RightPanelContributionId>>(() =>
    new Set(code.state.activeId ? [code.state.activeId] : []))
  const [dynamicTitles, setDynamicTitles] = useState<Record<string, string>>({})

  useEffect(() => {
    setDynamicTitles({})
  }, [workspaceRoot])

  useEffect(() => {
    const activeId = code.state.activeId
    setVisited((current) => {
      const next = new Set([...current].filter((id) => code.state.tabs.includes(id)))
      if (activeId) next.add(activeId)
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current
      return next
    })
  }, [code.state.activeId, code.state.tabs])

  const updateTitle = useCallback((id: RightPanelContributionId, title: string): void => {
    const bounded = title.trim().slice(0, 128)
    if (!bounded) return
    setDynamicTitles((current) => current[id] === bounded ? current : { ...current, [id]: bounded })
  }, [])

  const fileTitle = file.target?.path?.replaceAll('\\', '/').split('/').at(-1)
  const titles = fileTitle
    ? { ...dynamicTitles, [BUILTIN_RIGHT_PANEL_IDS.file]: fileTitle }
    : dynamicTitles

  const renderPanel = (id: RightPanelContributionId): ReactElement => {
    if (id === BUILTIN_RIGHT_PANEL_IDS.subagents) {
      return <SubagentDetailPanel className="h-full max-h-full w-full" onCollapse={onCollapse} />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.changes) {
      return <ChangeInspector {...changes} className="h-full max-h-full w-full flex-col" />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.browser) {
      return (
        <DevBrowserPanel
          key={workspaceRoot || '__global__'}
          {...browser}
          embedded
          className="h-full max-h-full w-full flex-col"
          onTitleChange={(title) => updateTitle(id, title)}
        />
      )
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.plan) return planPanel
    if (id === BUILTIN_RIGHT_PANEL_IDS.canvas) {
      return <CodeCanvasPanel {...canvas} className="h-full max-h-full w-full" />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.files) {
      return <WorkbenchFileTreeSidePanel {...code.files} open embedded />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.file) {
      return (
        <div className="ds-file-preview-workspace h-full min-h-0 min-w-0">
          {code.files.open ? (
            <>
              <button
                type="button"
                className="ds-file-preview-explorer-backdrop"
                onClick={code.onToggleFiles}
                aria-label={t('fileTreeClose')}
              />
              <div className="ds-file-preview-explorer">
                <WorkbenchFileTreeSidePanel {...code.files} open embedded />
              </div>
            </>
          ) : null}
          <WorkspaceFilePreviewPanel
            {...file}
            fileTreeOpen={code.files.open}
            onToggleFileTree={code.onToggleFiles}
            className="h-full max-h-full min-w-0 flex-1 border-l-0"
          />
        </div>
      )
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.sideConversations) {
      return (
        <SideConversationPanel
          variant="docked"
          attachmentStoreAvailable={code.sideAttachmentStoreAvailable}
          defaultModelSupportsImageInput={code.sideDefaultModelSupportsImageInput}
          onRequestClose={() => code.onClose(id)}
          onTitleChange={(title) => updateTitle(id, title)}
        />
      )
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.mcpSkills) {
      return <McpSkillsPanel workspaceRoot={workspaceRoot} onOpenSettings={mcpSkills.onOpenSettings} />
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.providerQuotas) {
      return (
        <UsageQuotaPanel
          activeThreadId={code.activeThreadId}
          active={visible && code.state.activeId === id}
        />
      )
    }
    if (id === BUILTIN_RIGHT_PANEL_IDS.graph) {
      return (
        <GraphModePanel
          className="h-full max-h-full w-full"
          onCollapse={onCollapse}
          active={visible && code.state.activeId === id}
        />
      )
    }
    if (isExtensionContributionId(id)) {
      const contribution = code.extensionViews.find((view) => view.id === id)
      if (contribution) {
        return <ExtensionViewOutlet contribution={contribution} workspaceRoot={workspaceRoot} />
      }
    }
    return (
      <div role="alert" className="flex h-full items-center justify-center bg-ds-sidebar px-6 text-center text-[12px] text-ds-muted">
        This workbench contribution is unavailable.
      </div>
    )
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        className={`${visible ? '' : 'hidden '}ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize`}
        onPointerDown={onBeginResize}
      />
      <div
        className={`${visible ? 'flex' : 'hidden'} ds-sidebar-surface h-full min-h-0 shrink-0 flex-col`}
        style={{ width }}
      >
        <CodeRightPanelTabs
          state={code.state}
          domIdPrefix={domIdPrefix}
          titles={titles}
          sideConversationCount={code.sideConversationCount}
          sideConversationRunningCount={code.sideConversationRunningCount}
          extensionItems={code.extensionItems}
          onActivate={code.onActivate}
          onClose={code.onClose}
          onNewSideConversation={code.onNewSideConversation}
          onCollapse={onCollapse}
        />
        <Suspense fallback={<div className="h-full w-full bg-ds-sidebar" />}>
          <div className="ds-sidebar-surface-body relative min-h-0 flex-1">
            {code.state.tabs.map((id) => {
              const active = code.state.activeId === id
              if (!visited.has(id) && !active) return null
              const { tabId, panelId } = codeRightTabDomIds(domIdPrefix, id)
              return (
                <div
                  key={id}
                  id={panelId}
                  role="tabpanel"
                  aria-labelledby={tabId}
                  hidden={!active}
                  className="absolute inset-0 min-h-0 overflow-hidden"
                >
                  {renderPanel(id)}
                </div>
              )
            })}
          </div>
        </Suspense>
      </div>
    </>
  )
}
