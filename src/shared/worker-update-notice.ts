export type WorkerUpdateEntry = {
  /** Raw bracket label rendered by the host, e.g. `完成` / `Completed`. */
  status: string
  title: string
  harnessLabel?: string
  /** Trailing reference id (dispatch/question/notice). */
  ref?: string
  /** Indented detail rows under the header (change stats, report, question). */
  rows: string[]
}

function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

export function isWorkerUpdateNoticeSource(
  messageSource: unknown
): messageSource is 'worker_update' {
  return messageSource === 'worker_update'
}

export function isWorkerUpdateNoticeUserMessage(input: {
  text: string
  meta?: Record<string, unknown> | null
}): boolean {
  if (isWorkerUpdateNoticeSource(input.meta?.messageSource)) return true
  return parseWorkerUpdatesNotice(input.text) !== null
}

/**
 * Parse the host-rendered `<kun_worker_updates>` block (09 §6.2) back into
 * rows for the worker-update card. Returns null when the text is not a
 * worker-update notice; malformed rows degrade to their raw header text.
 */
export function parseWorkerUpdatesNotice(text: string): WorkerUpdateEntry[] | null {
  const trimmed = text.trim()
  const open = trimmed.indexOf('<kun_worker_updates>')
  const close = trimmed.lastIndexOf('</kun_worker_updates>')
  if (open < 0 || close <= open) return null
  const body = trimmed.slice(open + '<kun_worker_updates>'.length, close).trim()
  if (!body) return null
  const chunks = body.split(/\n- /)
  const entries: WorkerUpdateEntry[] = []
  for (const chunk of chunks) {
    const source = chunk.startsWith('- ') ? chunk.slice(2) : chunk
    if (!source.trim()) continue
    const lines = source.split('\n')
    const header = lines[0] ?? ''
    const match = header.match(/^\[(.+?)\]\s*(.*)$/)
    if (!match) {
      entries.push({ status: '', title: unescapeXml(header.trim()), rows: detailRows(lines.slice(1)) })
      continue
    }
    const rest = match[2] ?? ''
    // Header tail: `title（harness）ref` — harness is a full-width paren
    // group; the trailing bare token is the reference id.
    let title = rest.trim()
    let harnessLabel: string | undefined
    let ref: string | undefined
    const paren = title.match(/^(.*?)（([^（）]*)）\s*(.*)$/)
    if (paren) {
      title = paren[1]?.trim() ?? ''
      harnessLabel = paren[2]?.trim() || undefined
      const tail = paren[3]?.trim()
      if (tail) ref = tail.split(/\s+/)[0]
    } else {
      const tokens = title.split(/\s+/)
      if (tokens.length > 1 && /^(dsp|q|ntc)_/.test(tokens.at(-1) ?? '')) {
        ref = tokens.pop()
      }
      title = tokens.join(' ').trim()
    }
    entries.push({
      status: unescapeXml(match[1] ?? ''),
      title: unescapeXml(title),
      ...(harnessLabel ? { harnessLabel: unescapeXml(harnessLabel) } : {}),
      ...(ref ? { ref: unescapeXml(ref) } : {}),
      rows: detailRows(lines.slice(1))
    })
  }
  return entries.length ? entries : null
}

function detailRows(lines: string[]): string[] {
  return lines
    .map((line) => unescapeXml(line.trim()))
    .filter((line) => line.length > 0)
}
