import { useEffect, useRef } from 'react'
import type { ChatBlock } from '../agent/types'
import { useChatStore } from '../store/chat-store'
import { useTimelineFilePreviewThreadId } from '../components/chat/timeline-file-preview-workspace'
import { captureWorkResultAction, noteWorkVisibleFeedback, noteWorkTurnCompleted, subscribeWorkAdmission } from './work'
import { productCaptureEpoch, trackProduct } from './client'

/** Uses the timeline's thread, never the globally selected parent of a child viewer. */
export function useWorkPresentation(block: ChatBlock | undefined, allowFinalResult = true) {
  const threadId = useTimelineFilePreviewThreadId()
  const ref = useRef<HTMLDivElement>(null)
  // Synthetic streaming blocks omit turnId. Only the matching active timeline can supply it.
  const liveTurnId = useChatStore(state => state.activeThreadId === threadId &&
    (block?.id === 'live-assistant' || block?.id === 'live-reasoning') ? state.currentTurnId : undefined)
  const turnId = block?.turnId ?? liveTurnId ?? undefined
  const running = useChatStore(state => state.activeThreadId === threadId &&
    state.currentTurnId === turnId && (state.busy || state.busyUnconfirmed))
  useEffect(() => {
    const element = ref.current
    if (!element || !threadId || !turnId || !block || block.sourceHistoryOrder || !productCaptureEpoch()) return
    const kind = block.kind === 'assistant' ? 'text' : block.kind === 'reasoning' ? 'reasoning' : block.kind === 'tool' ? 'tool' : null
    if (!kind || ((block.kind === 'assistant' || block.kind === 'reasoning') && !block.text.trim())) return
    let intersecting = false
    const visible = () => {
      if (document.hidden || !intersecting || useChatStore.getState().route !== 'write') return
      const thread = useChatStore.getState().threads.find(candidate => candidate.id === threadId)
      if (thread?.latestTurnId === turnId && thread.latestTurnStatus === 'completed') noteWorkTurnCompleted(threadId, turnId)
      noteWorkVisibleFeedback(threadId, turnId, kind, allowFinalResult && !running && block.kind === 'assistant' && block.id !== 'live-assistant')
    }
    // Chromium supplies IntersectionObserver. If an older host lacks it, omit the observation.
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.target === element && entry.isIntersecting)
      visible()
    })
    observer.observe(element)
    const stopAdmission = subscribeWorkAdmission(visible)
    document.addEventListener('visibilitychange', visible)
    return () => { observer.disconnect(); stopAdmission(); document.removeEventListener('visibilitychange', visible) }
  }, [block, threadId, turnId, running, allowFinalResult])
  return { ref, captureAction: (action: 'copy' | 'export') => block ? captureAssistantResultAction(threadId, block, action) : () => {} }
}

export function captureAssistantResultAction(threadId: string, block: ChatBlock, action: 'copy' | 'export'): () => void {
  if (block.sourceHistoryOrder) return () => {}
  const state = useChatStore.getState()
  if (state.route === 'write') return captureWorkResultAction(threadId, block.turnId, action)
  // Keep the existing Code copy metric without classifying Work or child history as Code.
  const epoch = productCaptureEpoch()
  const code = action === 'copy' && state.route === 'chat' && threadId === state.activeThreadId &&
    state.threads.find(thread => thread.id === threadId)?.agentSurface !== 'write'
  return () => {
    if (code && epoch && epoch === productCaptureEpoch()) trackProduct({ name: 'result_action', properties: { mode: 'code', action: 'copy' } })
  }
}
