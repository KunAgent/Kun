export type PluginPage<T> = {
  items: T[]
  /** 1-based page actually shown (clamped into range). */
  page: number
  pageCount: number
  /** 0-based index of the first item on the page. */
  start: number
  /** 0-based index one past the last item on the page. */
  end: number
  total: number
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): PluginPage<T> {
  const size = Math.max(1, Math.floor(pageSize))
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount)
  const start = (current - 1) * size
  const end = Math.min(start + size, total)
  return { items: items.slice(start, end), page: current, pageCount, start, end, total }
}

export type PageToken = number | 'gap'

/**
 * Page buttons to show: always the first and last page, the current page and
 * its neighbours, with gaps in between, so the pager never grows past 7 slots.
 */
export function pageWindow(page: number, pageCount: number): PageToken[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const near = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((value) => near.add(value))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((value) => near.add(value))
  const pages = [...near].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b)
  const tokens: PageToken[] = []
  for (const value of pages) {
    const previous = tokens[tokens.length - 1]
    if (typeof previous === 'number' && value - previous > 1) tokens.push('gap')
    tokens.push(value)
  }
  return tokens
}
