import { useEffect, useState, type ReactElement } from 'react'
import 'katex/dist/katex.min.css'

type Part = { math: false; text: string } | { math: true; tex: string; html?: string }

const MATH_RE = /\$([^$\n]+)\$|\\\((.+?)\\\)/g

/** Split `$…$` / `\(…\)` inline math out of a paper title. */
export function splitTitleMath(title: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const match of title.matchAll(MATH_RE)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ math: false, text: title.slice(last, index) })
    parts.push({ math: true, tex: (match[1] ?? match[2] ?? '').trim() })
    last = index + match[0].length
  }
  if (last < title.length) parts.push({ math: false, text: title.slice(last) })
  return parts
}

/**
 * Paper title with inline math rendered by KaTeX (loaded lazily, only for
 * titles that contain math). Copying still yields the raw TeX via `title`.
 */
export function PaperTitleText({ title, className }: { title: string; className?: string }): ReactElement {
  const [parts, setParts] = useState<Part[]>(() => splitTitleMath(title))
  const hasMath = parts.some((part) => part.math)

  useEffect(() => {
    const split = splitTitleMath(title)
    setParts(split)
    if (!split.some((part) => part.math)) return
    let canceled = false
    void import('katex').then((module) => {
      if (canceled) return
      const katex = module.default ?? module
      setParts(split.map((part) => part.math
        ? { ...part, html: katex.renderToString(part.tex, { throwOnError: false, output: 'html' }) }
        : part))
    }).catch(() => undefined)
    return () => { canceled = true }
  }, [title])

  if (!hasMath) return <span className={className} title={title}>{title}</span>
  return (
    <span className={className} title={title}>
      {parts.map((part, index) => part.math
        ? part.html
          ? <span key={index} dangerouslySetInnerHTML={{ __html: part.html }} />
          : <span key={index}>{`$${part.tex}$`}</span>
        : <span key={index}>{part.text}</span>)}
    </span>
  )
}
