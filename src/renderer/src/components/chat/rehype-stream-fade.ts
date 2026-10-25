/**
 * Wraps the in-flight graphemes of a streaming reply in fade elements.
 *
 * Births are keyed by source offset, so the plugin maps each rendered text
 * node back to the Markdown source through its position. Only graphemes whose
 * fade is still running are wrapped; everything settled stays a plain text
 * node, which keeps the element count bounded by the tail, not the reply.
 */

export const STREAM_FADE_TAG = 'kun-stream-char'

export type StreamFadeSnapshot = {
  /** Source offset of the first grapheme that may still be fading. */
  fadeFrom: number
  births: ReadonlyMap<number, number>
  /** Render time; graphemes born more than `fadeMs` before it are settled. */
  now: number
  fadeMs: number
}

type HastPoint = { offset?: number }
type HastNode = {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
  position?: { start?: HastPoint; end?: HastPoint }
}

// Code and math keep their own rendering (highlighting, KaTeX) and appear
// without a per-character fade.
const SKIP_TAGS = new Set(['pre', 'code', 'svg', 'math', 'script', 'style'])
const BIRTH_LOOKBACK = 4

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function graphemes(value: string): Array<{ index: number; segment: string }> {
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), ({ index, segment }) => ({ index, segment }))
  }
  const out: Array<{ index: number; segment: string }> = []
  let index = 0
  for (const segment of value) {
    out.push({ index, segment })
    index += segment.length
  }
  return out
}

function isSkipped(node: HastNode): boolean {
  if (node.tagName && SKIP_TAGS.has(node.tagName)) return true
  const className = node.properties?.className
  return Array.isArray(className) && className.some((name) => String(name).includes('katex'))
}

function birthAt(snapshot: StreamFadeSnapshot, offset: number, exact: boolean): number | undefined {
  // An exact position lands on a recorded grapheme start; an approximate one
  // (escapes, entities) may sit a few units after it.
  const lookback = exact ? 1 : BIRTH_LOOKBACK
  for (let back = 0; back < lookback; back += 1) {
    const birth = snapshot.births.get(offset - back)
    if (birth !== undefined) return birth
  }
  return undefined
}

function fadeText(node: HastNode, snapshot: StreamFadeSnapshot, cursor: { offset: number }): HastNode[] | null {
  const value = node.value ?? ''
  const start = node.position?.start?.offset
  const end = node.position?.end?.offset
  const from = typeof start === 'number' ? start : cursor.offset
  const to = typeof end === 'number' ? end : from + value.length
  cursor.offset = to
  if (!value || to <= snapshot.fadeFrom) return null

  // When a text node differs from its source span (escapes, entities, trimmed
  // line ends), align it from the end, where the in-flight tail is.
  const exact = to - from === value.length
  const sourceOffset = (local: number): number =>
    exact ? from + local : Math.max(from, to - (value.length - local))
  const localStart = exact
    ? Math.max(0, snapshot.fadeFrom - from)
    : Math.max(0, value.length - (to - snapshot.fadeFrom) - BIRTH_LOOKBACK)

  const out: HastNode[] = []
  let plain = value.slice(0, localStart)
  let wrapped = false
  for (const { index, segment } of graphemes(value.slice(localStart))) {
    const offset = sourceOffset(localStart + index)
    const birth = offset >= snapshot.fadeFrom ? birthAt(snapshot, offset, exact) : undefined
    if (birth === undefined || birth + snapshot.fadeMs <= snapshot.now || !segment.trim()) {
      plain += segment
      continue
    }
    if (plain) out.push({ type: 'text', value: plain })
    plain = ''
    out.push({
      type: 'element',
      tagName: STREAM_FADE_TAG,
      properties: { dataOffset: offset, dataBirth: birth },
      children: [{ type: 'text', value: segment }]
    })
    wrapped = true
  }
  if (!wrapped) return null
  if (plain) out.push({ type: 'text', value: plain })
  return out
}

function fadeChildren(parent: HastNode, snapshot: StreamFadeSnapshot, cursor: { offset: number }): void {
  const children = parent.children
  if (!children) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child.type === 'text') {
      const replacement = fadeText(child, snapshot, cursor)
      if (replacement) {
        children.splice(index, 1, ...replacement)
        index += replacement.length - 1
      }
      continue
    }
    const start = child.position?.start?.offset
    const end = child.position?.end?.offset
    if (typeof start === 'number') cursor.offset = start
    const settled = typeof end === 'number' && end <= snapshot.fadeFrom
    if (child.type === 'element' && !settled && !isSkipped(child)) {
      fadeChildren(child, snapshot, cursor)
    }
    if (typeof end === 'number') cursor.offset = end
  }
}

/**
 * Per-renderer handle the plugin reads at run time. Streamdown caches its
 * unified processor by the JSON of plugin options, so the handle serializes to
 * a stable per-renderer id: one processor serves a reply for its whole reveal
 * and always sees the snapshot of the render that runs it.
 */
export type StreamFadeSource = {
  current: StreamFadeSnapshot | null
  toJSON: () => string
}

let nextSourceId = 0

export function createStreamFadeSource(): StreamFadeSource {
  nextSourceId += 1
  const id = `stream-fade-${nextSourceId}`
  return { current: null, toJSON: () => id }
}

export function rehypeStreamFade(source: StreamFadeSource) {
  return (tree: HastNode): void => {
    const snapshot = source.current
    if (snapshot) fadeChildren(tree, snapshot, { offset: 0 })
  }
}
