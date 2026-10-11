import { useEffect, useId, type MutableRefObject, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { collectHeadings } from '../../components/write/WriteOutlineRail'
import {
  useWriteEditorBridge,
  type WriteEditorBridgeCommands,
  type WriteOutlineEntry
} from '../write-editor-bridge'
import type { WriteReviewSession } from './review/review-session'

const OUTLINE_PUBLISH_DELAY_MS = 150
const ACTIVE_HEADING_OFFSET_PX = 96

function flashHeading(dom: HTMLElement): void {
  dom.classList.add('write-outline-flash')
  window.setTimeout(() => dom.classList.remove('write-outline-flash'), 1200)
}

function activeHeadingSlug(
  editor: Editor,
  host: HTMLElement | null,
  outline: WriteOutlineEntry[]
): string | null {
  if (!host || outline.length === 0) return null
  const threshold = host.getBoundingClientRect().top + ACTIVE_HEADING_OFFSET_PX
  let active: string | null = outline[0]?.slug ?? null
  for (const entry of outline) {
    const dom = editor.view.nodeDOM(entry.pos)
    if (!(dom instanceof HTMLElement)) continue
    if (dom.getBoundingClientRect().top <= threshold) active = entry.slug
    else break
  }
  return active
}

/**
 * Publishes the focused rich editor's outline and diff-review state to the
 * Work right panels. Returns whether the in-editor floating outline is on.
 */
export function useWriteEditorBridgePublisher({
  editor,
  enabled,
  scrollHostRef,
  reviewSessionRef,
  reviewActive,
  reviewTotal
}: {
  editor: Editor | null
  enabled: boolean
  scrollHostRef: RefObject<HTMLElement | null>
  reviewSessionRef: MutableRefObject<WriteReviewSession | null>
  reviewActive: boolean
  reviewTotal: number
}): boolean {
  const ownerId = useId()
  const floatingOutline = useWriteEditorBridge((state) => state.floatingOutline)

  useEffect(() => {
    const bridge = useWriteEditorBridge.getState()
    if (!enabled || !editor || editor.isDestroyed) {
      bridge.release(ownerId)
      return
    }
    let outline: WriteOutlineEntry[] = []
    let timer: number | null = null
    let frame: number | null = null
    const host = scrollHostRef.current
    const publishActive = (): void => {
      frame = null
      if (editor.isDestroyed) return
      const slug = activeHeadingSlug(editor, scrollHostRef.current, outline)
      if (useWriteEditorBridge.getState().activeHeadingSlug !== slug) {
        useWriteEditorBridge.getState().publish(ownerId, { activeHeadingSlug: slug })
      }
    }
    const publishOutline = (): void => {
      timer = null
      if (editor.isDestroyed) return
      outline = collectHeadings(editor)
      useWriteEditorBridge.getState().publish(ownerId, { outline })
      publishActive()
    }
    const scheduleOutline = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(publishOutline, OUTLINE_PUBLISH_DELAY_MS)
    }
    const onScroll = (): void => {
      if (frame === null) frame = window.requestAnimationFrame(publishActive)
    }
    const commands: WriteEditorBridgeCommands = {
      jumpToHeading: (pos) => {
        if (editor.isDestroyed) return
        const dom = editor.view.nodeDOM(pos)
        if (!(dom instanceof HTMLElement)) return
        dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
        flashHeading(dom)
      },
      resolveChunk: (id, action) => reviewSessionRef.current?.resolve(id, action),
      resolveAll: (action) => reviewSessionRef.current?.resolveAll(action),
      focusChunk: (index) => reviewSessionRef.current?.scrollToChunk(index)
    }
    bridge.publish(ownerId, { commands })
    publishOutline()
    editor.on('update', scheduleOutline)
    host?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      if (frame !== null) window.cancelAnimationFrame(frame)
      editor.off('update', scheduleOutline)
      host?.removeEventListener('scroll', onScroll)
      useWriteEditorBridge.getState().release(ownerId)
    }
  }, [editor, enabled, ownerId, reviewSessionRef, scrollHostRef])

  useEffect(() => {
    if (!enabled || !editor || editor.isDestroyed) return
    const session = reviewSessionRef.current
    useWriteEditorBridge.getState().publish(ownerId, {
      reviewActive,
      reviewChunks: reviewActive && session ? session.chunkSummaries() : []
    })
  }, [editor, enabled, ownerId, reviewActive, reviewSessionRef, reviewTotal])

  return floatingOutline
}
