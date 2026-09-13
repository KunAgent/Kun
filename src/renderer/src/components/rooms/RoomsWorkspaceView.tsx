import { RoomSidebar } from './RoomSidebar'
import { RoomModal } from './RoomModal'
import { RoomOnboardingDialog, RoomWelcomeCard, useRoomOnboarding } from './RoomOnboarding'
import { RoomUserAvatarEditor } from './RoomUserAvatarEditor'
import { useRoomUserProfileSync } from './room-user-profile'
import './rooms-init-im.css'
import { AgentHandoffPanel } from './AgentHandoffPanel'
import { AgentDirectory } from './AgentDirectory'
import { AgentDetails } from './AgentDetails'
import { agentPath } from './agent-client'
import type { Room, OnboardingState, RoomSidebarEntry } from '@shared/rooms-api'
import { roomsRequest } from './rooms-client'
import { useCallback, useEffect, useState, useRef, type ReactElement, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessagesSquare,
  X
} from 'lucide-react'
import type { RoomContentOpenTarget, RoomContentReference, RoomMessage, SendRoomMessage, RoomSearchHit } from '@shared/rooms-api'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { useChatStore } from '../../store/chat-store'
import { RoomSettings, roomButtonClass } from './RoomSettings'
import { RoomComposer } from './RoomComposer'
import { RoomHeader } from './RoomHeader'
import { RoomMemberDetails } from './RoomMemberDetails'
import { roomsClient } from './rooms-client'
import { useRooms } from './useRooms'
import './rooms.css'
import { RoomTimeline } from './RoomTimeline'
import { RoomTaskStrip } from './RoomTaskStrip'
import { RoomOverview } from './RoomOverview'
import { useRoomTopics } from './useRoomTopics'
import {
  continueRoomTopic,
  RoomPeerActivity,
  RoomPeerSummary
} from './RoomPeerActivity'
import { RoomRunInspector } from './RoomRunInspector'
import { RoomDrawerNavigation, useRoomDrawerNavigation } from './RoomDrawerNavigation'
import { RoomDrawerTask } from './RoomDrawerTask'
import { RoomReplyThread } from './RoomReplyThread'
import { RoomContentPreview } from './RoomContentPreview'
import { RoomPanelResizeHandle } from './RoomPanelResizeHandle'
import { RoomRunSummary } from './RoomRunSummary'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { openRoomContentTarget } from './room-content-navigation'

