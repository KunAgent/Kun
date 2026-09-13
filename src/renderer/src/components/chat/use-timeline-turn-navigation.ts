import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { stableTurnKey, type Turn } from './message-timeline-turns'
import { useThreadTurnTarget } from './thread-turn-target'

export function useTimelineTurnNavigation({
  activeThreadId, turns, hiddenTurnCount, turnRefMap, revealTurnAtIndex, onActive
}: {
  activeThreadId: string | null
  turns: Turn[]
  hiddenTurnCount: number
  turnRefMap: RefObject<Map<string, HTMLDivElement>>
  revealTurnAtIndex: (index: number) => void
  onActive: (key: string) => void
}): (key: string) => void {
  const target = useThreadTurnTarget((state) => state.target)
  const jumped = useRef<number | null>(null)
  const jump = useCallback((key: string): void => {
    const index = turns.findIndex((turn, position) => stableTurnKey(turn, position) === key)
    if (index < 0) return
    revealTurnAtIndex(index)
    const node = turnRefMap.current.get(key)
    if (!node) return
    onActive(key)
    node.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [turns, turnRefMap, revealTurnAtIndex, onActive])

  useEffect(() => {
    if (!target || target.threadId !== activeThreadId || jumped.current === target.revision) return
    const index = turns.findIndex((turn) => turn.turnId === target.turnId)
    if (index < 0) return
    revealTurnAtIndex(index)
    if (index < hiddenTurnCount) return
    const frame = window.requestAnimationFrame(() => {
      if (!turnRefMap.current.has(target.turnId)) return
      jump(target.turnId)
      jumped.current = target.revision
    })
    return () => window.cancelAnimationFrame(frame)
  }, [target, activeThreadId, turns, hiddenTurnCount, turnRefMap, revealTurnAtIndex, jump])
  return jump
}
