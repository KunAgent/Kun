import type { ActivityRow } from '@shared/activity-row'
import { showWorkbenchFlash } from '../components/rooms/workbench-flash'
import { summarizeToolLiveAction } from '../components/chat/message-timeline-tool-action'
import i18n from '../i18n'
import { deliverPetFollowUp } from './pet-follow-up'
import { activityFeedGeneration, setPetOverlayActivityLive, useActivityStore } from '../store/activity-store'
import { useChatStore } from '../store/chat-store'
import type { ChatState } from '../store/chat-store-types'
import type { ToolBlock } from '../agent/types'
import { applyPetResultText, latestAssistantPreview, petWorkProcessText, presentPetRunningItem, projectPetActivity, semanticSnapshotKey, type PetThreadSupplement } from './pet-activity'
import { loadPetConversationThreads, petConversationSupplements } from './pet-conversation-threads'
import { PET_OPEN_SETTINGS_EVENT, queuePetNavigation, resolvePetThreadTarget } from './pet-navigation'
import type { PetActionRequest } from '@shared/pets'
import { currentPetThread, petSnapshotForDelivery } from './pet-publisher-snapshot'
import { deliverPetChat } from './pet-new-chat'

export function petBubbleAllowed(input: {
  preferenceEnabled: boolean
}): boolean {
  return input.preferenceEnabled
}

let stopPublisher: (() => void) | null = null
let navigationMessage: string | null = null
let preferences = { waiting: true, failed: true, done: true, stalled: true }
let conversationSupplements: PetThreadSupplement[] = []
let conversationLoadedAt = 0
let conversationLoading = false

export function petNavigationNotice(): string | null {
  return navigationMessage
}

