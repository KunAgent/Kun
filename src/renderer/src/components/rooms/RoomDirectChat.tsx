import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Menu, MoreHorizontal, PanelRight, PanelRightOpen, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentDirectActivity, Room, RoomContentReference } from '@shared/rooms-api'
import { RoomAvatar } from './RoomAvatar'
import { RoomPopover } from './RoomPopover'
import { RoomModal } from './RoomModal'
import { RoomExecutionGates } from './RoomTaskGates'
import { agentPath, useAgentResource } from './agent-client'
import { roomPath, roomRequestId, roomsRequest } from './rooms-client'
import { modelLabel, type AgentModels } from './AgentModelSettings'

export function useDirectChat(room: Room | null, onUpdated: () => Promise<void>) {
  const resource = useAgentResource<AgentDirectActivity>(room?.conversationKind === 'user_agent' ? roomPath(room.id) + '/direct' : null)
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
  return { ...resource, error: error || resource.error, act, context }
}
export function RoomDirectHeader({ room, onSidebar, onSearch, onProfile, onModels, onFiles, onReset, onConnect, onTasks, onSession, sessionOpen, sessionDisabled }: {
  room: Room; onSidebar: () => void; onSearch: () => void; onProfile: () => void; onModels: () => void
  onFiles: () => void; onReset: () => void; onConnect: () => void; onTasks: () => void
  onSession: () => void; sessionOpen: boolean; sessionDisabled: boolean
}) {
  const { t } = useTranslation('common')
  const member = room.members[0]
  const models = useAgentResource<AgentModels>(member.participantAgentId ? agentPath(member.participantAgentId) + '/models' : null)
  return <header className="rooms-main-titlebar rooms-header direct-header">
    <button className="rooms-icon-button rooms-sidebar-toggle" aria-label={t('roomsLabel')} onClick={onSidebar}><Menu size={19} /></button>
    <button className="direct-chat-title" onClick={onProfile}><RoomAvatar member={member} label={member.displayName} size={36} /><strong>{member.displayName}</strong></button>
    <button className="direct-current-model" aria-label={t('directModels')} onClick={onModels}><span title={modelLabel(models.data?.main)}>{modelLabel(models.data?.main)}</span><ChevronDown size={13} /></button>
    <div className="direct-header-spacer" />
    <button className="rooms-icon-button" aria-label={t('roomsSearchMessages')} onClick={onSearch}><Search size={18} /></button>
    <button type="button" className="rooms-icon-button" aria-label={t('roomsViewAgentSession')} title={t('roomsViewAgentSession')}
      aria-pressed={sessionOpen} disabled={sessionDisabled} onClick={onSession}><PanelRight size={18} /></button>
    <RoomPopover label={t('roomsMoreActions')} trigger={<MoreHorizontal size={20} />} align="end" className="rooms-icon-button">
      {(close) => <div className="rooms-menu-list">
        <button onClick={() => { close(); onProfile() }}>{t('agentsProfileAndMemory')}</button>
        <button onClick={() => { close(); onModels() }}>{t('directModels')}</button>
        <button onClick={() => { close(); onFiles() }}>{t('directFiles')}</button>
        <button onClick={() => { close(); onConnect() }}>{t('directConnectProject')}</button>
        <button onClick={() => { close(); onReset() }}>{t('directNewContext')}</button>
        <button onClick={() => { close(); onTasks() }}>{t('roomsTasks')}</button>
      </div>}
    </RoomPopover>
  </header>
}
export function RoomDirectProgress({ room, state, onRun, openRunId, onModels }: { room: Room; state: ReturnType<typeof useDirectChat>; onRun: (id: string) => void; openRunId?: string; onModels: () => void }) {
  const { t } = useTranslation('common')
  const active = state.data?.active
  const latest = state.data?.requests[0]
  const failed = !active && latest && ['failed', 'cancelled', 'recovery_required'].includes(latest.status) ? latest : undefined
  const runId = active?.runId
  const queued = Math.max(0, (state.data?.pendingCount ?? 0) - 1)
  if (!active && !failed && !state.error && !room.privateWorkspace) return null
  return <div className="direct-progress">
    {room.privateWorkspace ? <p className="direct-project"><FolderOpen size={13} /><span title={room.privateWorkspace}>{room.privateWorkspace.split('/').at(-1)}</span></p> : null}
    {active ? <div className="direct-progress-line"><span role="status">{t(state.data?.approvals.length ? 'roomsState_needs_approval' : state.data?.userInputs.length ? 'roomsState_needs_input' : active.status === 'pending' ? 'directQueued' : active.status === 'recovery_required' ? 'directReconciling' : active.status === 'stopping' ? 'directStopping' : 'directResponding')}{queued ? ' · ' + t('directQueuedCount', { count: queued }) : ''}</span>
      {runId ? <button type="button" aria-pressed={openRunId === runId} className={openRunId === runId ? 'is-active' : ''} onClick={() => onRun(runId)}><PanelRightOpen size={14} />{t('roomsViewAgentSession')}</button> : null}</div> : null}
    {state.data ? <RoomExecutionGates detail={{ ...state.data, userInputs: [] }} onUpdated={async () => state.refresh()} /> : null}
    {failed ? <div className="direct-failed" role="status"><span>{failed.error || t(failed.status === 'cancelled' ? 'directStopped' : 'directFailed')}</span>
      {failed.runId ? <button type="button" aria-pressed={openRunId === failed.runId} className={openRunId === failed.runId ? 'is-active' : ''} onClick={() => onRun(failed.runId!)}><PanelRightOpen size={14} />{t('roomsViewAgentSession')}</button> : null}
      {failed.status !== 'recovery_required' ? <button onClick={() => void state.act('retry', failed)}>{t('directRetry')}</button> : null}
      <button onClick={onModels}>{t('directModels')}</button></div> : null}
    {state.error ? <p role="alert" className="rooms-run-error">{state.error}</p> : null}
  </div>
}
export function RoomDirectFiles({ room, onOpen, onClose }: { room: Room; onOpen: (ref: RoomContentReference) => void; onClose: () => void }) {
  const { t } = useTranslation('common')
  const resource = useAgentResource<{ files: RoomContentReference[] }>(roomPath(room.id) + '/files')
  return <RoomModal title={t('directFiles')} onClose={onClose}><div className="direct-file-list">
    {resource.data?.files.map((file) => <button key={JSON.stringify(file)} onClick={() => { onOpen(file); onClose() }}><FolderOpen size={16} />{file.titleSnapshot}</button>)}
    {!resource.data?.files.length ? <p>{t('directNoFiles')}</p> : null}
    {resource.error ? <p role="alert">{resource.error}</p> : null}
  </div></RoomModal>
}
