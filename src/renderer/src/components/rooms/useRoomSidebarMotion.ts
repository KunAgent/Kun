import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { RoomSidebarEntry } from '@shared/rooms-api'

type Position = { top: number; pinned: boolean; element: HTMLElement }
/** FLIP only the mounted rows. Preserve the visible anchor when a pin crosses it. */
export function useRoomSidebarMotion(scroll: RefObject<HTMLDivElement | null>, entries: RoomSidebarEntry[], scope: string) {
  const previous = useRef(new Map<string, Position>()), previousScope = useRef(scope)
  const animations = useRef(new Map<HTMLElement, Animation>())
  const oldScroll = useRef(0)
  useLayoutEffect(() => {
    const container = scroll.current
    if (!container) return
    const before = previous.current, sameScope = previousScope.current === scope
    const nodes = [...container.querySelectorAll<HTMLElement>('[data-sidebar-entry]')]
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    const changed = new Set(entries.filter((entry) => before.has(entry.id) && before.get(entry.id)!.pinned !== entry.pinned).map((entry) => entry.id))
    const next = new Map(nodes.map((element) => [element.dataset.sidebarEntry!, { element, top: element.offsetTop, pinned: byId.get(element.dataset.sidebarEntry!)?.pinned ?? false }]))
    if (sameScope && changed.size && oldScroll.current > 0) {
      const anchor = [...before].find(([id, position]) => !changed.has(id) && next.has(id) && position.top >= oldScroll.current)
      if (anchor) container.scrollTop += next.get(anchor[0])!.top - anchor[1].top
    }
    if (sameScope && changed.size && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const [id, position] of next) {
        const old = before.get(id)
        if (!old || !position.element.animate) continue
        const running = animations.current.get(position.element)
        const transform = running ? new DOMMatrixReadOnly(getComputedStyle(position.element).transform).m42 : 0
        const distance = old.top - position.top + transform + container.scrollTop - oldScroll.current
        running?.cancel()
        if (Math.abs(distance) < 1 || Math.abs(distance) > container.clientHeight * 2) continue
        const animation = position.element.animate([{ transform: `translateY(${distance}px)` }, { transform: 'translateY(0)' }],
          { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' })
        animations.current.set(position.element, animation)
        void animation.finished.catch(() => {}).finally(() => { if (animations.current.get(position.element) === animation) animations.current.delete(position.element) })
      }
    }
    previous.current = next; previousScope.current = scope; oldScroll.current = container.scrollTop
  })
  useLayoutEffect(() => {
    const active = animations.current
    return () => { for (const animation of active.values()) animation.cancel(); active.clear() }
  }, [])
  return () => { oldScroll.current = scroll.current?.scrollTop ?? 0 }
}
