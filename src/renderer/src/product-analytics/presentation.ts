import { useEffect } from 'react'
import type { ChatBlock } from '../agent/types'
import type { RoomMessage } from '@shared/rooms-api'
import { useChatStore } from '../store/chat-store'
import { analyticsRunKey, captureSince, productCaptureEnabled, trackProduct } from './client'
const liveTurns = new Set<string>(), liveRoomMessages = new Set<string>()
function bounded(set: Set<string>, key: string) { set.add(key); if (set.size > 256) set.delete(set.values().next().value!) }
export function noteAnalyticsTurn(thread: string, turn: string, started: number) {
  if (productCaptureEnabled() && started >= captureSince) bounded(liveTurns, thread + ':' + turn)
}
export function noteAnalyticsRoomMessage(id: string, createdAt: string) {
  if (productCaptureEnabled() && Date.parse(createdAt) >= captureSince) bounded(liveRoomMessages, id)
}
export function clearAnalyticsPresentation() { liveTurns.clear(); liveRoomMessages.clear() }
export function useResultPresented(block: ChatBlock) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!productCaptureEnabled()) return
    if (block.kind !== 'assistant' || block.id === 'live-assistant' || !block.turnId || !block.text.trim() || document.hidden) return
    const state = useChatStore.getState(), key = state.activeThreadId + ':' + block.turnId
    if (state.route !== 'chat' || state.threads.find(thread => thread.id === state.activeThreadId)?.agentSurface === 'write' ||
      !liveTurns.delete(key)) return
    const epochTime = captureSince
    void analyticsRunKey(key).then(runKey => { if (captureSince === epochTime) trackProduct({ name: 'result_presented', properties: { mode: 'code', runKey, outputPresent: true } }) }).catch(() => {})
  }, [block])
}
export function noteAnalyticsRoomRendered(message: RoomMessage) {
  if (typeof document === 'undefined') return
  if (!productCaptureEnabled() || document.hidden || message.authorKind !== 'member' ||
    message.deliveryPhase !== 'final' || !message.body.trim() || !liveRoomMessages.delete(message.id)) return
  if (!message.originRunId) return
  const epochTime = captureSince
  void analyticsRunKey(message.originRunId).then(runKey => { if (captureSince === epochTime) trackProduct({ name: 'result_presented',
    properties: { mode: 'room', runKey, outputPresent: true } }) }).catch(() => {})
}
