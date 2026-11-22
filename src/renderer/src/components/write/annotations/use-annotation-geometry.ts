import { useLayoutEffect, useState } from 'react'
import type { WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import { locateAnnotation, type AnnotationView } from '../../../write/annotations/document-anchors'

type Geometry = {
  tops: Record<string, number>
  detached: Record<string, boolean>
  highlight: Array<{ left: number; top: number; width: number; height: number }>
}
const EMPTY: Geometry = { tops: {}, detached: {}, highlight: [] }

export function useAnnotationGeometry(
  getView: () => AnnotationView | null,
  items: ReadonlyArray<{ id: string; anchor: WorkAnnotationAnchor; resolved: boolean }>,
  activeId: string | null,
  paused: boolean
): Geometry {
  const [geometry, setGeometry] = useState<Geometry>(EMPTY)
  useLayoutEffect(() => {
    if (paused) return
    const root = getView()?.root
    if (!root || !items.length) { setGeometry(EMPTY); return }
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      const view = getView()
      if (!view) return
      const bounds = root.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      const scaleX = root.offsetWidth / bounds.width
      const scaleY = root.offsetHeight / bounds.height
      const next: Geometry = { tops: {}, detached: {}, highlight: [] }
      for (const item of items) {
        if (item.resolved && item.id !== activeId) continue
        const { status, rects } = locateAnnotation(view, item.anchor)
        if (status === 'detached') next.detached[item.id] = true
        for (const rect of rects) {
          const top = Math.max(bounds.top, rect.top), left = Math.max(bounds.left, rect.left)
          const bottom = Math.min(bounds.bottom, rect.bottom), right = Math.min(bounds.right, rect.right)
          if (bottom <= top || right <= left) continue
          next.tops[item.id] ??= (top - bounds.top) * scaleY
          if (item.id === activeId) next.highlight.push({
            top: (top - bounds.top) * scaleY, left: (left - bounds.left) * scaleX,
            width: (right - left) * scaleX, height: (bottom - top) * scaleY
          })
        }
      }
      setGeometry(next)
    }
    const schedule = (): void => { if (frame === null) frame = requestAnimationFrame(measure) }
    // Observe the document, excluding the UI this measurement itself renders.
    const content = root.firstElementChild
    const mutations = new MutationObserver(schedule)
    if (content) mutations.observe(content, { childList: true, subtree: true, attributes: true, characterData: true })
    const resizes = new ResizeObserver(schedule)
    resizes.observe(root)
    if (content) resizes.observe(content)
    root.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      mutations.disconnect()
      resizes.disconnect()
      root.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [getView, items, activeId, paused])
  return geometry
}
