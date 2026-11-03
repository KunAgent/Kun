import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'

export type QueueDropPosition = 'before' | 'after'

export type QueueDragState = {
  sourceId: string
  targetId?: string
  position?: QueueDropPosition
}

type Translate = (key: string, options?: Record<string, unknown>) => string

export type QueuedMessageReorder = {
  dragState: QueueDragState | null
  /** Polite live-region text after a keyboard or menu move. */
  announcement: string
  registerHandle: (id: string, node: HTMLButtonElement | null) => void
  onHandleKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => void
  onHandleDragStart: (event: ReactDragEvent<HTMLButtonElement>, id: string) => void
  onHandleDragEnd: () => void
  onRowDragOver: (event: ReactDragEvent<HTMLLIElement>, targetId: string) => void
  onRowDragLeave: (event: ReactDragEvent<HTMLLIElement>, targetId: string) => void
  onRowDrop: (event: ReactDragEvent<HTMLLIElement>, targetId: string) => void
  /** Moves a row to the front (row menu) and announces it. */
  moveToTop: (id: string) => void
}

/**
 * Drag and keyboard reordering for the queue. The grip is the handle: drag
 * it onto a row (above or below its midpoint), or focus it and press
 * ArrowUp / ArrowDown to swap with a neighbor. Moves go through `onReorder`
 * by stable ids, so a queue that changes mid-drag never moves the wrong row.
 */
export function useQueuedMessageReorder({
  queue,
  enabled,
  busy,
  onReorder,
  onRevealIndex,
  t
}: {
  queue: readonly QueuedComposerMessage[]
  enabled: boolean
  busy: boolean
  onReorder?: (id: string, targetId: string, position: QueueDropPosition) => void
  /** Called when a keyboard move lands on a row that is folded away. */
  onRevealIndex?: (index: number) => void
  t: Translate
}): QueuedMessageReorder {
  const [dragState, setDragState] = useState<QueueDragState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const queueRevision = JSON.stringify(queue.map((message) => [
    message.id,
    message.deliveryState,
    message.text
  ]))

  // A delivery, removal or edit retires the drag: ids may no longer line up.
  useEffect(() => {
    setDragState(null)
  }, [queueRevision])

  useEffect(() => {
    if (busy) setDragState(null)
  }, [busy])

  const focusHandle = (id: string): void => {
    queueMicrotask(() => handles.current.get(id)?.focus())
  }

  return {
    dragState,
    announcement,
    registerHandle: (id, node) => {
      if (node) handles.current.set(id, node)
      else handles.current.delete(id)
    },
    onHandleKeyDown: (event, id) => {
      if (!enabled || !onReorder || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      const sourceIndex = queue.findIndex((message) => message.id === id)
      const targetIndex = event.key === 'ArrowUp' ? sourceIndex - 1 : sourceIndex + 1
      const target = queue[targetIndex]
      if (sourceIndex < 0 || !target) return
      event.preventDefault()
      event.stopPropagation()
      onRevealIndex?.(targetIndex)
      onReorder(id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
      setAnnouncement(t('queuedMessageMovedToPosition', { position: targetIndex + 1 }))
      focusHandle(id)
    },
    onHandleDragStart: (event, id) => {
      if (!enabled) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', id)
      setDragState({ sourceId: id })
    },
    onHandleDragEnd: () => setDragState(null),
    onRowDragOver: (event, targetId) => {
      if (!enabled || !dragState || dragState.sourceId === targetId) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const bounds = event.currentTarget.getBoundingClientRect()
      const position: QueueDropPosition = event.clientY < bounds.top + bounds.height / 2
        ? 'before'
        : 'after'
      setDragState((current) => current
        ? { sourceId: current.sourceId, targetId, position }
        : null)
    },
    onRowDragLeave: (event, targetId) => {
      if (
        event.currentTarget.contains(event.relatedTarget as Node | null) ||
        dragState?.targetId !== targetId
      ) return
      setDragState((current) => current ? { sourceId: current.sourceId } : null)
    },
    onRowDrop: (event, targetId) => {
      event.preventDefault()
      const sourceId = dragState?.sourceId || event.dataTransfer.getData('text/plain')
      const position = dragState?.targetId === targetId ? dragState.position : undefined
      const ids = new Set(queue.map((message) => message.id))
      if (
        enabled &&
        onReorder &&
        sourceId &&
        sourceId !== targetId &&
        position &&
        ids.has(sourceId) &&
        ids.has(targetId)
      ) {
        onReorder(sourceId, targetId, position)
      }
      setDragState(null)
    },
    moveToTop: (id) => {
      const first = queue[0]
      if (!enabled || !onReorder || !first || first.id === id) return
      onReorder(id, first.id, 'before')
      setAnnouncement(t('queuedMessageMovedToPosition', { position: 1 }))
    }
  }
}