export function startPetActivityPublisher(): void {
  if (stopPublisher || typeof window === 'undefined' || !window.kunGui?.pets) return
  const pets = window.kunGui.pets
  let ready = true
  let overlayOpen = false
  let active = true
  let pending: PetActionRequest | null = null
  let lastKey = ''
  const publish = (): void => {
    if (!active) return
    setPetOverlayActivityLive(overlayOpen)
    if (!overlayOpen) return
    refreshConversationThreads(publish)
    void Promise.resolve().then(() => {
      if (!active || !overlayOpen) return
      const state = useChatStore.getState()
      const current = currentPetThread(state)
      // A previous turn's row must not mask this turn while metadata catches up.
      const rows = Object.values(useActivityStore.getState().rows).filter((row) =>
        !current || row.threadId !== current.threadId || row.turnId === current.latestTurnId
      )
      const projected = projectPetActivity({
        generation: activityFeedGeneration(),
        profileKey: window.kunGui.appEnvironment?.profilePath || 'desktop',
        rows,
        supplements: [
          ...(current ? [current] : []),
          ...state.threads.filter((thread) => thread.id !== current?.threadId).map((thread) => ({
            threadId: thread.id,
            title: thread.title,
            status: thread.status,
            latestTurnId: thread.latestTurnId,
            latestTurnStatus: thread.latestTurnStatus,
            updatedAt: thread.updatedAt,
            archived: thread.archived,
            roomId: thread.roomContext?.roomId
          })),
          ...conversationSupplements.filter((thread) => thread.threadId !== current?.threadId)
        ],
        nowMs: Date.now(),
        bubbleAllowed: (item) => petBubbleAllowed({ preferenceEnabled: preferenceFor(item) })
      })
      const withProcess = projected.items.map((item) => presentRunningPetItem(item, state, rows))
      const livePreview = state.activeThreadId ? latestAssistantPreview(state.blocks, 180, state.busy ? state.currentTurnId : null) : ''
      const items = applyPetResultText(withProcess, (threadId) => {
        if (threadId === state.activeThreadId && livePreview && !state.busy) return livePreview
        return state.threads.find((thread) => thread.id === threadId)?.preview
      })
      const snapshot = petSnapshotForDelivery({ ...projected, items }, state.activeThreadId)
      const key = semanticSnapshotKey(snapshot)
      if (key === lastKey) return
      lastKey = key
      pets.updatePetActivity(snapshot)
    }).catch(() => undefined)
  }
  const refreshSettings = (): void => {
    void pets.getPetSettings().then((settings) => {
      if (!active) return
      if (settings.overlayOpen && !overlayOpen) lastKey = ''
      overlayOpen = settings.overlayOpen
      publish()
    }).catch(() => undefined)
    void window.kunGui.getSettings?.().then((settings) => {
      const notes = settings.agents?.kun?.ade?.notifications
      if (!notes) return
      setPetNotificationPreferences({
        waiting: notes.waiting !== false,
        failed: notes.failed !== false,
        done: notes.done !== false,
        stalled: notes.stalled !== false
      })
    }).catch(() => undefined)
  }
  const unsubscribeActivity = useActivityStore.subscribe(publish)
  const unsubscribeChat = useChatStore.subscribe(publish)
  const unsubscribeCatalog = pets.onPetCatalogChanged(refreshSettings)
  window.addEventListener('kun-pet-settings-changed', refreshSettings)
  const pullNavigation = (): void => {
    void pets.takePendingNavigation().then((request) => {
      if (!request) return
      const queued = queuePetNavigation({ ready, request, pending })
      pending = queued.pending
      if (queued.deliver) void deliver(queued.deliver)
    }).catch(() => undefined)
  }
  const openPetSettings = (): void => {
    if (typeof pets.takePendingSettings !== 'function') return
    void pets.takePendingSettings().then((pending) => {
      if (!pending) return
      useChatStore.getState().openSettings('pets')
      window.dispatchEvent(new Event(PET_OPEN_SETTINGS_EVENT))
    }).catch(() => undefined)
  }
  const unsubscribeNavigation = pets.onPetNavigationRequested(pullNavigation)
  const unsubscribeSettings = typeof pets.onPetSettingsRequested === 'function'
    ? pets.onPetSettingsRequested(openPetSettings)
    : () => undefined
  const unsubscribeFollowUp = pets.onFollowUpRequested((request) => {
    void deliverPetFollowUp({
      threadId: request.threadId,
      prompt: request.prompt,
      knownThreadIds: new Set(useChatStore.getState().threads.map((thread) => thread.id)),
      selectThread: (threadId) => useChatStore.getState().selectThread(threadId),
      sendMessage: (prompt) => useChatStore.getState().sendMessage(prompt)
    }).then((result) => pets.completeFollowUp(request.requestId, result))
  })
  let creatingChat = false
  const unsubscribeChatRequest = pets.onChatRequested((request) => {
    if (creatingChat) {
      pets.completeChat(request.requestId, { ok: false, code: 'conflict', message: '正在发送上一条消息' })
      return
    }
    creatingChat = true
    void deliverPetChat(request.prompt, request.requestId, useChatStore.getState)
      .then((result) => pets.completeChat(request.requestId, result))
      .finally(() => { creatingChat = false })
  })
  const onFocus = (): void => { ready = true; if (pending) { const next = pending; pending = null; void deliver(next) } }
  window.addEventListener('focus', onFocus)
  refreshSettings()
  pullNavigation()
  openPetSettings()
  stopPublisher = () => {
    active = false
    unsubscribeActivity()
    unsubscribeChat()
    unsubscribeCatalog()
    unsubscribeNavigation()
    unsubscribeSettings()
    unsubscribeFollowUp()
    unsubscribeChatRequest()
    window.removeEventListener('kun-pet-settings-changed', refreshSettings)
    window.removeEventListener('focus', onFocus)
    setPetOverlayActivityLive(false)
    stopPublisher = null
  }
}

export function stopPetActivityPublisher(): void {
  stopPublisher?.()
}

function knownPetThreadIds(): Set<string> {
  const state = useChatStore.getState()
  const ids = new Set<string>([
    ...state.threads.map((thread) => thread.id),
    ...(state.adeThreads ?? []).map((thread) => thread.id),
    ...conversationSupplements.map((thread) => thread.threadId)
  ])
  for (const row of Object.values(useActivityStore.getState().rows)) ids.add(row.threadId)
  if (state.activeThreadId) ids.add(state.activeThreadId)
  return ids
}

async function deliver(request: PetActionRequest): Promise<void> {
  if (request.type === 'stop' || request.type === 'follow-up') return
  const target = resolvePetThreadTarget({ request, knownThreadIds: knownPetThreadIds() })
  if (!target.ok) {
    navigationMessage = 'That task is no longer available.'
    showWorkbenchFlash(navigationMessage, 'error')
    return
  }
  navigationMessage = null
  const store = useChatStore.getState()
  if (store.route !== 'chat') store.setRoute('chat')
  await store.selectThread(target.threadId)
}

function refreshConversationThreads(publish: () => void): void {
  if (conversationLoading || Date.now() - conversationLoadedAt < 1500) return
  conversationLoading = true
  void loadPetConversationThreads()
    .then((threads) => {
      const known = new Set(useChatStore.getState().threads.map((thread) => thread.id))
      conversationSupplements = petConversationSupplements(threads, known)
    })
    .catch(() => undefined)
    .finally(() => {
      conversationLoadedAt = Date.now()
      conversationLoading = false
      publish()
    })
}

