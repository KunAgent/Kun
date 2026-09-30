import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import {
  composerReasoningEffortForRailKey,
  composerReasoningEffortForRailPosition,
  composerReasoningRailPointerPosition,
  type ComposerReasoningEffort
} from './floating-composer-model-picker-logic'

/** Pointer capture and keyboard selection for the existing reasoning scale. */
export function useComposerReasoningRail({
  efforts,
  current,
  enabled,
  onChange
}: {
  efforts: ComposerReasoningEffort[]
  current: ComposerReasoningEffort
  enabled: boolean
  onChange?: (effort: ComposerReasoningEffort) => void
}) {
  const pointer = useRef<number | null>(null)
  const select = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const position = composerReasoningRailPointerPosition(event.clientX, rect.left, rect.width)
    const next = composerReasoningEffortForRailPosition(efforts, position)
    if (next && next !== current) onChange?.(next)
  }
  const onReasoningRailPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!enabled) return
    pointer.current = event.pointerId
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic input may not establish capture; in-rail movement still works.
    }
    select(event)
  }
  const onReasoningRailPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (enabled && pointer.current === event.pointerId) select(event)
  }
  const onReasoningRailPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointer.current === event.pointerId) pointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  const onReasoningRailKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!enabled || efforts.length === 0) return
    const next = composerReasoningEffortForRailKey(efforts, current, event.key)
    if (!next) return
    event.preventDefault()
    if (next !== current) onChange?.(next)
  }
  return {
    onReasoningRailPointerDown,
    onReasoningRailPointerMove,
    onReasoningRailPointerUp,
    onReasoningRailKeyDown
  }
}
