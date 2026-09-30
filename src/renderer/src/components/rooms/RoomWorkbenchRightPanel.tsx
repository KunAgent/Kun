import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { FileEdit, Files, Globe2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Room, RoomMessage } from '@shared/rooms-api'
import type { ChatBlock } from '../../agent/types'
import { chatBlockFromItem } from '../../agent/kun-mapper-events'
import { BUILTIN_RIGHT_PANEL_IDS, type RightPanelContributionId } from '../../extensions/contribution-ids'
import { CodeRightPanelTabs, codeRightTabDomIds } from '../workbench/CodeRightPanelTabs'
import { WorkbenchFileTreeSidePanel } from '../workbench/WorkbenchFileTreeSidePanel'
import type { ChatFileTreeReference } from '../chat/ChatFileTreePanel'
import type { WorkbenchFileTreeSidePanelView } from '../workbench/useWorkbenchFileTreeController'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { RoomPanelResizeHandle } from './RoomPanelResizeHandle'
import { ROOM_COLLABORATION_TAB, type RoomWorkbenchPanel } from './useRoomWorkbenchPanel'
import { useRoomRun } from './useRoomRun'
import { presentRoomRunItems } from './room-run-presentation'
import './rooms-workbench.css'

const WorkspaceFilePreviewPanel = lazy(() => import('../WorkspaceFilePreviewPanel').then((value) => ({ default: value.WorkspaceFilePreviewPanel })))
const DevBrowserPanel = lazy(() => import('../DevBrowserPanel').then((value) => ({ default: value.DevBrowserPanel })))
const ChangeInspector = lazy(() => import('../ChangeInspector').then((value) => ({ default: value.ChangeInspector })))

export type RoomWorkbenchRightPanelProps = {
  room: Room | null
  directWorkspace?: string
  runId?: string
  messages: RoomMessage[]
  collaboration: ReactNode
  panel: RoomWorkbenchPanel
  onCollaborationOpen: () => void
  onCollaborationClose?: () => void
  onAddReference?: (reference: ChatFileTreeReference) => void
}

/** Both room surfaces use the Code file, browser and changes components. */
export function RoomWorkbenchRightPanel({
  room, directWorkspace, runId, messages, collaboration, panel,
  onCollaborationOpen, onCollaborationClose, onAddReference
}: RoomWorkbenchRightPanelProps) {
  const { t } = useTranslation('common')
  const preferences = useRoomPresentationPreferences()
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
  const open = (id: RightPanelContributionId) => {
    if (id === ROOM_COLLABORATION_TAB && !collaboration) onCollaborationOpen()
    panel.openTab(id)
  }
  const close = (id: RightPanelContributionId) => {
    if (id === ROOM_COLLABORATION_TAB) onCollaborationClose?.()
    panel.closeTab(id)
  }
  const tools = [
    { id: BUILTIN_RIGHT_PANEL_IDS.files, label: t('rightPanelFiles'), icon: Files },
    { id: BUILTIN_RIGHT_PANEL_IDS.browser, label: t('rightPanelBrowserTool'), icon: Globe2 },
    { id: BUILTIN_RIGHT_PANEL_IDS.changes, label: t('rightPanelChanges'), icon: FileEdit },
    { id: ROOM_COLLABORATION_TAB, label: t('roomsWorkbenchCollaboration', { defaultValue: 'Collaboration' }), icon: Users }
  ]
  return <>
    {tabs.tabs.length ? <aside
      className={`rooms-workbench-right-panel ds-sidebar-surface ds-no-drag relative flex h-full min-h-0 shrink-0 flex-col border-l border-ds-border-muted ${tabs.expanded ? '' : 'hidden'}`}
      style={{ width: preferences.detailWidth }} data-room-workbench-panel
    >
      <RoomPanelResizeHandle side="detail" />
      <CodeRightPanelTabs state={tabs} domIdPrefix={prefix}
        titles={{ [ROOM_COLLABORATION_TAB]: t('roomsWorkbenchCollaboration', { defaultValue: 'Collaboration' }) }}
        sideConversationCount={0} sideConversationRunningCount={0} extensionItems={[]}
        onActivate={open} onClose={close} onCollapse={panel.collapse} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tabs.tabs.map((id) => {
          const active = tabs.expanded && id === tabs.activeId
          const dom = codeRightTabDomIds(prefix, id)
          return <div key={id} role="tabpanel" id={dom.panelId} aria-labelledby={dom.tabId}
            aria-hidden={!active || undefined} inert={!active || undefined}
            className="absolute inset-0 flex min-h-0 flex-col"
            style={!active ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
            <Suspense fallback={<div className="grid h-full place-content-center text-xs text-ds-muted">{t('roomsLoading')}</div>}>
              {id === ROOM_COLLABORATION_TAB ? collaboration ?? <div className="grid h-full place-content-center p-5 text-center text-xs text-ds-muted">
                <button className="rooms-workbench-empty-action" onClick={onCollaborationOpen}>{t('roomsWorkbenchCollaboration', { defaultValue: 'Collaboration' })}</button>
              </div> : id === BUILTIN_RIGHT_PANEL_IDS.files ? <WorkbenchFileTreeSidePanel
                key={room?.id} open embedded view={fileView} width={preferences.detailWidth}
                workspaceRoot={workspaceRoot} extraWorkspaceRoots={extraRoots}
                designWorkspaceRoot={workspaceRoot} designDocuments={[]}
                selectedTarget={panel.fileTarget} onViewChange={setFileView}
                onPreviewFile={(path, root) => panel.previewFile({ path, workspaceRoot: root ?? workspaceRoot })}
                onAddReference={(reference) => onAddReference?.(reference)}
              /> : id === BUILTIN_RIGHT_PANEL_IDS.file ? <WorkspaceFilePreviewPanel
                target={panel.fileTarget} openTargets={panel.fileTargets} workspaceRoot={workspaceRoot}
                className="h-full min-h-0 w-full" onSelectTarget={panel.previewFile} onCloseTarget={panel.closeFile}
                onClose={() => close(id)} onToggleFileTree={() => open(BUILTIN_RIGHT_PANEL_IDS.files)}
              /> : id === BUILTIN_RIGHT_PANEL_IDS.browser ? <DevBrowserPanel
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
      </div>
    </aside> : null}
    <nav aria-label={t('rightPanelTabs')} className="rooms-workbench-rail ds-no-drag flex w-10 shrink-0 flex-col items-center gap-2 border-l border-ds-border-muted bg-ds-sidebar py-3">
      {tools.map(({ id, label, icon: Icon }) => <button key={id} type="button"
        className="rooms-icon-button" aria-label={label} title={label}
        aria-pressed={tabs.expanded && tabs.activeId === id}
        onClick={() => tabs.expanded && tabs.activeId === id ? panel.collapse() : open(id)}>
        <Icon size={17} strokeWidth={1.7} />
      </button>)}
    </nav>
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
