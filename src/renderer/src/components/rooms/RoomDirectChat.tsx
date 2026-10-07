import { useEffect, useRef, useState } from 'react'
import { WorkbenchActiveChip } from './WorkbenchActiveChip'
import { AlarmClock, BookUser, ChevronDown, CircleAlert, Cpu, Eraser, FolderOpen, Folders, IdCard, ListTodo, Menu, MoreHorizontal, PanelLeft, PanelRight, PanelRightOpen, PlugZap, RotateCcw, Search, SlidersHorizontal, Trash2, UserX, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentDirectActivity, Room } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomPopover } from './RoomPopover'
import { RoomExecutionGates } from './RoomTaskGates'
import { agentPath, useAgentResource } from './agent-client'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { modelLabel, type AgentModels } from './AgentModelSettings'
import type { ConversationRemoval } from './agent-chat-removal'
import './rooms-direct.css'
import './conversation-manage.css'

export function useDirectChat(room: Room | null, onUpdated: () => Promise<void>) {
  const resource = useAgentResource<AgentDirectActivity>(room?.conversationKind === 'user_agent' ? roomPath(room.id) + '/direct' : null,
    true, room ? `${room.id}:${room.privateEpoch ?? 0}` : null)
  const [error, setError] = useState('')
  const scope = useRef(room?.id); scope.current = room?.id
  useEffect(() => setError(''), [room?.id])
  const act = async (action: 'stop' | 'retry', target = resource.data?.active) => {
    if (!room || !target) return
    setError('')
    try { await roomsRequest(roomPath(room.id) + '/direct/' + target.id, 'POST', { clientRequestId: roomRequestId(), expectedRevision: target.revision, action }); resource.refresh() }
    catch (cause) { if (scope.current === room.id) setError(String(cause)) }
  }
  const context = async (action: 'reset' | 'workspace') => {
    if (!room) return
    setError('')
    try {
      const selection = action === 'workspace' ? await window.kunGui.pickWorkspaceDirectory() : undefined
      if (selection?.canceled) return
      await roomsRequest(roomPath(room.id) + '/direct/context', 'POST', { action, path: selection?.path,
        expectedRevision: room.revision, clientRequestId: roomRequestId() })
      await onUpdated(); resource.refresh()
    } catch (cause) { if (scope.current === room.id) setError(String(cause)) }
  }
  const refresh = () => {
    if (scope.current !== room?.id) return
    setError('')
    resource.refresh()
  }
  return { ...resource, error: error || resource.error, refresh, act, context }
}
/** Close affordance for transient bot notices; the dismissed identity stays hidden until the notice content changes. */
export function RoomNoticeDismiss({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation('common')
  return <button type="button" className="rooms-notice-dismiss" aria-label={t('roomsDismissNotice')} title={t('roomsDismissNotice')}
    onClick={onDismiss}><X size={13} aria-hidden="true" /></button>
}
export function RoomDirectHeader({ room, models, onSidebar, onSearch, onProfile, onInfo, onRemove, onModels, onFiles, onReminders, onReset, onConnect, onApps, onTasks, onSession, sessionOpen, sessionDisabled, embedded = false, onToggleLeftSidebar, onManageAgents }: {
  room: Room; models?: AgentModels | null; onSidebar: () => void; onSearch: () => void; onProfile: () => void; onModels: () => void
  onInfo?: () => void; onRemove?: (removal: ConversationRemoval) => void
  onFiles: () => void; onReminders: () => void; onReset: () => void; onConnect: () => void; onApps?: () => void; onTasks: () => void
  onSession: () => void; sessionOpen: boolean; sessionDisabled: boolean
  embedded?: boolean; onToggleLeftSidebar?: () => void; onManageAgents?: () => void
}) {
  const { t } = useTranslation('common')
  const member = room.members[0]
  const loaded = useAgentResource<AgentModels>(
    models !== undefined || !member.participantAgentId ? null : agentPath(member.participantAgentId) + '/models'
  )
  const current = models ?? loaded.data
  // Grouped like the Code menus: who the Agent is, where it works, then destructive actions.
  const menuItems: Array<{ id: string; icon: LucideIcon; label: string; run: () => void } | null> = [
    ...(onInfo ? [{ id: 'info', icon: IdCard, label: t('conversationViewAgentInfo'), run: onInfo }] : []),
    { id: 'profile', icon: BookUser, label: t('agentsProfileAndMemory'), run: onProfile },
    { id: 'models', icon: Cpu, label: t('directModels'), run: onModels },
    null,
    { id: 'files', icon: Folders, label: t('directFiles'), run: onFiles },
    { id: 'connect', icon: FolderOpen, label: t('directConnectProject'), run: onConnect },
    { id: 'tasks', icon: ListTodo, label: t('roomsTasks'), run: onTasks },
    { id: 'reminders', icon: AlarmClock, label: t('roomsReminders'), run: onReminders },
    ...(onApps ? [{ id: 'apps', icon: PlugZap, label: t('roomsAppsTitle'), run: onApps }] : []),
    null,
    { id: 'context', icon: Eraser, label: t('directNewContext'), run: onReset }
  ]
  return <header className="rooms-main-titlebar rooms-header direct-header">
    {embedded ? <button className="rooms-icon-button" aria-label={t('sidebarToggle')} onClick={onToggleLeftSidebar}><PanelLeft size={18} /></button>
      : <button className="rooms-icon-button rooms-sidebar-toggle" aria-label={t('roomsLabel')} onClick={onSidebar}><Menu size={19} /></button>}
    <button className="direct-chat-title" title={onInfo ? t('conversationViewAgentInfo') : undefined} onClick={onInfo ?? onProfile}><RoomAvatar member={member} label={member.displayName} size={36} /><span className="direct-chat-title-text"><strong>{member.displayName}</strong>{!embedded ? <small>{modelLabel(current?.main)}</small> : null}</span></button>
    {embedded ? <span className="rooms-private-badge">{t('agentPrivateChatLabel')}</span> : null}
    {embedded ? <button className="direct-workspace-control" onClick={onConnect} title={room.privateWorkspace ?? t('agentPrivateWorkspace')}>
      <FolderOpen size={14} /><span>{room.privateWorkspace?.replaceAll('\\', '/').split('/').at(-1) ?? t('agentPrivateWorkspace')}</span><ChevronDown size={12} /></button> : null}
    <WorkbenchActiveChip roomId={room.id} />
    <div className="direct-header-spacer" />
    {onManageAgents ? <button type="button" className="rooms-icon-button" aria-label={t('directManageAllAgents')} title={t('directManageAllAgents')} onClick={onManageAgents}><SlidersHorizontal size={18} /></button> : null}
    <button className="rooms-icon-button" aria-label={t('roomsSearchMessages')} onClick={onSearch}><Search size={18} /></button>
    <button type="button" className="rooms-icon-button" aria-label={t('roomsViewAgentSession')} title={t('roomsViewAgentSession')}
      aria-pressed={sessionOpen} disabled={sessionDisabled} onClick={onSession}><PanelRight size={18} /></button>
    <RoomPopover label={t('roomsMoreActions')} trigger={<MoreHorizontal size={20} />} align="end" width={256} maxHeight={560} className="rooms-icon-button">
      {(close) => <div className="rooms-menu-list conversation-menu">
        {menuItems.map((item, index) => item ? <button type="button" key={item.id} data-conversation-action={item.id}
          onClick={() => { close(); item.run() }}><item.icon size={15} aria-hidden="true" /><span>{item.label}</span></button>
          : <hr key={'separator-' + index} />)}
        {onRemove ? <>
          <hr />
          <button type="button" className="is-danger" data-conversation-action="conversation" onClick={() => { close(); onRemove('conversation') }}>
            <Trash2 size={15} aria-hidden="true" /><span>{t('conversationDeleteChat')}</span></button>
          {member.participantAgentId ? <button type="button" className="is-danger" data-conversation-action="agent"
            onClick={() => { close(); onRemove('agent') }}><UserX size={15} aria-hidden="true" /><span>{t('conversationDeleteAgent')}</span></button> : null}
        </> : null}
      </div>}
    </RoomPopover>
  </header>
}
export function RoomDirectProgress({ room, state, onRun, openRunId, onModels, activityInTimeline = false, gatesInTimeline = false }: { room: Room; state: ReturnType<typeof useDirectChat>; onRun: (id: string) => void; openRunId?: string; onModels: () => void; activityInTimeline?: boolean; gatesInTimeline?: boolean }) {
  const { t } = useTranslation('common')
  const [dismissed, setDismissed] = useState('')
  useEffect(() => setDismissed(''), [room.id])
  const active = state.data?.active
  const latest = state.data?.requests[0]
  const failed = !active && latest && ['failed', 'cancelled', 'recovery_required'].includes(latest.status) ? latest : undefined
  const runId = active?.runId
  const queued = Math.max(0, (state.data?.pendingCount ?? 0) - 1)
  const failedKey = failed ? `failed:${failed.id}:${failed.status}:${failed.error ?? ''}` : ''
  const errorKey = state.error ? `error:${state.error}` : ''
  if (!active && !(failed && failedKey !== dismissed) && !(state.error && errorKey !== dismissed) && !room.privateWorkspace) return null
  return <div className="direct-progress">
    {room.privateWorkspace ? <p className="direct-project"><FolderOpen size={13} /><span title={room.privateWorkspace}>{room.privateWorkspace.split('/').at(-1)}</span></p> : null}
    {active && !activityInTimeline ? <div className="direct-progress-line"><span className="rooms-typing-dots" aria-hidden="true"><span className="rooms-typing-dot" /><span className="rooms-typing-dot" /><span className="rooms-typing-dot" /></span><span role="status">{t(state.data?.approvals.length ? 'roomsState_needs_approval' : state.data?.userInputs.length ? 'roomsState_needs_input' : active.status === 'pending' ? 'directQueued' : active.status === 'recovery_required' ? 'directReconciling' : active.status === 'stopping' ? 'directStopping' : active.steer ? 'directSteered' : 'directResponding')}{queued ? ' · ' + t('directQueuedCount', { count: queued }) : ''}</span>
      {runId ? <button type="button" aria-pressed={openRunId === runId} className={openRunId === runId ? 'is-active' : ''} onClick={() => onRun(runId)}><PanelRightOpen size={14} />{t('roomsViewAgentSession')}</button> : null}</div> : null}
    {state.data && !gatesInTimeline ? <RoomExecutionGates detail={{ ...state.data, userInputs: [] }} onUpdated={async () => state.refresh()} /> : null}
    {failed && failedKey !== dismissed ? <div className="direct-failed" role="status"><CircleAlert size={15} /><span>{directFailureText(failed, t)}</span>
      <RoomNoticeDismiss onDismiss={() => setDismissed(failedKey)} />
      <span className="direct-failed-actions">
        {failed.runId ? <button type="button" aria-pressed={openRunId === failed.runId} className={openRunId === failed.runId ? 'is-active' : ''} onClick={() => onRun(failed.runId!)}><PanelRightOpen size={13} />{t('roomsViewAgentSession')}</button> : null}
        {failed.status !== 'recovery_required' ? <button type="button" onClick={() => void state.act('retry', failed)}><RotateCcw size={12} />{t('directRetry')}</button> : null}
        <button type="button" onClick={onModels}>{t('directModels')}</button>
      </span></div> : null}
    {state.error && errorKey !== dismissed ? <p role="alert" className="rooms-run-error is-dismissible"><span>{state.error}</span>
      <RoomNoticeDismiss onDismiss={() => setDismissed(errorKey)} /></p> : null}
  </div>
}
/**
 * The runtime records one generic English sentence for every failed private
 * turn; the cause lives in the Agent session. Show localized guidance for it
 * and keep any specific error the runtime did provide.
 */
export function directFailureText(failed: { status: string; error?: string }, t: (key: string) => string): string {
  if (failed.status === 'cancelled') return failed.error || t('directStopped')
  if (!failed.error) return t('directFailed')
  return failed.error.startsWith('The response failed.') ? t('directFailedPartial') : failed.error
}
export { RoomDirectFiles } from './RoomDirectFiles'