function presentRunningPetItem(
  item: ReturnType<typeof projectPetActivity>['items'][number],
  state: ChatState,
  rows: readonly ActivityRow[]
) {
  if (item.status !== 'running') return item
  const row = rows.find((candidate) => candidate.unitId === item.unitId)
  const live = item.threadId === state.activeThreadId && state.busy && !state.busyUnconfirmed
  if (live) {
    const assistant = currentTurnAssistantText(state)
    if (assistant) return presentPetRunningItem(item, { assistantText: assistant })
    return presentPetRunningItem(item, {
      processText: liveProcessText(state, row),
      liveSinceMs: liveSinceMs(state, item.stateSince)
    })
  }
  if (item.subtitle?.trim()) return item
  return presentPetRunningItem(item, {
    processText: liveProcessText(state, row, false),
    liveSinceMs: Date.parse(item.stateSince)
  })
}

function currentTurnAssistantText(state: ChatState): string {
  const turnId = state.currentTurnId
  const fromBlocks = turnId ? latestAssistantPreview(state.blocks, 180, turnId) : ''
  const live = state.liveAssistant.replace(/\s+/g, ' ').trim()
  const liveMatches = !state.liveAssistantTurnId || !turnId || state.liveAssistantTurnId === turnId
  const liveText = liveMatches ? live : ''
  if (liveText.length > fromBlocks.length) {
    return liveText.length > 180 ? `${liveText.slice(0, 180).trimEnd()}…` : liveText
  }
  return fromBlocks
}

function liveProcessText(state: ChatState, row: ActivityRow | undefined, live = true): string {
  const tool = live ? runningToolBlock(state) : undefined
  const toolAction = tool
    ? summarizeToolLiveAction(tool, translatePet)
    : toolActionName(row?.currentTool)
  const thinking = live && !toolAction && hasCurrentReasoning(state)
  return petWorkProcessText({
    toolAction,
    progressNote: live ? undefined : row?.progressNote,
    thinking,
    workingLabel: i18n.t('workingSprint', { ns: 'common' }),
    thinkingLabel: i18n.t('thinkingNow', { ns: 'common' }),
    toolLabel: (action) => i18n.t('workingToolAction', { ns: 'common', action })
  })
}

function runningToolBlock(state: ChatState): ToolBlock | undefined {
  const turnId = state.currentTurnId
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index]
    if (block?.kind !== 'tool' || block.status !== 'running') continue
    if (turnId && block.turnId && block.turnId !== turnId) continue
    return block
  }
  return undefined
}

function hasCurrentReasoning(state: ChatState): boolean {
  const turnId = state.currentTurnId
  const live = state.liveReasoning.trim()
  if (live && (!state.liveReasoningTurnId || !turnId || state.liveReasoningTurnId === turnId)) return true
  return state.blocks.some((block) =>
    block.kind === 'reasoning' && (!turnId || block.turnId === turnId) && block.text.trim().length > 0
  )
}

function toolActionName(name: string | undefined): string | undefined {
  const toolName = name?.trim()
  if (!toolName) return undefined
  return summarizeToolLiveAction({
    kind: 'tool',
    id: 'pet-process',
    summary: toolName,
    status: 'running',
    meta: { toolName }
  }, translatePet)
}

function translatePet(key: string, opts?: Record<string, unknown>): string {
  const defaultValue = typeof opts?.defaultValue === 'string' ? opts.defaultValue : undefined
  return i18n.t(key, { ns: 'common', ...opts, defaultValue })
}

function liveSinceMs(state: ChatState, stateSince: string): number | undefined {
  const started = state.currentTurnStartedAtMs
    ?? (state.currentTurnUserId ? state.turnStartedAtByUserId[state.currentTurnUserId] : undefined)
  if (typeof started === 'number' && Number.isFinite(started)) return started
  const parsed = Date.parse(stateSince)
  return Number.isFinite(parsed) ? parsed : undefined
}

function preferenceFor(item: { status: string; stalled: boolean }): boolean {
  if (item.status === 'running') return true
  if (item.stalled) return preferences.stalled
  if (item.status === 'waiting') return preferences.waiting
  if (item.status === 'failed') return preferences.failed
  return preferences.done
}

export function setPetNotificationPreferences(next: typeof preferences): void {
  preferences = next
}
