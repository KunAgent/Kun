import { useEffect, useRef } from 'react'
import { useChatStore } from '../../store/chat-store'
import {
  buildStickyKunPrompt,
  resolveStickyTarget,
  STICKY_REQUEST_EVENT,
  stickyMentionsKun
} from '../../design/canvas/canvas-sticky'
import { useCanvasShapeStore } from '../../design/canvas/canvas-shape-store'
import type { CanvasSticky } from '../../design/canvas/canvas-types'
import type { SendDesignPromptOptions } from './useDesignPromptController'

const SETTLE_TIMEOUT_MS = 10 * 60 * 1000

type SendDesignPrompt = (value: string, options?: SendDesignPromptOptions) => Promise<boolean>

function patchSticky(stickyId: string, patch: Partial<CanvasSticky>): void {
  const store = useCanvasShapeStore.getState()
  const shape = store.document.objects[stickyId]
  if (!shape?.sticky) return
  store.updateShape(stickyId, { sticky: { ...shape.sticky, ...patch } }, true)
}

/**
 * Sends a sticky note that mentions @Kun as a design turn and keeps the note's
 * status in step: sent while the turn runs, done once the thread goes idle.
 */
export function useStickyKunRequests(sendDesignPrompt: SendDesignPrompt): void {
  const sendRef = useRef(sendDesignPrompt)
  sendRef.current = sendDesignPrompt

  useEffect(() => {
    const unsubscribers = new Set<() => void>()
    const onRequest = (event: Event): void => {
      const stickyId = (event as CustomEvent<{ stickyId?: string }>).detail?.stickyId
      if (!stickyId) return
      const doc = useCanvasShapeStore.getState().document
      const note = doc.objects[stickyId]
      if (!note?.sticky || !stickyMentionsKun(note.textContent) || note.sticky.status === 'sent') return
      const target = resolveStickyTarget(doc, stickyId)
      patchSticky(stickyId, { status: 'sent', targetId: target?.id, resultNote: undefined })
      const prompt = buildStickyKunPrompt({ text: note.textContent ?? '', targetName: target?.name })
      void sendRef.current(prompt, {
        displayText: (note.textContent ?? '').trim(),
        ...(target ? { screenShapeId: target.id } : {})
      }).then((accepted) => {
        if (!accepted) {
          patchSticky(stickyId, { status: 'draft' })
          return
        }
        let sawBusy = useChatStore.getState().busy
        let release = (): void => {}
        const finish = (): void => {
          release()
          patchSticky(stickyId, { status: 'done' })
        }
        const timer = setTimeout(finish, SETTLE_TIMEOUT_MS)
        const unsubscribe = useChatStore.subscribe((state) => {
          if (state.busy) {
            sawBusy = true
            return
          }
          if (sawBusy) finish()
        })
        release = (): void => {
          clearTimeout(timer)
          unsubscribe()
          unsubscribers.delete(release)
        }
        unsubscribers.add(release)
      }).catch(() => patchSticky(stickyId, { status: 'draft' }))
    }
    window.addEventListener(STICKY_REQUEST_EVENT, onRequest)
    return () => {
      window.removeEventListener(STICKY_REQUEST_EVENT, onRequest)
      for (const release of [...unsubscribers]) release()
    }
  }, [])
}
