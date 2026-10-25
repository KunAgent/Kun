import { useEffect } from 'react'
import type { KunAccountState } from '@shared/kun-account'
import { useChatStore } from '../store/chat-store'
import { subscribeRoomEvents } from '../components/rooms/room-event-listeners'
import { clearAnalyticsPresentation, noteAnalyticsRoomMessage, noteAnalyticsTurn } from './presentation'
import { PRODUCT_ANALYTICS_CHANGED, productCaptureEnabled, setProductCapture, trackProduct } from './client'
import { clearWorkAnalytics } from './work'
export function useProductAnalyticsLifecycle() {
  useEffect(() => {
    if (window.kunGui?.isRemoteWeb) return
    let live = true, lastSession = 0, workEntered = false, lastInteraction = 0
    const enterWork = () => {
      if (!workEntered && productCaptureEnabled() && !document.hidden && useChatStore.getState().route === 'write') {
        workEntered = true; trackProduct({ name: 'work_entered', properties: { mode: 'work' } })
      }
    }
    const account = window.kunGui?.kunAccount
    let refreshVersion = 0
    let actor: string | null | undefined
    let applied: { enabled: boolean; epoch?: string } | undefined
    const reset = () => {
      clearAnalyticsPresentation(); clearWorkAnalytics()
      lastSession = 0; workEntered = false; lastInteraction = 0
    }
    const refresh = () => {
      const version = ++refreshVersion
      void window.kunGui?.productAnalytics?.getState().then(async s => {
        if (!live || version !== refreshVersion) return
        // An opted-out installation must not initialize account/network work.
        if (s.enabled && actor === undefined && account?.getState) {
          const state = await account.getState()
          if (!live || version !== refreshVersion) return
          actor = state.user?.id ?? null
        }
        if (applied?.enabled === s.enabled && applied.epoch === s.epoch) return
        reset(); setProductCapture(s.enabled, s.epoch)
        applied = { enabled: s.enabled, epoch: s.epoch }
      }).catch(() => {})
    }
    const accountChanged = (state: KunAccountState) => {
      const nextActor = state.user?.id ?? null
      if (actor !== nextActor) {
        // Fence immediately on an actual identity transition. Token/profile
        // refreshes for the same actor keep in-flight Work attribution intact.
        actor = nextActor; applied = undefined
        setProductCapture(false); reset()
      }
      refresh()
    }
    const stopAccount = account?.onState?.(accountChanged)
    refresh()
    const stopTurns = useChatStore.subscribe((state, previous) => {
      if (state.route !== previous.route) workEntered = false
      if (state.route === 'write' && state.route !== previous.route && Date.now() - lastInteraction < 5_000) enterWork()
      if (productCaptureEnabled() && state.currentTurnId && state.activeThreadId &&
        state.currentTurnId !== previous.currentTurnId && !state.busyUnconfirmed)
        noteAnalyticsTurn(state.activeThreadId, state.currentTurnId, state.currentTurnStartedAtMs ?? 0)
    })
    const stopRooms = subscribeRoomEvents(event => {
      if (event.kind === 'message.created' && event.payload?.id && event.createdAt) noteAnalyticsRoomMessage(event.payload.id, event.createdAt)
    })
    const activity = (event: Event) => {
      if (!productCaptureEnabled() || !event.isTrusted || document.hidden) return
      lastInteraction = Date.now(); enterWork()
      if (Date.now() - lastSession < 30 * 60_000) return
      lastSession = Date.now(); trackProduct({ name: 'app_session_started' })
    }
    window.addEventListener(PRODUCT_ANALYTICS_CHANGED, refresh)
    window.addEventListener('pointerdown', activity, { passive: true }); window.addEventListener('keydown', activity)
    return () => {
      live = false; stopAccount?.(); stopTurns(); stopRooms(); clearAnalyticsPresentation(); clearWorkAnalytics(); setProductCapture(false)
      window.removeEventListener(PRODUCT_ANALYTICS_CHANGED, refresh)
      window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity)
    }
  }, [])
}
