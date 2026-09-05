const HEADING_RE = /^\s{0,3}(#{2,3})\s+(.+?)\s*#*\s*$/
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/

type FenceState = { marker: '`' | '~'; length: number }

export function normalizePlanTaskPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//, '')
}

function advanceFence(line: string, current: FenceState | null): FenceState | null {
  const match = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match) return current
  const marker = match[1] ?? ''
  const trailing = match[2] ?? ''
  const char = marker[0] as '`' | '~'
  if (!current) return { marker: char, length: marker.length }
  const closes = char === current.marker && marker.length >= current.length && /^\s*$/.test(trailing)
  return closes ? null : current
}

/** True when the plan markdown contains at least one task checkbox outside code fences. */
export function planHasTaskCheckboxes(markdown: string): boolean {
  let fence: FenceState | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const next = advanceFence(line, fence)
    const wasOpen = fence !== null
    fence = next
    if (wasOpen || fence) continue
    if (HEADING_RE.test(line)) continue
    const match = TASK_RE.exec(line)
    if (match?.[2]?.replace(/\s+/g, ' ').trim()) return true
  }
  return false
}
