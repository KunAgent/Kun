import { useEffect, useRef, type RefObject } from 'react'
import { useChatFindStore } from './chat-find'
import { stableTurnKey, type Turn } from './message-timeline-turns'

const FLASH_MS = 1600
const FLASH_CLASS = 'timeline-find-flash'

function flashNode(node: HTMLElement): void {
  node.classList.remove(FLASH_CLASS)
  // Restart the animation when the same node is found twice in a row.
  void node.offsetWidth
  node.classList.add(FLASH_CLASS)
  window.setTimeout(() => node.classList.remove(FLASH_CLASS), FLASH_MS)
}

/**
 * Consumes chat-find jump requests against the rendered timeline. The target
 * turn may sit in the collapsed earlier-turns window, so it is revealed
 * first; the matched block (when its bubble carries a marker) scrolls to
 * center, otherwise the turn itself does.
 */
export function useTimelineFindJump({
  activeThreadId,
  turns,
  hiddenTurnCount,
  turnRefMap,
  revealTurnAtIndex,
  onActive
}: {
  activeThreadId: string | null
  turns: Turn[]
  hiddenTurnCount: number
  turnRefMap: RefObject<Map<string, HTMLDivElement>>
  revealTurnAtIndex: (index: number) => void
  onActive: (key: string) => void
}): void {
  const jump = useChatFindStore((state) => state.jump)
  const landedNonce = useRef(0)

  useEffect(() => {
    if (!jump || jump.threadId !== activeThreadId || landedNonce.current === jump.nonce) return
    const index = turns.findIndex((turn, position) => stableTurnKey(turn, position) === jump.turnKey)
    if (index < 0) return
    revealTurnAtIndex(index)
    // The reveal is a state update — a hidden turn only enters the ref map on
    // the next commit. Bail here; `hiddenTurnCount` shrinking re-runs this
    // effect and the second pass lands the scroll.
    if (index < hiddenTurnCount) return
    landedNonce.current = jump.nonce
    const frame = window.requestAnimationFrame(() => {
      const key = stableTurnKey(turns[index]!, index)
      const turnNode = turnRefMap.current.get(key)
      if (!turnNode) return
      onActive(key)
      const blockNode = jump.blockId
        ? turnNode.querySelector<HTMLElement>(
            `[data-timeline-block-id="${CSS.escape(jump.blockId)}"]`
          )
        : null
      const target = blockNode ?? turnNode
      target.scrollIntoView({ behavior: 'auto', block: 'center' })
      flashNode(target)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [jump, activeThreadId, turns, hiddenTurnCount, turnRefMap, revealTurnAtIndex, onActive])
}
