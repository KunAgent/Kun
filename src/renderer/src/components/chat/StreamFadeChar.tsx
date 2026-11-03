import { useRef, type ReactElement, type ReactNode } from 'react'
import './assistant-stream-fade.css'

type StreamFadeCharProps = {
  node?: { properties?: Record<string, unknown> }
  children?: ReactNode
}

/**
 * One in-flight grapheme. The CSS fade starts at mount, so the delay places it
 * at the grapheme's birth: negative once it has started, positive while it is
 * still queued. Keying the span by offset remounts it (restarting the fade at
 * the right phase) when the Markdown renderer reuses this slot for a different
 * grapheme after the settled prefix grows.
 */
export function StreamFadeChar({ node, children }: StreamFadeCharProps): ReactElement {
  const offset = Number(node?.properties?.dataOffset)
  const birth = Number(node?.properties?.dataBirth)
  const delay = useRef<{ offset: number; birth: number; ms: number } | null>(null)
  if (!delay.current || delay.current.offset !== offset || delay.current.birth !== birth) {
    delay.current = { offset, birth, ms: Math.round(birth - performance.now()) }
  }
  return (
    <span
      key={`${offset}:${birth}`}
      className="ds-stream-char"
      style={{ animationDelay: `${delay.current.ms}ms` }}
    >
      {children}
    </span>
  )
}
