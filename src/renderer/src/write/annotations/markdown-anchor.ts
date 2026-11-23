import type { MarkdownAnnotationAnchor } from '@shared/work-annotation-anchor'
import { splitFrontmatter } from '@shared/markdown/frontmatter'
import { parseWorkMdast } from '@shared/markdown/parse-mdast'
import { relocatedQuoteOffset } from './quote-offset'

type SourceBlock = { from: number; to: number }
type SourceIndex = { source: string; version: string; blocks?: SourceBlock[] }

// A small cache keeps the two editor groups from reparsing on scroll. Never
// scan all the files in a workspace to restore a single document's pins.
const recent: SourceIndex[] = []
function indexFor(source: string): SourceIndex {
  const cached = recent.find((entry) => entry.source === source)
  if (cached) return cached
  let first = 0x811c9dc5
  let second = 5381
  for (let index = 0; index < source.length; index++) {
    first = Math.imul(first ^ source.charCodeAt(index), 16777619)
    second = Math.imul(second, 33) ^ source.charCodeAt(index)
  }
  const entry = { source, version: [source.length, first >>> 0, second >>> 0].join('-') }
  recent.unshift(entry)
  if (recent.length > 2) recent.pop()
  return entry
}

export function markdownAnchor(source: string, from: number, to: number, quote: string): MarkdownAnnotationAnchor | null {
  if (from < 0 || to > source.length || from >= to || !quote.trim() || quote.length > 32768 || to - from > 65536) return null
  const selected = source.slice(from, to)
  return {
    kind: 'markdown', source: selected, from, quote, version: indexFor(source).version,
    before: source.slice(Math.max(0, from - 128), from), after: source.slice(to, to + 128),
    unique: source.indexOf(selected) === source.lastIndexOf(selected)
  }
}

/** Raw Markdown offsets, never projection offsets. Ambiguous matches stay detached. */
export function resolveMarkdownAnnotation(source: string, anchor: MarkdownAnnotationAnchor) {
  const index = indexFor(source)
  const needle = anchor.source
  let from = anchor.from
  if (index.version !== anchor.version || source.slice(from, from + needle.length) !== needle) {
    const offset = relocatedQuoteOffset(source, needle, anchor)
    if (offset === null) return null
    from = offset
  }
  if (!index.blocks) {
    const { frontmatter, body } = splitFrontmatter(source)
    index.blocks = parseWorkMdast(body).children.flatMap(({ position }) =>
      position?.start.offset === undefined || position.end.offset === undefined ? [] :
        [{ from: frontmatter.length + position.start.offset, to: frontmatter.length + position.end.offset }])
  }
  const to = from + needle.length
  const blockEnd = index.blocks.find((block) => block.from < to && block.to >= to)?.to
    ?? (source.indexOf('\n', to) < 0 ? source.length : source.indexOf('\n', to))
  return { from, to, blockEnd, ...(anchor.richText ? { richText: true as const } : {}) }
}
