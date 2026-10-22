import { useEffect } from 'react'
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
    const refresh = () => { void window.kunGui?.productAnalytics?.getState().then(s => {
      if (live) { setProductCapture(s.enabled, s.epoch); clearAnalyticsPresentation(); clearWorkAnalytics(); lastSession = 0; workEntered = false; lastInteraction = 0 }
    }).catch(() => {}) }
    refresh()
    const stopAccount = window.kunGui?.kunAccount?.onState?.(() => { setProductCapture(false); clearAnalyticsPresentation(); clearWorkAnalytics(); refresh() })
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
