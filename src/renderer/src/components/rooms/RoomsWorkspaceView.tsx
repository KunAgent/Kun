// Loaded first, as the retired Rooms sidebar did, so later surfaces still win.
import './rooms-polish.css'
import { AgentModelSettings, type AgentModels } from './AgentModelSettings'
import { useDirectChat, RoomDirectHeader, RoomDirectProgress, RoomDirectFiles, RoomNoticeDismiss } from './RoomDirectChat'
import './rooms-direct.css'
import { RoomUserAvatarEditor } from './RoomUserAvatarEditor'
import { useRoomUserProfileSync } from './room-user-profile'
import './rooms-init-im.css'
import { AgentHandoffPanel } from './AgentHandoffPanel'
import { AgentDirectory } from './AgentDirectory'
import { AgentDetails } from './AgentDetails'
import { agentPath, useAgentResource } from './agent-client'
import type { AgentIdentity } from '@shared/rooms-api'
import { roomRequestId, roomsRequest } from './rooms-client'
import { useEffect, useMemo, useState, useRef, type ReactElement, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { MessagesSquare } from 'lucide-react'
import type { RoomContentOpenTarget, RoomContentReference, RoomMessage, SendRoomMessage } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { RoomSettings, roomButtonClass } from './RoomSettings'
import { RoomComposer } from './RoomComposer'
import { RoomDirectModelPicker } from './RoomDirectModelPicker'
import { RoomHeader } from './RoomHeader'
import { RoomMemberDetails } from './RoomMemberDetails'
import { roomsClient } from './rooms-client'
import { useRooms } from './useRooms'
import './rooms.css'
import './rooms-chat-surface.css'
import './rooms-code-surface.css'
import { RoomTimeline } from './RoomTimeline'
import { RoomTaskStrip } from './RoomTaskStrip'
import { RoomOverview } from './RoomOverview'
import { useRoomTopics } from './useRoomTopics'
import {
  continueRoomTopic,
  RoomPeerActivity,
  RoomPeerSummary
} from './RoomPeerActivity'
import { RoomAgentActivity, directActivityLabelKey, groupActivity } from './RoomAgentActivity'
import { useRoomReplyAwaiting } from './use-room-reply-awaiting'
import { RoomPendingSendRow } from './RoomPendingSendRow'
import { useRoomPendingSends, type RoomPendingAttachment } from './useRoomPendingSends'
import { roomRespondingMemberIds, roomWaitingMemberIds } from './room-receipt-helpers'
import { RoomRunInspector } from './RoomRunInspector'
import { RoomDrawerNavigation, useRoomDrawerNavigation } from './RoomDrawerNavigation'
import { RoomDrawerTask } from './RoomDrawerTask'
import { RoomReplyThread } from './RoomReplyThread'
import { RoomReminderList } from './RoomReminderList'
import { RoomContentPreview } from './RoomContentPreview'
import { RoomRunSummary } from './RoomRunSummary'
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { openRoomContentTarget } from './room-content-navigation'
import { registerRoomThreadOpener } from './workbench-navigation'
import { otherUserInputAnswers, RoomChoiceCard, submitRoomUserInput } from './RoomChoiceCard'
import { RoomExecutionGates } from './RoomTaskGates'
import { RoomExcalidrawConsumer } from './useRoomExcalidrawConsumer'
import { RoomExcalidrawPanel } from './RoomExcalidrawPanel'
import { RoomAppsPanel } from './RoomAppsPanel'
import { useRoomExcalidrawStore, roomExcalidrawBoard } from './room-excalidraw-store'
import { RoomWorkbenchRightPanel } from './RoomWorkbenchRightPanel'
import { RoomAgentBrowserStatus } from './RoomAgentBrowser'
import { ROOM_COLLABORATION_TAB, useRoomWorkbenchPanel } from './useRoomWorkbenchPanel'
import { AGENT_CHAT_SELECTED_KEY, openAgentConversation, openAgentConversationRoom, useAgentChatNavigationStore } from './agent-chat-navigation'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { roomWorkbenchScopeKey } from './room-surface-selection'
import { useRoomActivityCounts } from './room-activity-counts'
import { openAgentChatDialog } from './agent-chat-picker'
import { AgentInfoBoard } from './AgentInfoBoard'
import { GroupInfoBoard } from './GroupInfoBoard'
import { removalTargetFromRoom } from './agent-chat-removal'
import { useConversationInfoBoard } from './useConversationInfoBoard'
import { useConversationRemoval } from './useConversationRemoval'
import './conversation-info.css'

const surface = 'agent-chat'

/**
 * One Code conversation: an Agent private chat, a group or an Agent pair
 * transcript. The conversation list lives in the Code sidebar; this view keeps
 * the selected room's history, composer and shared right panel.
 */
export function RoomsWorkspaceView({
  onOpenThread,
  onOpenContentTarget,
  onOpenPlugins = () => undefined,
  initialRoomId,
  onToggleLeftSidebar = () => undefined
}: {
  onOpenThread: (id: string, turnId?: string) => void | Promise<void>
  onOpenContentTarget?: (target: RoomContentOpenTarget) => void | Promise<void>
  onOpenPlugins?: () => void
  initialRoomId?: string
  onToggleLeftSidebar?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  useEffect(() => registerRoomThreadOpener(onOpenThread), [onOpenThread])
  const state = useRooms('group', false, { initialSelectedId: initialRoomId,
    selectionKey: AGENT_CHAT_SELECTED_KEY, scope: 'all' })
  const panelScope = roomWorkbenchScopeKey(state.selectedId, state.room)
  const panel = useRoomWorkbenchPanel(panelScope)
  const openCollaboration = panel.openCollaboration
  const closePanelTab = panel.closeTab
  const panelScopeRef = useRef(panelScope)
  panelScopeRef.current = panelScope
  const [appsOpen, setAppsOpen] = useState(false)
  const [choiceReplies, setChoiceReplies] = useState<Record<string, string>>({})
  useRoomUserProfileSync()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const navigationTarget = useAgentChatNavigationStore((value) => value.target)
  const [busy, setBusy] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [jumpMessageId, setJumpMessageId] = useState<string | null>(null)
  const { messages } = state
  const room = state.room?.id === state.selectedId ? state.room : null
  const { selectedId } = state
  const taskCounts = useRoomActivityCounts((value) => room ? value.counts[room.id] : undefined)
  const infoBoard = useConversationInfoBoard(panel, panelScope, Boolean(room && room.conversationKind !== 'agent_agent'))
  const openInfoBoard = infoBoard.open
  const removal = useConversationRemoval()
  const selectedRoomRef = useRef(selectedId)
  selectedRoomRef.current = selectedId
  const topicState = useRoomTopics(selectedId)
  const drawerState = useRoomDrawerNavigation(selectedId)
  const drawer = useMemo(() => ({ ...drawerState, open: (target: Parameters<typeof drawerState.open>[0], replace = false) => {
    drawerState.open(target, replace)
    openCollaboration()
  } }), [drawerState, openCollaboration])
  const openDrawer = drawer.open
  const topFrameKey = drawer.frames.at(-1)?.key
  const currentFrame = useRef(topFrameKey); currentFrame.current = topFrameKey
  const currentPanel = useRef(panel.state); currentPanel.current = panel.state
  const currentContent = useRef(panel.contentTarget?.key); currentContent.current = panel.contentTarget?.key
  useEffect(() => {
    if (topFrameKey !== undefined) openCollaboration()
    else closePanelTab(ROOM_COLLABORATION_TAB)
  }, [topFrameKey, openCollaboration, closePanelTab])
  useEffect(() => {
    const open = () => openDrawer({ kind: 'profile' })
    window.addEventListener('kun-room-user-avatar', open)
    return () => window.removeEventListener('kun-room-user-avatar', open)
  }, [openDrawer])
  const presentation = useRoomPresentationPreferences()
  const [dismissedNotices, setDismissedNotices] = useState<Record<string, string>>({})
  useEffect(() => setDismissedNotices({}), [selectedId])
  const dismissNotice = (key: string, value: string): void =>
    setDismissedNotices((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    setSearchOpen(false)
    setChoiceReplies({})
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
  const pin = async (message: RoomMessage): Promise<boolean> => {
    state.setError('')
    try {
      await roomsClient.pinMessage(message.roomId, message.id, `pin-${message.id}`)
      await state.refresh()
      return true
    } catch (cause) {
      state.setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  // Every conversation kind opens in Code; the stage remounts for a new room.
  const chooseRoom = (id: string, target?: { runId?: string; messageId?: string }): void => {
    if (!mounted.current || useChatStore.getState().route !== surface) return
    openAgentConversationRoom(id, target)
  }
  const openAgent = async (agentId: string) => {
    try { await openAgentConversation(agentId) }
    catch (cause) { if (mounted.current && useChatStore.getState().route === surface) state.setError(String(cause)) }
  }
  useEffect(() => {
    if (navigationTarget && room?.id === navigationTarget.roomId) {
      if (navigationTarget.runId) drawer.open({ kind: 'run', runId: navigationTarget.runId })
      if (navigationTarget.messageId) setJumpMessageId(navigationTarget.messageId)
      if (navigationTarget.info) openInfoBoard()
      useAgentChatNavigationStore.setState({ target: null })
    }
  }, [navigationTarget, room?.id, drawer, openInfoBoard])
  const direct = useDirectChat(room, state.refresh)
  const privateChat = room?.conversationKind === 'user_agent'
  const agentId = privateChat ? room?.members[0]?.participantAgentId : undefined
  const agentProfile = useAgentResource<{ agent: AgentIdentity }>(agentId ? agentPath(agentId) : null)
  const [modelUpdating, setModelUpdating] = useState(false)
  useEffect(() => setModelUpdating(false), [room?.id])
  const agentModels = useAgentResource<AgentModels>(agentId && room ? agentPath(agentId) + '/models?room_id=' + encodeURIComponent(room.id) : null)
  const setupPending = agentProfile.data?.agent.setup?.status === 'pending'
  const choiceInputs = privateChat ? direct.data?.userInputs ?? [] : []
  const openRun = (runId: string): void => { drawer.open({ kind: 'run', runId }); panel.openCollaboration() }
const topDrawerTarget = drawer.frames.at(-1)?.target
const openRunId = topDrawerTarget?.kind === 'run' ? topDrawerTarget.runId : undefined
  const collaborationTitle = topDrawerTarget && topDrawerTarget.kind !== 'section' ? t({
    agent: topDrawerTarget.kind === 'agent' && topDrawerTarget.agentId ? 'agentsProfileAndMemory' : 'agentsCreate',
    handoffs: 'agentsHandoffs', task: 'roomsTasks', reply: 'roomsReplyThreadTitle', run: 'roomsAgentSession',
    content: 'roomsReplyContentTitle', files: 'directFiles', models: 'directModels', reminders: 'roomsReminders',
    settings: 'roomsSettings', directory: 'agentsDirectory', profile: 'roomsMyAvatar'
  }[topDrawerTarget.kind]) : undefined
  const latestRunId = privateChat ? direct.data?.active?.runId ?? direct.data?.requests[0]?.runId : undefined
  const toggleSession = (): void => {
    if (openRunId) drawer.back()
    else if (latestRunId) openRun(latestRunId)
  }
  const openTask = (taskId: string): void => { drawer.open({ kind: 'task', taskId }); panel.openCollaboration() }
  const openMember = (memberId: string, rootRequestId?: string): void => { drawer.open({ kind: 'section', section: 'members', memberId, rootRequestId }); panel.openCollaboration() }
  const openContent = (reference: RoomContentReference, messageId?: string): void => {
    if (privateChat) { drawer.close(); panel.previewContent(reference, messageId) }
    else { drawer.open({ kind: 'content', reference, messageId }); panel.openCollaboration() }
  }
  const steeredSendIds = useMemo(() => new Set(
    (direct.data?.requests ?? [])
      .filter((entry) => entry.steer && ['pending', 'running', 'stopping'].includes(entry.status))
      .map((entry) => entry.clientRequestId)
      .filter((id): id is string => Boolean(id))
  ), [direct.data?.requests])
  const pendingSends = useRoomPendingSends(room?.id, messages, steeredSendIds)
  const replyAwaiting = useRoomReplyAwaiting(Boolean(direct.data?.active) || roomRespondingMemberIds(topicState.topics).length > 0, messages)
  const waitingForReply = pendingSends.pending.some((item) => item.state === 'sent' || item.state === 'steered') || replyAwaiting.awaiting
  const send = async (message: SendRoomMessage, attachments?: RoomPendingAttachment[]): Promise<void> => {
    if (!room) return
    const pending = choiceInputs[0]
    if (privateChat && pending && message.body.trim()) {
      await submitRoomUserInput(pending.id, { answers: otherUserInputAnswers(pending, message.body) })
      setChoiceReplies((current) => ({ ...current, [pending.id]: message.body.trim() }))
      await Promise.all([state.refresh(), direct.refresh(), topicState.refresh()])
      return
    }
    pendingSends.enqueue(message, attachments)
    try {
      await roomsClient.send(room.id, message)
      pendingSends.markSent(message.clientRequestId)
      replyAwaiting.markSent()
    } catch (cause) {
      pendingSends.markFailed(
        message.clientRequestId,
        cause instanceof Error ? cause.message : String(cause)
      )
      throw cause
    }
    await Promise.all([state.refresh(), topicState.refresh()])
  }
  const retryPendingSend = (clientRequestId: string): void => {
    const message = pendingSends.retry(clientRequestId)
    if (message) void send(message).catch(() => undefined)
  }
  const respondingIds = useMemo(() => privateChat ? [] : roomRespondingMemberIds(topicState.topics),
    [privateChat, topicState.topics])
  const waitingIds = useMemo(() => privateChat ? [] : roomWaitingMemberIds(topicState.topics),
    [privateChat, topicState.topics])
  const directActivityKey = privateChat ? directActivityLabelKey(direct.data, waitingForReply) : null
  const activity = room ? (directActivityKey ? { label: t(directActivityKey) }
    : room.conversationKind === 'group' ? groupActivity(room, respondingIds, waitingIds, waitingForReply, t) : null) : null
  const showActivity = Boolean(activity && messages.at(-1)?.status !== 'streaming' &&
    !(privateChat && (choiceInputs.length || direct.data?.approvals.length)))
  const skipSetup = async (): Promise<void> => {
    if (!agentId || !setupPending) return
    await roomsRequest('/v1/agents/' + encodeURIComponent(agentId) + '/setup', 'POST', {
      clientRequestId: roomRequestId(), action: 'skip'
    })
    await Promise.all([agentProfile.refresh(), direct.refresh(), state.refresh()])
  }
  const openExcalidraw = useRoomExcalidrawStore((state) => state.open)
  const openExcalidrawBoard = openExcalidraw && room && openExcalidraw.roomId === room.id
    ? roomExcalidrawBoard(openExcalidraw.roomId, openExcalidraw.boardId)
    : undefined

  return (
    <div
      data-rooms-workspace
      data-room-surface={surface}
      data-room-id={room?.id}
      data-private-chat={privateChat || undefined}
      data-chat-layout={presentation.layout}
      style={{ '--rooms-list-width': `${presentation.listWidth}px`, '--rooms-detail-width': `${presentation.detailWidth}px` } as CSSProperties}
      className="rooms-workspace ds-no-drag relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main"
    >
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {privateChat && room ? <RoomDirectHeader room={room} models={agentModels.data} onSidebar={onToggleLeftSidebar} onSearch={() => setSearchOpen(!searchOpen)}
          onProfile={() => drawer.open({ kind: 'agent', agentId: room.members[0].participantAgentId })} onModels={() => drawer.open({ kind: 'models' })}
          onFiles={() => { drawer.close(); panel.openTab(BUILTIN_RIGHT_PANEL_IDS.files) }} onReminders={() => drawer.open({ kind: 'reminders' })}
          onReset={() => void direct.context('reset')} onConnect={() => void direct.context('workspace')}
          onApps={() => setAppsOpen(true)}
          onTasks={() => drawer.section('tasks')} onSession={toggleSession} sessionOpen={Boolean(openRunId)} sessionDisabled={!latestRunId}
          onManageAgents={() => drawer.open({ kind: 'directory' })} embedded onToggleLeftSidebar={onToggleLeftSidebar}
          onInfo={infoBoard.toggle} onRemove={(kind) => removal.request(removalTargetFromRoom(room), kind)} /> : <RoomHeader room={room} busy={busy} searchOpen={searchOpen}
          onSidebar={onToggleLeftSidebar}
          onSearch={() => setSearchOpen((value) => !value)}
          onApps={() => setAppsOpen(true)}
          onDetails={() => drawer.section('discussion')}
          onHandoffs={() => drawer.open({ kind: 'handoffs' })}
          onMembers={() => drawer.section('members')}
          onSettings={() => drawer.open({ kind: 'settings' })}
          onInfo={room?.conversationKind === 'group' ? infoBoard.open : undefined}
          onRemove={room?.conversationKind === 'group' ? () => removal.request(removalTargetFromRoom(room), 'group') : undefined}
          onUpdate={(patch) => { if (room) void perform(async () => {
            const result = await roomsClient.update(room, patch)
            state.saved(result.room)
          }) }}
        />}
        {state.error && dismissedNotices.room !== state.error ? (
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
            <RoomNoticeDismiss onDismiss={() => dismissNotice('room', state.error)} />
          </div>
        ) : null}
        {state.loading ? (
          <div className="grid flex-1 place-content-center text-sm text-ds-muted">
            {t('roomsLoading')}
          </div>
        ) : room ? (
          <>
            {!privateChat ? <><RoomPeerSummary
              topics={topicState.topics}
              loading={topicState.loading}
              onOpen={() => drawer.section('discussion')}
              onTasks={() => drawer.section('tasks')}
              taskCounts={taskCounts}
            />
            {showActivity ? <div className="agent-collaboration-strip"><button type="button" onClick={() => drawer.open({ kind: 'handoffs' })}>{t('agentsHandoffs')}</button>
            </div> : null}</> : null}
            {!messages.length && privateChat && !direct.data?.active && !choiceInputs.length && !pendingSends.pending.length && !waitingForReply ? <div className="direct-empty-chat"><h2>{t('directWelcome', { name: room.members[0].displayName })}</h2>
              <p>{t(setupPending ? 'directSetupWelcomeHint' : 'directWelcomeHint')}</p>
              {setupPending ? <button type="button" onClick={() => void skipSetup()}>{t('directSkipSetup')}</button> : null}
            </div> : <RoomTimeline
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
              hideEmpty={Boolean(choiceInputs.length || pendingSends.pending.length || showActivity || direct.data?.approvals.length)}
              afterMessages={<>
                {choiceInputs.filter((input) => !messages.some((message) => message.clientRequestId === input.id)).map((input) =>
                  <RoomChoiceCard key={input.id} input={input} resolvedAnswer={choiceReplies[input.id]} setupPending={setupPending} onUpdated={async () => { await direct.refresh(); await state.refresh() }} onSkipSetup={skipSetup} />)}
                {setupPending && !choiceInputs.length ? <button type="button" className="direct-choice-skip" onClick={() => void skipSetup()}>{t('directSkipSetup')}</button> : null}
                {pendingSends.pending.map((item) =>
                  <RoomPendingSendRow key={item.clientRequestId} item={item} onRetry={retryPendingSend} onDismiss={pendingSends.dismiss} />)}
                {privateChat && direct.data?.approvals.length ? <div className="rooms-timeline-gates">
                  <RoomExecutionGates detail={{ approvals: direct.data.approvals, userInputs: [] }}
                    onUpdated={async () => { await direct.refresh(); await state.refresh() }} />
                </div> : null}
                {showActivity && activity ? <RoomAgentActivity room={room} memberId={activity.memberId} label={activity.label}
                  startedAt={privateChat ? direct.data?.activity?.startedAt : undefined} /> : null}
              </>}
              renderChoice={(message) => <RoomChoiceCard input={choiceInputs.find((input) => input.id === message.clientRequestId)} title={message.body}
                resolvedAnswer={choiceReplies[message.clientRequestId ?? '']}
                setupPending={setupPending} onUpdated={async () => { await direct.refresh(); await state.refresh() }} onSkipSetup={skipSetup} />}
            />}
            {privateChat ? <RoomAgentBrowserStatus roomId={room.id} activity={direct.data} error={direct.error}
              onOpen={() => { drawer.close(); panel.openTab(BUILTIN_RIGHT_PANEL_IDS.browser) }} /> : null}
            {privateChat ? <RoomDirectProgress room={room} state={direct} onRun={openRun} openRunId={openRunId} onModels={() => drawer.open({ kind: 'models' })} activityInTimeline gatesInTimeline /> : null}
            {room.conversationKind === 'agent_agent' ? <p className="agent-conversation-note">{t('agentsPairReadOnly')}</p> : <>
              <RoomComposer
                compactControls
                modelUpdating={modelUpdating}
                modelControl={privateChat ? <RoomDirectModelPicker key={room.id} room={room} agentRevision={agentModels.data?.agent.revision} onBusyChange={setModelUpdating}
                  onSaved={async () => { agentModels.refresh(); await state.refresh() }} /> : undefined}
              key={room.id + '-composer'}
              room={room}
              tasks={state.tasks}
              topicChoices={topicState.topics.map((topic) => ({
                rootRequestId: topic.rootRequestId,
                title: topic.title
              }))}
              onSend={send} responding={Boolean(direct.data?.active)} onStop={() => void direct.act('stop')}
              onConnectProject={privateChat ? () => void direct.context('workspace') : undefined}
            />
          </>}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-ds-muted">
            <MessagesSquare size={36} />
            <p>{t('roomsEmpty')}</p>
            <button type="button" className={roomButtonClass} onClick={() => drawer.open({ kind: 'directory' })}>{t('directManageAllAgents')}</button>
            <button
              className={roomButtonClass}
              onClick={() => openAgentChatDialog('picker')}
            >
              {t('roomsSidebarNew')}
            </button>
          </div>
        )}
      {privateChat && room ? <RoomExcalidrawConsumer roomId={room.id} runId={direct.data?.active?.runId} /> : null}
      {openExcalidrawBoard && privateChat ? <RoomExcalidrawPanel boardId={openExcalidrawBoard.boardId}
        workspaceRoot={openExcalidrawBoard.workspaceRoot} title={openExcalidrawBoard.title}
        onClose={() => useRoomExcalidrawStore.getState().closeBoard()} /> : null}
      </section>
      <RoomWorkbenchRightPanel room={room} directWorkspace={direct.data?.workspace.path}
        directActivity={direct.data} directError={direct.error} selectedRunId={openRunId}
        onRefreshDirect={direct.refresh} onCurrentBrowser={drawer.close} onOpenContent={openContent}
        contentPreviewTitle={panel.contentTarget?.reference.titleSnapshot}
        collaborationTitle={collaborationTitle}
        infoTitle={t(privateChat ? 'conversationInfoAgentTitle' : 'conversationInfoGroupTitle')}
        info={!room || room.conversationKind === 'agent_agent' ? undefined : privateChat
          ? <AgentInfoBoard room={room} agent={agentProfile.data?.agent ?? null} models={agentModels.data ?? null}
            activity={direct.data ?? null} onEditProfile={() => drawer.open({ kind: 'agent', agentId })}
            onModels={() => drawer.open({ kind: 'models' })} onNewContext={() => void direct.context('reset')}
            onWorkspace={() => void direct.context('workspace')}
            onRemove={(kind) => removal.request(removalTargetFromRoom(room), kind)} />
          : <GroupInfoBoard room={room} responding={respondingIds} waiting={waitingIds}
            onSettings={() => drawer.open({ kind: 'settings' })} onMembers={() => drawer.section('members')}
            onMemberDetails={(memberId) => openMember(memberId)} onMessageAgent={(id) => void openAgent(id).catch(() => undefined)}
            onRemove={() => removal.request(removalTargetFromRoom(room), 'group')} />}
        contentPreview={room && panel.contentTarget ? (() => {
          const content = panel.contentTarget
          const isCurrent = () => mounted.current && selectedRoomRef.current === room.id && panelScopeRef.current === panelScope &&
            currentContent.current === content.key && currentPanel.current.expanded && currentPanel.current.activeId === BUILTIN_RIGHT_PANEL_IDS.file &&
            useChatStore.getState().route === surface
          return <RoomContentPreview key={content.key} room={room} reference={content.reference} messageId={content.messageId}
            variant="workbench" onFiles={() => { if (isCurrent()) panel.openTab(BUILTIN_RIGHT_PANEL_IDS.files) }}
            onOpenCode={onOpenThread} onOpenTarget={(value) => {
              if (!isCurrent()) return
              return onOpenContentTarget ? onOpenContentTarget(value) : openRoomContentTarget(value, onOpenThread, room.id, isCurrent)
            }} onOpenSource={(source) => {
              if (!isCurrent() || room.conversationKind !== 'user_agent' || source.roomId !== room.id ||
                source.participantAgentId !== room.members[0]?.participantAgentId) return
              if (source.messageId) { setJumpMessageId(source.messageId); drawer.close(); panel.collapse() }
              else openRun(source.runId)
            }} />
        })() : undefined}
        runId={openRunId ?? latestRunId} messages={messages} panel={panel}
        onCollaborationOpen={() => privateChat && latestRunId ? openRun(latestRunId) : drawer.section('members')}
        onCollaborationClose={drawer.close}
        onAddReference={(reference) => window.dispatchEvent(new CustomEvent('kun-room-file-reference', {
          detail: { roomId: selectedId, reference, workspace: direct.data?.workspace }
        }))}
        collaboration={drawer.frames.length ? <RoomDrawerNavigation embedded
          active={panel.state.expanded && panel.state.activeId === ROOM_COLLABORATION_TAB}
          key={(room?.id ?? 'agents') + '-details'} frames={drawer.frames}
        onBack={drawer.back} onClose={drawer.close} onSection={drawer.section}
        render={(target, key, active) => {
          if (target.kind === 'agent') return <AgentDetails key={key} agentId={target.agentId} active={active}
            onSaved={(agent) => {
              void agentProfile.refresh()
              if (!target.agentId) { void openAgent(agent.id).catch(() => undefined) }
              else { drawer.replaceTop({ kind: 'agent', agentId: agent.id }); void Promise.all([state.refresh(), direct.refresh()]) }
            }}
            onOpen={(id) => void openAgent(id).catch(() => undefined)} onConversation={chooseRoom}
            onRun={(roomId, runId) => chooseRoom(roomId, { runId })}
            onSource={(roomId, messageId) => chooseRoom(roomId, { messageId })} />
          if (target.kind === 'directory') return <AgentDirectory key={key} onOpen={(id) => void openAgent(id).catch(() => undefined)}
            onDetails={(agentId) => drawer.open({ kind: 'agent', agentId })} onCreate={() => drawer.open({ kind: 'agent' })} />
          if (target.kind === 'profile') return <RoomUserAvatarEditor key={key} variant="panel" onClose={drawer.back} />
          if (!room) return null
          if (target.kind === 'handoffs') return <AgentHandoffPanel key={key} room={room} messages={messages} topics={topicState.topics}
            active={active} selectedId={target.selectedId} onOpenPair={(id) => { chooseRoom(id) }}
            onSource={chooseRoom} onRun={(roomId, runId) => chooseRoom(roomId, { runId })} />
          if (target.kind === 'run') return <RoomRunInspector key={key} roomId={room.id} runId={target.runId} active={active} onOpenRun={openRun} />
          if (target.kind === 'task') return <RoomDrawerTask key={key} roomId={room.id} taskId={target.taskId} tasks={state.tasks}
            onClose={drawer.back} onRun={openRun} onOpenThread={onOpenThread} onUpdated={() => void state.refresh()} />
          if (target.kind === 'reply') return <RoomReplyThread key={key} room={room} messageId={target.messageId} tasks={state.tasks} active={active}
            onSend={send} onPin={pin} onTask={openTask} onRun={openRun} onMember={openMember} onOpenContent={openContent} />
          if (target.kind === 'content') {
            const isCurrent = () => mounted.current && selectedRoomRef.current === room.id && panelScopeRef.current === panelScope &&
              currentFrame.current === key && currentPanel.current.expanded && currentPanel.current.activeId === ROOM_COLLABORATION_TAB &&
              useChatStore.getState().route === surface
            return <RoomContentPreview key={key} room={room} reference={target.reference} messageId={target.messageId}
              onOpenCode={onOpenThread} onOpenTarget={(value) => {
                if (!isCurrent()) return
                return onOpenContentTarget ? onOpenContentTarget(value) : openRoomContentTarget(value, onOpenThread, room.id, isCurrent)
              }} onOpenSource={(source) => {
                if (!isCurrent() || room.conversationKind !== 'user_agent' || source.roomId !== room.id ||
                  source.participantAgentId !== room.members[0]?.participantAgentId) return
                if (source.messageId) { setJumpMessageId(source.messageId); drawer.close(); panel.collapse() }
                else openRun(source.runId)
              }} />
          }
          if (target.kind === 'files') return <RoomDirectFiles key={key} room={room} onOpen={(reference) => openContent(reference)} />
          if (target.kind === 'reminders') return room ? <RoomReminderList key={key} room={room} active={active} /> : null
          if (target.kind === 'models') return agentId ? <AgentModelSettings key={key} agentId={agentId} room={room} variant="panel"
            onClose={drawer.back} onSaved={() => { agentModels.refresh(); void state.refresh() }} /> : null
          if (target.kind === 'settings') return <RoomSettings key={room.id} room={room} variant="panel"
            onClose={drawer.back} onSaved={(value) => { state.saved(value); drawer.back() }} />
          if (target.section === 'discussion') return <RoomPeerActivity room={room} {...topicState} onUpdated={topicState.refresh}
            onMember={openMember} onOpenRun={openRun} onContinue={(rootRequestId) => { continueRoomTopic(room.id, rootRequestId); drawer.close() }} />
          if (target.section === 'overview') return <><RoomRunSummary roomId={room.id} topics={topicState.topics} />
            <RoomOverview room={room} rules={state.rules} onUpdated={state.refresh}
              onTask={openTask} onMessage={(id) => { setJumpMessageId(id); drawer.close() }} /></>
          if (target.section === 'members') return <RoomMemberDetails room={room} selectedMemberId={target.memberId ?? null}
            rootRequestId={target.rootRequestId} topics={topicState.topics.map((topic) => ({ rootRequestId: topic.rootRequestId, title: topic.title }))}
            onOpenAgent={(id) => void openAgent(id).catch(() => undefined)} onAgentDetails={(agentId) => drawer.open({ kind: 'agent', agentId })}
            onSelectMember={(memberId) => drawer.open({ kind: 'section', section: 'members', memberId })} onRun={openRun}
            onUpdated={() => void state.refresh()} />
          return <RoomTaskStrip key={key} stacked room={room} tasks={state.tasks} selectedId={null} onTask={openTask}
            cursor={state.taskCursor} moreBusy={state.moreBusy} loadMore={state.loadMoreTasks} />
        }} /> : null} />
      {appsOpen ? <RoomAppsPanel onClose={() => setAppsOpen(false)} onOpenPlugins={() => { setAppsOpen(false); onOpenPlugins() }} /> : null}
      {removal.dialog}
    </div>
  )
}
