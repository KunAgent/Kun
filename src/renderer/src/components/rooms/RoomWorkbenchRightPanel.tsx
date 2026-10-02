import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { FileEdit, Folders, Globe2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentDirectActivity, Room, RoomContentReference, RoomMessage } from '@shared/rooms-api'
import type { ChatBlock } from '../../agent/types'
import { chatBlockFromItem } from '../../agent/kun-mapper-events'
import { BUILTIN_RIGHT_PANEL_IDS, type RightPanelContributionId } from '../../extensions/contribution-ids'
import { CodeRightPanelTabs, codeRightTabDomIds } from '../workbench/CodeRightPanelTabs'
import { WorkbenchFileTreeSidePanel } from '../workbench/WorkbenchFileTreeSidePanel'
import type { ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import type { WorkbenchFileTreeSidePanelView } from '../workbench/useWorkbenchFileTreeController'
import { WorkbenchRightSidebar } from '../workbench/WorkbenchRightSidebar'
import { WorkbenchSideRailSurface, sideRailButtonClass } from '../workbench/WorkbenchSideRail'
import { useRoomWorkbenchLayout } from './useRoomWorkbenchLayout'
import { ROOM_COLLABORATION_TAB, type RoomWorkbenchPanel } from './useRoomWorkbenchPanel'
import { useRoomRun } from './useRoomRun'
import { presentRoomRunItems } from './room-run-presentation'
import { RoomAgentBrowser } from './RoomAgentBrowser'
import { RoomDirectFiles } from './RoomDirectChat'
import './rooms-workbench.css'

const WorkspaceFilePreviewPanel = lazy(() => import('../WorkspaceFilePreviewPanel').then((value) => ({ default: value.WorkspaceFilePreviewPanel })))
const DevBrowserPanel = lazy(() => import('../DevBrowserPanel').then((value) => ({ default: value.DevBrowserPanel })))
const ChangeInspector = lazy(() => import('../ChangeInspector').then((value) => ({ default: value.ChangeInspector })))

export type RoomWorkbenchRightPanelProps = {
  room: Room | null
  directWorkspace?: string
  directActivity?: AgentDirectActivity | null
  directError?: string
  selectedRunId?: string
  onRefreshDirect?: () => void
  onCurrentBrowser?: () => void
  onOpenContent?: (reference: RoomContentReference) => void
  runId?: string
  messages: RoomMessage[]
  collaboration: ReactNode
  collaborationTitle?: string
  contentPreview?: ReactNode
  contentPreviewTitle?: string
  panel: RoomWorkbenchPanel
  onCollaborationOpen: () => void
  onCollaborationClose?: () => void
  onAddReference?: (reference: ChatFileTreeReference) => void
}

/** Both room surfaces use the Code file, browser and changes components. */
export function RoomWorkbenchRightPanel({
  room, directWorkspace, directActivity, directError, selectedRunId, onRefreshDirect, onCurrentBrowser, onOpenContent, runId, messages, collaboration, panel,
  onCollaborationOpen, onCollaborationClose, onAddReference, collaborationTitle, contentPreview, contentPreviewTitle
}: RoomWorkbenchRightPanelProps) {
  const { t } = useTranslation('common')
  const [privateFiles, setPrivateFiles] = useState<{ roomId?: string; workspace: boolean }>({ workspace: false })
  const showSavedFiles = room?.conversationKind === 'user_agent' && !(privateFiles.roomId === room.id && privateFiles.workspace)
  const [fileView, setFileView] = useState<WorkbenchFileTreeSidePanelView>('workspace')
  const workspaceRoot = room?.conversationKind === 'user_agent'
    ? directWorkspace ?? room.privateWorkspace ?? ''
    : room?.repositories.find((repository) => repository.availability !== 'missing')?.canonicalRoot ?? ''
  const extraRoots = room?.conversationKind === 'user_agent' ? []
    : room?.repositories.filter((repository) => repository.availability !== 'missing' && repository.canonicalRoot !== workspaceRoot)
      .map((repository) => repository.canonicalRoot) ?? []
  const blocks = useMemo<ChatBlock[]>(() => messages.map((message) => ({
    kind: 'assistant', id: message.id, text: message.body
  })), [messages])
  const prefix = `room-workbench-${room?.id ?? 'empty'}`
  const tabs = panel.state
  const layout = useRoomWorkbenchLayout(tabs.expanded, room?.id ?? null)
  const open = (id: RightPanelContributionId) => {
    if (id === ROOM_COLLABORATION_TAB && !collaboration) onCollaborationOpen()
    panel.openTab(id)
  }
  const close = (id: RightPanelContributionId) => {
    if (id === ROOM_COLLABORATION_TAB) onCollaborationClose?.()
    panel.closeTab(id)
  }
  const tools = [
    { id: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChanges'), icon: FileEdit },
    { id: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowserTool'), icon: Globe2 },
    { id: BUILTIN_RIGHT_PANEL_IDS.files, label: t('rightPanelFiles'), icon: Folders },
    ...(room?.conversationKind === 'user_agent' ? [] : [{ id: ROOM_COLLABORATION_TAB,
      label: t('roomsWorkbenchCollaboration', { defaultValue: 'Collaboration' }), icon: Users }])
  ]
  const fileTitle = panel.contentTarget ? contentPreviewTitle ?? panel.contentTarget.reference.titleSnapshot
    : panel.fileTarget?.path.replaceAll('\\', '/').split('/').at(-1)
  const titles = {
    [ROOM_COLLABORATION_TAB]: collaborationTitle ?? t(room?.conversationKind === 'user_agent' ? 'roomsAgentSession' : 'roomsWorkbenchCollaboration'),
    [BUILTIN_RIGHT_PANEL_IDS.browser]: t('rightPanelBrowserTool'),
    ...(fileTitle ? { [BUILTIN_RIGHT_PANEL_IDS.file]: fileTitle } : {})
  }
  return <>
    {tabs.tabs.length ? <WorkbenchRightSidebar visible={tabs.expanded} width={layout.width}
      className="rooms-workbench-right-panel" panelRef={layout.panelRef}
      panelProps={{ 'data-room-workbench-panel': true }}
      dividerProps={{ 'data-room-workbench-resize': true, tabIndex: 0,
        'aria-label': t('roomsResizeDetails'), 'aria-valuenow': Math.round(layout.width),
        'aria-valuemin': layout.min, 'aria-valuemax': layout.max, onPointerDown: layout.beginResize,
        onKeyDown: (event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            layout.resize(layout.width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 32 : 8))
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault(); layout.resize(event.key === 'Home' ? layout.min : layout.max)
          }
        }
      }}
      header={<CodeRightPanelTabs state={tabs} domIdPrefix={prefix} titles={titles}
        sideConversationCount={0} sideConversationRunningCount={0} extensionItems={[]}
        onActivate={open} onClose={close} onCollapse={panel.collapse} />}>
        {tabs.tabs.map((id) => {
          const active = tabs.expanded && id === tabs.activeId
          const dom = codeRightTabDomIds(prefix, id)
          return <div key={id} role="tabpanel" id={dom.panelId} aria-labelledby={dom.tabId}
            aria-hidden={!active || undefined} inert={!active || undefined}
            className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={!active ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
            <Suspense fallback={<div className="grid h-full place-content-center text-xs text-ds-muted">{t('roomsLoading')}</div>}>
              {id === ROOM_COLLABORATION_TAB ? collaboration ?? <div className="grid h-full place-content-center p-5 text-center text-xs text-ds-muted">
                <button className="rooms-workbench-empty-action" onClick={onCollaborationOpen}>{titles[ROOM_COLLABORATION_TAB]}</button>
              </div> : id === BUILTIN_RIGHT_PANEL_IDS.files ? <>
                {room?.conversationKind === 'user_agent' ? <div className="rooms-private-file-tabs" role="group" aria-label={t('directFiles')}>
                  <button type="button" aria-pressed={showSavedFiles} onClick={() => setPrivateFiles({ roomId: room.id, workspace: false })}>{t('roomsArtifactSavedFiles', { defaultValue: 'Saved files' })}</button>
                  <button type="button" aria-pressed={!showSavedFiles} onClick={() => setPrivateFiles({ roomId: room.id, workspace: true })}>{t('roomsArtifactWorkspaceFiles', { defaultValue: 'Workspace' })}</button>
                </div> : null}
                {showSavedFiles && room ? <RoomDirectFiles key={room.id} room={room} selectedReference={panel.contentTarget?.reference} onOpen={(reference) => onOpenContent?.(reference)} /> : <WorkbenchFileTreeSidePanel
                key={room?.id} open embedded showViewTabs={room?.conversationKind !== 'user_agent'} view={room?.conversationKind === 'user_agent' ? 'workspace' : fileView} width={layout.width}
                workspaceRoot={workspaceRoot} extraWorkspaceRoots={extraRoots}
                designWorkspaceRoot={workspaceRoot} designDocuments={[]}
                selectedTarget={panel.fileTarget} onViewChange={setFileView}
                onPreviewFile={(path, root) => panel.previewFile({ path, workspaceRoot: root ?? workspaceRoot })}
                onAddReference={(reference) => onAddReference?.(reference)}
              />}
              </> : id === BUILTIN_RIGHT_PANEL_IDS.file ? panel.contentTarget ? contentPreview : <WorkspaceFilePreviewPanel
                target={panel.fileTarget} openTargets={panel.fileTargets} workspaceRoot={workspaceRoot}
                className="h-full min-h-0 w-full" onSelectTarget={panel.previewFile} onCloseTarget={panel.closeFile}
                onClose={() => close(id)} onToggleFileTree={() => open(BUILTIN_RIGHT_PANEL_IDS.files)}
              /> : id === BUILTIN_RIGHT_PANEL_IDS.browser ? room?.conversationKind === 'user_agent' ? <RoomAgentBrowser
                key={room.id} roomId={room.id} activity={directActivity} error={directError} active={active}
                selectedRunId={selectedRunId} onRefresh={onRefreshDirect ?? (() => undefined)}
                onCurrent={onCurrentBrowser ?? (() => undefined)}
              /> : <DevBrowserPanel
                key={room?.id} blocks={blocks} workspaceRoot={workspaceRoot}
                activeThreadId={null} embedded className="h-full min-h-0 w-full" onCollapse={panel.collapse}
              /> : id === BUILTIN_RIGHT_PANEL_IDS.changes ? room && runId ? <RoomRunChanges
                key={room.id + ':' + runId} roomId={room.id} runId={runId}
                workspaceRoot={workspaceRoot} active={active} onCollapse={panel.collapse}
              /> : <div className="grid h-full place-content-center p-5 text-center text-xs text-ds-muted">
                {t('roomsWorkbenchNoRun', { defaultValue: 'Select an Agent session to inspect its changes.' })}
              </div> : null}
            </Suspense>
          </div>
        })}
    </WorkbenchRightSidebar> : null}
    <WorkbenchSideRailSurface role="navigation" aria-label={t('rightPanelTabs')} className="rooms-workbench-rail">
      {tools.map(({ id, label, icon: Icon }) => <button key={id} type="button"
        className={sideRailButtonClass(tabs.expanded && tabs.activeId === id)} data-room-tool={id === BUILTIN_RIGHT_PANEL_IDS.browser ? 'browser' : undefined} aria-label={label} data-tooltip={label}
        aria-pressed={tabs.expanded && tabs.activeId === id}
        onClick={() => tabs.expanded && tabs.activeId === id ? panel.collapse() : open(id)}>
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </button>)}
    </WorkbenchSideRailSurface>
  </>
}

function RoomRunChanges({ roomId, runId, workspaceRoot, active, onCollapse }: {
  roomId: string; runId: string; workspaceRoot: string; active: boolean; onCollapse: () => void
}) {
  const { t } = useTranslation('common')
  const run = useRoomRun(roomId, runId, active)
  const blocks = useMemo<ChatBlock[]>(() => presentRoomRunItems(run.items).flatMap((item) => {
    const block = chatBlockFromItem(item)
    return block ? [block] : []
  }), [run.items])
  return <>
    {run.loading ? <p className="rooms-run-note">{t('roomsLoading')}</p> : null}
    {run.error || run.streamError ? <p role="alert" className="rooms-run-error">{run.error || run.streamError}</p> : null}
    <ChangeInspector blocks={blocks} workspaceRoot={run.detail?.workspaceRoot ?? workspaceRoot}
      isolated className="min-h-0 w-full flex-1" onCollapse={onCollapse} />
  </>
}
