import { showWorkbenchFlash } from '../components/rooms/workbench-flash'
import { deliverPetFollowUp } from './pet-follow-up'
import { activityFeedGeneration, setPetOverlayActivityLive, useActivityStore } from '../store/activity-store'
import { useChatStore } from '../store/chat-store'
import { projectPetActivity, semanticSnapshotKey, type PetThreadSupplement } from './pet-activity'
import { loadPetConversationThreads, petConversationSupplements } from './pet-conversation-threads'
import { queuePetNavigation, resolvePetThreadTarget } from './pet-navigation'
import type { PetActionRequest } from '@shared/pets'

export function petBubbleAllowed(input: {
  preferenceEnabled: boolean
}): boolean {
  return input.preferenceEnabled
}

let stopPublisher: (() => void) | null = null
let lastKey = ''
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
  const publish = (): void => {
    if (!active) return
    setPetOverlayActivityLive(overlayOpen)
    if (!overlayOpen) return
    refreshConversationThreads(publish)
    void Promise.resolve().then(() => {
      const state = useChatStore.getState()
      const rows = Object.values(useActivityStore.getState().rows)
      const snapshot = projectPetActivity({
        generation: activityFeedGeneration(),
        profileKey: window.kunGui.appEnvironment?.profilePath || 'desktop',
        rows,
        supplements: [
          ...state.threads.map((thread) => ({
            threadId: thread.id,
            title: thread.title,
            status: thread.status,
            latestTurnId: thread.latestTurnId,
            latestTurnStatus: thread.latestTurnStatus,
            updatedAt: thread.updatedAt,
            archived: thread.archived,
            roomId: thread.roomContext?.roomId
          })),
          ...conversationSupplements
        ],
        nowMs: Date.now(),
        bubbleAllowed: (item) => petBubbleAllowed({ preferenceEnabled: preferenceFor(item) })
      })
      const key = semanticSnapshotKey(snapshot)
      if (key === lastKey) return
      lastKey = key
      pets.updatePetActivity(snapshot)
    }).catch(() => undefined)
  }
  const refreshSettings = (): void => {
    void pets.getPetSettings().then((settings) => {
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
  const unsubscribeNavigation = pets.onPetNavigationRequested(pullNavigation)
  const unsubscribeFollowUp = pets.onFollowUpRequested((request) => {
    void deliverPetFollowUp({
      threadId: request.threadId,
      prompt: request.prompt,
      knownThreadIds: new Set(useChatStore.getState().threads.map((thread) => thread.id)),
      selectThread: (threadId) => useChatStore.getState().selectThread(threadId),
      sendMessage: (prompt) => useChatStore.getState().sendMessage(prompt)
    }).then((result) => pets.completeFollowUp(request.requestId, result))
  })
  const onFocus = (): void => { ready = true; if (pending) { const next = pending; pending = null; void deliver(next) } }
  window.addEventListener('focus', onFocus)
  refreshSettings()
  pullNavigation()
  stopPublisher = () => {
    active = false
    unsubscribeActivity()
    unsubscribeChat()
    unsubscribeCatalog()
    unsubscribeNavigation()
    unsubscribeFollowUp()
    window.removeEventListener('kun-pet-settings-changed', refreshSettings)
    window.removeEventListener('focus', onFocus)
    setPetOverlayActivityLive(false)
    stopPublisher = null
  }
}

export function stopPetActivityPublisher(): void {
  stopPublisher?.()
}

async function deliver(request: PetActionRequest): Promise<void> {
  if (request.type === 'stop' || request.type === 'follow-up') return
  const threads = new Set(useChatStore.getState().threads.map((thread) => thread.id))
  const target = resolvePetThreadTarget({ request, knownThreadIds: threads })
  if (!target.ok) {
    navigationMessage = 'That task is no longer available.'
    showWorkbenchFlash(navigationMessage, 'error')
    return
  }
  navigationMessage = null
  await useChatStore.getState().selectThread(target.threadId)
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
