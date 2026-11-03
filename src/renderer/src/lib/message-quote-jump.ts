const HIGHLIGHT_NAME = 'kun-message-quote-source'
const FLASH_CLASS = 'ds-message-quote-source-flash'
const FLASH_MS = 1_600

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void }
type HighlightConstructor = new (...ranges: Range[]) => unknown

let clearTimer: number | null = null

function highlightApi(): { registry: HighlightRegistry; Highlight: HighlightConstructor } | null {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights
  const Highlight = (globalThis as unknown as { Highlight?: HighlightConstructor }).Highlight
  return registry && Highlight ? { registry, Highlight } : null
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Find `needle` in the element's rendered text, ignoring whitespace runs, and
 * return a DOM range over it. Markdown rendering drops list markers and
 * merges lines, so only the first line of the quote is matched.
 */
export function findTextRange(root: Element, quoteText: string): Range | null {
  const firstLine = quoteText.split('\n').map(compact).find(Boolean)
  const needle = firstLine ? Array.from(firstLine).slice(0, 80).join('') : ''
  if (!needle) return null
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  // Build a whitespace-compacted haystack with a map back to (node, offset).
  const map: Array<{ node: Text; offset: number }> = []
  let haystack = ''
  let pendingSpace = false
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const data = node.data
    for (let offset = 0; offset < data.length; offset += 1) {
      const character = data[offset]!
      if (/\s/.test(character)) {
        pendingSpace = haystack.length > 0
        continue
      }
      if (pendingSpace) {
        haystack += ' '
        map.push({ node, offset })
        pendingSpace = false
      }
      haystack += character
      map.push({ node, offset })
    }
  }
  const index = haystack.indexOf(needle)
  if (index < 0) return null
  const start = map[index]
  const end = map[index + needle.length - 1]
  if (!start || !end) return null
  const range = root.ownerDocument.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + 1)
  return range
}

function findSourceElement(sourceBlockId: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>('[data-timeline-block-id]')) {
    if (element.dataset.timelineBlockId === sourceBlockId) return element
  }
  return null
}

/** Scroll the quoted message into view and flash the quoted passage. */
export function jumpToMessageQuoteSource(quote: { sourceBlockId?: string; text: string }): boolean {
  if (!quote.sourceBlockId) return false
  const element = findSourceElement(quote.sourceBlockId)
  if (!element) return false
  element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (clearTimer !== null) window.clearTimeout(clearTimer)
  const api = highlightApi()
  const range = api ? findTextRange(element, quote.text) : null
  if (api && range) {
    api.registry.set(HIGHLIGHT_NAME, new api.Highlight(range))
    clearTimer = window.setTimeout(() => {
      api.registry.delete(HIGHLIGHT_NAME)
      clearTimer = null
    }, FLASH_MS)
    return true
  }
  element.classList.remove(FLASH_CLASS)
  // Restart the animation when the same message is flashed twice in a row.
  void element.offsetWidth
  element.classList.add(FLASH_CLASS)
  clearTimer = window.setTimeout(() => {
    element.classList.remove(FLASH_CLASS)
    clearTimer = null
  }, FLASH_MS)
  return true
}
