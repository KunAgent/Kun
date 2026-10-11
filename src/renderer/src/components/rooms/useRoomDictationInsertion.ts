import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/core'
import { roomRichDraft } from './room-mentions'

/** Append only to the live editor document; never replace a selection or an IME draft. */
export function useRoomDictationInsertion(editor: Editor | null,
  onPendingChange?: (pending: boolean) => void) {
  const pending = useRef<string[]>([])
  const frame = useRef(0)
  const notify = useRef(onPendingChange)
  notify.current = onPendingChange
  const cancelDictation = useCallback(() => {
    if (frame.current) window.cancelAnimationFrame(frame.current)
    frame.current = 0
    pending.current = []
    notify.current?.(false)
  }, [])
  useEffect(() => () => {
    if (frame.current) window.cancelAnimationFrame(frame.current)
    pending.current = []
  }, [])
  const appendDictation = useCallback((text: string) => {
    if (!editor || editor.isDestroyed || !text.trim()) return
    pending.current.push(text.trim())
    notify.current?.(true)
    if (frame.current) return
    const flush = () => {
      frame.current = 0
      if (editor.isDestroyed) return
      if (editor.view.composing) {
        frame.current = window.requestAnimationFrame(flush)
        return
      }
      const current = roomRichDraft(editor.getJSON()).body
      const separator = current && !/\s$/.test(current) ? ' ' : ''
      const insertion = (separator + pending.current.join(' ')).slice(0, Math.max(0, 64000 - current.length))
      pending.current = []
      if (insertion) editor.commands.insertContentAt(editor.state.doc.content.size - 1,
        { type: 'text', text: insertion }, { updateSelection: false })
      notify.current?.(false)
    }
    frame.current = window.requestAnimationFrame(flush)
  }, [editor])
  return { appendDictation, cancelDictation }
}
