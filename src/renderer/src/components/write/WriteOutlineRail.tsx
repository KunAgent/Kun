import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Editor } from '@tiptap/core'
import { workHeadingSlug } from '../../write/work-link'

type Props = {
  editor: Editor | null
  /** Scroll container the headings live in (the `.write-rich-host` div). */
  scrollHost: HTMLElement | null
}

type OutlineEntry = {
  pos: number
  level: number
  text: string
  slug: string
}

function collectHeadings(editor: Editor): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return
    const text = node.textContent.trim()
    if (!text) return
    entries.push({
      pos,
      level: Number(node.attrs.level) || 1,
      text,
      slug: workHeadingSlug(text)
    })
  })
  return entries
}

/**
 * Document outline rail (implementation §9.7): a thin strip on the right
 * edge of the editor that expands to a heading list on hover/focus. Only
 * renders with three or more headings; hidden under 18rem via CSS.
 */
export function WriteOutlineRail({ editor, scrollHost }: Props): ReactElement | null {
  const [revision, setRevision] = useState(0)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const bump = (): void => setRevision((value) => value + 1)
    editor.on('update', bump)
    return () => {
      editor.off('update', bump)
    }
  }, [editor])

  const headings = useMemo(() => {
    if (!editor || editor.isDestroyed) return []
    return collectHeadings(editor)
    // `revision` re-derives the list on every document change; positions stay
    // fresh enough because updates re-render immediately after a dispatch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, revision])

  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!editor || editor.isDestroyed || !scrollHost || headings.length === 0) return
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        const slug = (record.target as HTMLElement).dataset.outlineSlug
        if (!slug) continue
        if (record.isIntersecting) visible.set(slug, record.boundingClientRect.top)
        else visible.delete(slug)
      }
      let best: string | null = null
      let bestTop = Number.POSITIVE_INFINITY
      for (const [slug, top] of visible) {
        if (top < bestTop) {
          bestTop = top
          best = slug
        }
      }
      if (best) setActiveSlug(best)
    }, { root: scrollHost, rootMargin: '0px 0px -70% 0px' })
    observerRef.current = observer
    for (const heading of headings) {
      const dom = editor.view.nodeDOM(heading.pos)
      if (dom instanceof HTMLElement) {
        dom.dataset.outlineSlug = heading.slug
        observer.observe(dom)
      }
    }
    return () => observer.disconnect()
  }, [editor, scrollHost, headings])

  if (!editor || headings.length < 3) return null

  const jump = (entry: OutlineEntry): void => {
    const dom = editor.view.nodeDOM(entry.pos)
    if (!(dom instanceof HTMLElement)) return
    dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
    dom.classList.add('write-outline-flash')
    window.setTimeout(() => dom.classList.remove('write-outline-flash'), 1200)
    setActiveSlug(entry.slug)
  }

  return (
    <div ref={railRef} className="write-outline-rail" tabIndex={0} role="navigation" aria-label="outline">
      <div className="write-outline-ticks">
        {headings.map((heading) => (
          <span
            key={`${heading.slug}-${heading.pos}`}
            className={`write-outline-tick level-${heading.level}${heading.slug === activeSlug ? ' is-active' : ''}`}
          />
        ))}
      </div>
      <div className="write-outline-panel">
        {headings.map((heading) => (
          <button
            key={`${heading.slug}-${heading.pos}`}
            type="button"
            className={`write-outline-item level-${heading.level}${heading.slug === activeSlug ? ' is-active' : ''}`}
            onClick={() => jump(heading)}
          >
            {heading.text}
          </button>
        ))}
      </div>
    </div>
  )
}