export function RoomsWorkspaceView({
  onOpenThread,
  onOpenContentTarget
}: {
  onOpenThread: (id: string, turnId?: string) => void | Promise<void>
  onOpenContentTarget?: (target: RoomContentOpenTarget) => void | Promise<void>
}): ReactElement {
  const { t } = useTranslation('common')
  const state = useRooms('group', false)
  const [teamOpen, setTeamOpen] = useState(false), [profileOpen, setProfileOpen] = useState(false), [manageOpen, setManageOpen] = useState(false)
  const [sidebarActivity, setSidebarActivity] = useState<RoomSidebarEntry>()
  const receiveSidebarActivity = useCallback((entry: RoomSidebarEntry | undefined) => setSidebarActivity((previous) =>
    previous?.roomId === entry?.roomId && previous?.runningCount === entry?.runningCount && previous?.attentionCount === entry?.attentionCount ? previous : entry), [])
  const [teamPreview, setTeamPreview] = useState<OnboardingState | null>(null)
  const [previewVersion, setPreviewVersion] = useState(0)
  const openTeam = async () => {
    try {
      const preview = await roomsRequest<OnboardingState>('/v1/agents/onboarding')
      setTeamPreview(preview); setPreviewVersion((version) => version + 1); setTeamOpen(true)
    } catch (cause) { state.setError(String(cause)) }
  }
  useRoomUserProfileSync()
  useEffect(() => {
    const open = () => setProfileOpen(true)
    window.addEventListener('kun-room-user-avatar', open)
    return () => window.removeEventListener('kun-room-user-avatar', open)
  }, [])
  const navigationSerial = useRef(0)
  const [agentRunTarget, setAgentRunTarget] = useState<{ roomId: string; runId: string } | null>(null)
  const [settings, setSettings] = useState<'create' | 'edit' | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null)
  const { room, messages } = state
  const { selectedId } = state
  const topicState = useRoomTopics(selectedId)
  const drawer = useRoomDrawerNavigation(selectedId)
  const presentation = useRoomPresentationPreferences()
  const [searchTarget, setSearchTarget] = useState<RoomSearchHit | null>(null)
  useEffect(() => {
    if (!searchTarget || room?.id !== searchTarget.roomId) return
    if (searchTarget.messageId) { setJumpMessageId(searchTarget.messageId); drawer.close() }
    else if (searchTarget.memberId) drawer.open({ kind: 'section', section: 'members', memberId: searchTarget.memberId })
    else if (searchTarget.taskId) drawer.open({ kind: 'task', taskId: searchTarget.taskId })
    setSearchTarget(null)
  }, [searchTarget, room?.id, drawer])

  useEffect(() => {
    setSearchOpen(false)
  }, [selectedId])

  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    state.setError('')
    try {
      await action()
      await state.refresh()
    } catch (cause) {
      state.setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const pin = (message: RoomMessage): void => {
    void perform(() =>
      roomsClient.pinMessage(message.roomId, message.id, `pin-${message.id}`)
    )
  }
  const chooseRoom = (id: string): void => {
    navigationSerial.current++
    state.select(id)
    drawer.close()
    setSidebarOpen(false)
    setJumpMessageId(null)
  }
  const openAgent = async (agentId: string) => {
    const serial = ++navigationSerial.current
    try {
      const result = await roomsRequest<{ room: Room }>(agentPath(agentId) + '/conversation', 'POST', {})
      if (serial !== navigationSerial.current) return
      chooseRoom(result.room.id)
    } catch (cause) { if (serial === navigationSerial.current) state.setError(String(cause)) }
  }
  useEffect(() => {
    if (agentRunTarget && room?.id === agentRunTarget.roomId) {
      drawer.open({ kind: 'run', runId: agentRunTarget.runId }); setAgentRunTarget(null)
    }
  }, [agentRunTarget, room?.id, drawer])
  const onboarding = useRoomOnboarding(chooseRoom)
  const openRun = (runId: string): void => drawer.open({ kind: 'run', runId })
  const openTask = (taskId: string): void => drawer.open({ kind: 'task', taskId })
  const openMember = (memberId: string, rootRequestId?: string): void => drawer.open({ kind: 'section', section: 'members', memberId, rootRequestId })
  const openContent = (reference: RoomContentReference, messageId?: string): void => drawer.open({ kind: 'content', reference, messageId })
  const send = async (message: SendRoomMessage): Promise<void> => {
    if (!room) return
    await roomsClient.send(room.id, message)
    await Promise.all([state.refresh(), topicState.refresh()])
  }
  const openCode = (): void => {
    useChatStore.getState().setRoute('chat')
  }
  const openWork = (): void => {
    void useChatStore.getState().openWrite()
  }

  return (
    <div
      data-rooms-workspace
      data-chat-layout={presentation.layout}
      style={{ '--rooms-list-width': `${presentation.listWidth}px`, '--rooms-detail-width': `${presentation.detailWidth}px` } as CSSProperties}
      className="rooms-workspace ds-no-drag relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main"
    >
      <aside
        className={`${sidebarOpen ? 'absolute inset-y-0 left-0 z-40 flex shadow-xl' : 'hidden'} rooms-sidebar shrink-0 flex-col border-r border-ds-border bg-ds-sidebar md:static md:flex md:shadow-none`}
      >
        <RoomPanelResizeHandle side="list" />
        <div
          aria-hidden
          className="ds-drag ds-sidebar-titlebar-spacer shrink-0 pb-2 pt-2"
        >
          <div className="ds-sidebar-titlebar-row min-h-[34px]">
            <div className="ds-titlebar-safe-block" />
          </div>
        </div>
        <div className="flex items-center justify-between px-3">
          <WorkspaceModeTabs
            activeView="rooms"
            onCodeOpen={openCode}
            onWriteOpen={openWork}
          />
          <button
            className="text-ds-muted md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('roomsClose')}
          >
            <X size={18} />
          </button>
        </div>
        <RoomSidebar onActivity={receiveSidebarActivity} selectedRoomId={selectedId} onOpenAgent={(id) => void openAgent(id)} onSelect={chooseRoom}
          onCreateAgent={() => drawer.open({ kind: 'agent' })} onCreateGroup={() => setSettings('create')}
          onDetails={(agentId) => drawer.open({ kind: 'agent', agentId })}
          onSearch={(hit) => { chooseRoom(hit.roomId); setSearchTarget(hit) }}
          onProfile={() => setProfileOpen(true)} onTeam={() => void openTeam()} onManage={() => setManageOpen(true)} />
      </aside>
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <RoomHeader room={room} busy={busy} searchOpen={searchOpen}
          onSidebar={() => setSidebarOpen(true)}
          onSearch={() => setSearchOpen((value) => !value)}
          onDetails={() => drawer.section('discussion')}
          onMembers={() => drawer.section('members')}
          onSettings={() => setSettings('edit')}
          onUpdate={(patch) => { if (room) void perform(async () => {
            const result = await roomsClient.update(room, patch)
            state.saved(result.room)
          }) }}
        />
        {onboarding.data && !onboarding.data.completed && !onboarding.data.dismissed && !onboarding.data.fresh ? <div className="rooms-init-banner"><span>{t('roomsInitBanner')}</span><button onClick={() => void openTeam()}>{t('roomsInitReview')}</button><button aria-label={t('roomsClose')} onClick={() => void onboarding.dismiss()}><X size={15} /></button></div> : null}
        {onboarding.error ? <p role="alert" className="rooms-run-error">{onboarding.error}<button onClick={onboarding.retry}>{t('roomsRefresh')}</button></p> : null}
        {state.error ? (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-ds-border p-3 text-sm text-red-500"
          >
            <span className="min-w-0 flex-1 break-words">{state.error}</span>
            <button
              className={roomButtonClass}
              onClick={() => {
                void state.refreshList()
                void state.refresh()
              }}
            >
              {t('roomsRefresh')}
            </button>
          </div>
        ) : null}
        {state.loading ? (
          <div className="grid flex-1 place-content-center text-sm text-ds-muted">
            {t('roomsLoading')}
          </div>
        ) : room ? (
          <>
            <RoomPeerSummary
              topics={topicState.topics}
              loading={topicState.loading}
              onOpen={() => drawer.section('discussion')}
              onTasks={() => drawer.section('tasks')}
              taskCounts={sidebarActivity?.roomId === room.id ? sidebarActivity : undefined}
            />
            <div className="agent-collaboration-strip"><button type="button" onClick={() => drawer.open({ kind: 'handoffs' })}>{t('agentsHandoffs')}</button>
              {room.conversationKind === 'user_agent' && room.members[0]?.participantAgentId ? <button type="button" onClick={() => drawer.open({ kind: 'agent', agentId: room.members[0].participantAgentId })}>{t('agentsProfileAndMemory')}</button> : null}
            </div>
            {!messages.length && room.conversationKind === 'user_agent' ? <RoomWelcomeCard room={room}
              onTeam={() => void openTeam()} onProfile={() => drawer.open({ kind: 'agent', agentId: room.members[0]?.participantAgentId })} /> : <RoomTimeline
              key={room.id + '-timeline'}
              searchOpen={searchOpen}
              onSearchClose={() => setSearchOpen(false)}
              onMember={openMember}
              onRun={openRun}
              onHandoff={(selectedId) => drawer.open({ kind: 'handoffs', selectedId })}
              onReplyThread={(message) => drawer.open({ kind: 'reply', messageId: message.displayThreadRootId ?? message.id })}
              onOpenContent={openContent}
              room={room}
              messages={messages}
              tasks={state.tasks}
              cursor={state.messageCursor}
              moreBusy={state.moreBusy}
              loadEarlier={state.loadEarlier}
              onPin={pin}
              onTask={openTask}
              jumpMessageId={jumpMessageId}
              onJumped={() => setJumpMessageId(null)}
            />}
            {room.conversationKind === 'agent_agent' ? <p className="agent-conversation-note">{t('agentsPairReadOnly')}</p> : <RoomComposer
              key={room.id + '-composer'}
              room={room}
              tasks={state.tasks}
              topicChoices={topicState.topics.map((topic) => ({
                rootRequestId: topic.rootRequestId,
                title: topic.title
              }))}
              onSend={send}
            />}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-ds-muted">
            <MessagesSquare size={36} />
            <p>{t('roomsEmpty')}</p>
            <button
              className={roomButtonClass}
              onClick={() => setSettings('create')}
            >
              {t('roomsNew')}
            </button>
          </div>
        )}
      </section>
      {drawer.frames.length ? <RoomDrawerNavigation key={(room?.id ?? 'agents') + '-details'} frames={drawer.frames}
        onBack={drawer.back} onClose={drawer.close} onSection={drawer.section}
        render={(target, key, active) => {
          if (target.kind === 'agent') return <AgentDetails key={key} agentId={target.agentId} active={active}
            onSaved={(agent) => { if (!target.agentId) { void openAgent(agent.id) } else { drawer.replaceTop({ kind: 'agent', agentId: agent.id }); void state.refresh() } }}
            onOpen={(id) => void openAgent(id)} onConversation={chooseRoom}
            onRun={(roomId, runId) => { chooseRoom(roomId); setAgentRunTarget({ roomId, runId }) }}
            onSource={(roomId, messageId) => { chooseRoom(roomId); if (messageId) setSearchTarget({
              kind: 'messages', id: messageId, roomId, roomName: '', title: '', preview: '', messageId }) }} />
          if (!room) return null
          if (target.kind === 'handoffs') return <AgentHandoffPanel key={key} room={room} messages={messages} topics={topicState.topics}
            active={active} selectedId={target.selectedId} onOpenPair={(id) => { chooseRoom(id) }}
            onSource={chooseRoom} onRun={(roomId, runId) => { chooseRoom(roomId); setAgentRunTarget({ roomId, runId }) }} />
          if (target.kind === 'run') return <RoomRunInspector key={key} roomId={room.id} runId={target.runId} active={active} onOpenThread={onOpenThread} />
          if (target.kind === 'task') return <RoomDrawerTask key={key} roomId={room.id} taskId={target.taskId} tasks={state.tasks}
            onClose={drawer.back} onRun={openRun} onOpenThread={onOpenThread} onUpdated={() => void state.refresh()} />
          if (target.kind === 'reply') return <RoomReplyThread key={key} room={room} messageId={target.messageId} tasks={state.tasks} active={active}
            onSend={send} onPin={pin} onTask={openTask} onRun={openRun} onMember={openMember} onOpenContent={openContent} />
          if (target.kind === 'content') return <RoomContentPreview key={key} room={room} reference={target.reference} messageId={target.messageId}
            onOpenCode={onOpenThread} onOpenTarget={onOpenContentTarget ?? ((value) => openRoomContentTarget(value, onOpenThread))} />
          if (target.section === 'discussion') return <RoomPeerActivity room={room} {...topicState} onUpdated={topicState.refresh}
            onMember={openMember} onOpenRun={openRun} onContinue={(rootRequestId) => { continueRoomTopic(room.id, rootRequestId); drawer.close() }} />
          if (target.section === 'overview') return <><RoomRunSummary roomId={room.id} topics={topicState.topics} />
            <RoomOverview room={room} rules={state.rules} onUpdated={state.refresh}
              onTask={openTask} onMessage={(id) => { setJumpMessageId(id); drawer.close() }} /></>
          if (target.section === 'members') return <RoomMemberDetails room={room} selectedMemberId={target.memberId ?? null}
            rootRequestId={target.rootRequestId} topics={topicState.topics.map((topic) => ({ rootRequestId: topic.rootRequestId, title: topic.title }))}
            onOpenAgent={(id) => void openAgent(id)} onAgentDetails={(agentId) => drawer.open({ kind: 'agent', agentId })}
            onSelectMember={(memberId) => drawer.open({ kind: 'section', section: 'members', memberId })} onRun={openRun} />
          return <RoomTaskStrip key={key} stacked room={room} tasks={state.tasks} selectedId={null} onTask={openTask}
            cursor={state.taskCursor} moreBusy={state.moreBusy} loadMore={state.loadMoreTasks} />
        }} /> : null}
      {teamOpen && teamPreview ? <RoomOnboardingDialog key={previewVersion} state={teamPreview} onRefresh={() => void openTeam()}
        onOpenGroup={(id) => { setTeamOpen(false); chooseRoom(id) }} onClose={() => setTeamOpen(false)} onOpenAgent={(id) => { setTeamOpen(false); void openAgent(id) }}
        onComplete={(value) => { setTeamOpen(false); onboarding.refresh(); if (value.coordinatorRoomId) chooseRoom(value.coordinatorRoomId) }} /> : null}
      {profileOpen ? <RoomUserAvatarEditor onClose={() => setProfileOpen(false)} /> : null}
      {manageOpen ? <RoomModal title={t('agentsDirectory')} onClose={() => setManageOpen(false)}>
        <AgentDirectory onOpen={(id) => { setManageOpen(false); void openAgent(id) }} onDetails={(agentId) => { setManageOpen(false); drawer.open({ kind: 'agent', agentId }) }}
          onCreate={() => { setManageOpen(false); drawer.open({ kind: 'agent' }) }} />
      </RoomModal> : null}
      {settings ? (

        <RoomSettings
          key={`${settings}:${room?.id ?? 'new'}`}
          room={settings === 'edit' ? room : null}
          onClose={() => setSettings(null)}
          onSaved={(value) => {
            state.saved(value)
            setSettings(null)
          }}
        />
      ) : null}
    </div>
  )
}
