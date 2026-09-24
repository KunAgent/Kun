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
 * Document outline rail (implementation §9.7, Agentero-style): a compact
 * column of heading markers pinned to the upper-right of the editor. Hover
 * or focus widens it into a card where each marker gains its title, so the
 * collapsed rail never spans the full editor height. Only renders with
 * three or more headings; hidden under 18rem via CSS.
 */
export function WriteOutlineRail({ editor, scrollHost }: Props): ReactElement | null {
  const [revision, setRevision] = useState(0)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
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

  // Long outlines scroll inside the rail; keep the active marker in view
  // without scrolling the document itself.
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>('.write-outline-item.is-active')
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop || item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2
    }
  }, [activeSlug])

  if (!editor || headings.length < 3) return null

  const jump = (entry: OutlineEntry): void => {
    const dom = editor.view.nodeDOM(entry.pos)
    if (!(dom instanceof HTMLElement)) return
    dom.scrollIntoView({ block: 'start', behavior: 'smooth' })
    dom.classList.add('write-outline-flash')
    window.setTimeout(() => dom.classList.remove('write-outline-flash'), 1200)
    setActiveSlug(entry.slug)
  }

  const topLevel = Math.min(...headings.map((heading) => heading.level))

  return (
    <nav className="write-outline-rail" aria-label="outline">
      <div className="write-outline-card">
        <div ref={listRef} className="write-outline-list">
          {headings.map((heading, index) => {
            const depth = Math.min(Math.max(heading.level - topLevel + 1, 1), 6)
            const active = heading.slug === activeSlug
            return (
              <button
                key={`${heading.slug}-${heading.pos}`}
                type="button"
                aria-label={heading.text}
                aria-current={active ? 'location' : undefined}
                className={`write-outline-item depth-${depth}${active ? ' is-active' : ''}${index > 0 && depth === 1 ? ' is-section' : ''}`}
                style={{ paddingLeft: 4 + (depth - 1) * 10 }}
                onClick={() => jump(heading)}
              >
                <span className="write-outline-label">{heading.text}</span>
                <span className="write-outline-marker" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
