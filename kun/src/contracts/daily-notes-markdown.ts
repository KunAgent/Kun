// Pure Markdown parser and surgical mutators for Daily Notes tasks, shared by
// the Kun runtime (Xiao Kun tools) and the desktop Daily Notes renderer.

export type DailyNoteQuadrant = 1 | 2 | 3 | 4

export const DAILY_NOTE_QUADRANTS: readonly DailyNoteQuadrant[] = [1, 2, 3, 4]
export const DAILY_NOTE_QUADRANT_NUMERALS: Record<DailyNoteQuadrant, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV'
}

export type DailyNoteTaskLink =
  | { kind: 'dispatch'; label: string; roomId: string; linkId: string; url: string }
  | { kind: 'room'; label: string; roomId: string; messageId?: string; url: string }
  | { kind: 'thread'; label: string; threadId: string; url: string }

export type DailyNoteLinkSpec = { label: string; url: string }

export type DailyNoteRange = { from: number; to: number }

export type DailyNoteTask = {
  line: number
  indent: number
  parentLine: number | null
  done: boolean
  text: string
  quadrant: DailyNoteQuadrant | null
  link: DailyNoteTaskLink | null
  notes: string[]
  /** Byte range of all indented descendant lines (notes and sub-tasks), or null when none exist. */
  subRange: DailyNoteRange | null
  /** Count of non-empty descendant lines inside `subRange`. */
  subLineCount: number
  /** Offset of the character inside `[ ]`. */
  marker: number
  /** Offset right after `]`. */
  bodyFrom: number
  /** Offset where trailing link/quadrant tokens start, or `end` when absent. */
  metaFrom: number
  linkRange: DailyNoteRange | null
  quadrantRange: DailyNoteRange | null
  /** Offset where the task line content ends (before CR/LF). */
  end: number
  lineFrom: number
  /** End of the task block including indented non-task continuation lines (before trailing newline). */
  blockEnd: number
  /** End of the full subtree including indented sub-tasks and notes (before trailing newline). */
  subtreeEnd: number
}

export type DailyNoteTextChange = { from: number; to: number; insert: string }

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const TASK = /^(\s*[-+*]\s+\[)([ xX])\](.*)$/
const TRAILING_QUADRANT = /\s+!([1-4])\s*$/
const TRAILING_LINK = /\s+\[([^\]]{1,80})\]\((kun:\/\/[^)\s]+)\)\s*$/

export function parseKunTaskUrl(label: string, url: string): DailyNoteTaskLink | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'kun:') return null
    const host = parsed.hostname
    const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (host === 'dispatch' && parts.length >= 2 && parts[0] && parts[1]) {
      return { kind: 'dispatch', label, roomId: parts[0], linkId: parts[1], url }
    }
    if (host === 'room' && parts.length >= 1 && parts[0]) {
      const messageId = parsed.searchParams.get('message') ?? undefined
      return { kind: 'room', label, roomId: parts[0], ...(messageId ? { messageId } : {}), url }
    }
    if (host === 'thread' && parts.length >= 1 && parts[0]) {
      return { kind: 'thread', label, threadId: parts[0], url }
    }
    return null
  } catch {
    return null
  }
}

export function formatKunDispatchUrl(roomId: string, linkId: string): string {
  return `kun://dispatch/${encodeURIComponent(roomId)}/${encodeURIComponent(linkId)}`
}

export function formatKunRoomUrl(roomId: string, messageId?: string): string {
  const base = `kun://room/${encodeURIComponent(roomId)}`
  return messageId ? `${base}?message=${encodeURIComponent(messageId)}` : base
}

export function formatKunThreadUrl(threadId: string): string {
  return `kun://thread/${encodeURIComponent(threadId)}`
}

export function formatTaskMeta(link: DailyNoteLinkSpec | null, quadrant: DailyNoteQuadrant | null): string {
  const linkPart = link ? ` [${link.label.replace(/[\]\r\n]/g, '') || 'Kun'}](${link.url})` : ''
  const quadPart = quadrant ? ` !${quadrant}` : ''
  return linkPart + quadPart
}

export function parseDailyNoteTasks(markdown: string): DailyNoteTask[] {
  const rawLines = markdown.split('\n')
  const lineOffsets: number[] = []
  let cursor = 0
  for (const raw of rawLines) {
    lineOffsets.push(cursor)
    cursor += raw.length + 1
  }

  const tasks: DailyNoteTask[] = []
  let fenceChar = ''
  let fenceLen = 0

  for (let line = 0; line < rawLines.length; line++) {
    const raw = rawLines[line]
    const source = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const offset = lineOffsets[line]
    const fence = FENCE.exec(source)
    if (fence) {
      const marker = fence[1]
      if (!fenceChar) {
        fenceChar = marker[0]
        fenceLen = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLen && source.slice(fence[0].length).trim() === '') {
        fenceChar = ''
        fenceLen = 0
      }
      continue
    }
    if (fenceChar) continue

    const match = TASK.exec(source)
    if (!match) continue

    const taskIndent = /^\s*/.exec(source)![0].length
    const bodyFrom = offset + match[1].length + 2
    const rest = match[3]
    let working = rest
    let quadrant: DailyNoteQuadrant | null = null
    let quadrantRange: DailyNoteRange | null = null
    let link: DailyNoteTaskLink | null = null
    let linkRange: DailyNoteRange | null = null

    for (let step = 0; step < 2; step++) {
      if (quadrant === null) {
        const qMatch = TRAILING_QUADRANT.exec(working)
        if (qMatch) {
          const bangInMatch = qMatch[0].indexOf('!')
          const qStart = bodyFrom + qMatch.index + bangInMatch
          quadrant = Number(qMatch[1]) as DailyNoteQuadrant
          quadrantRange = { from: qStart, to: qStart + 2 }
          working = working.slice(0, qMatch.index)
          continue
        }
      }
      if (link === null) {
        const lMatch = TRAILING_LINK.exec(working)
        if (lMatch) {
          const parsedLink = parseKunTaskUrl(lMatch[1], lMatch[2])
          if (parsedLink) {
            const bracketInMatch = lMatch[0].indexOf('[')
            const lStart = bodyFrom + lMatch.index + bracketInMatch
            const lTextLen = `[${lMatch[1]}](${lMatch[2]})`.length
            link = parsedLink
            linkRange = { from: lStart, to: lStart + lTextLen }
            working = working.slice(0, lMatch.index)
            continue
          }
        }
      }
      break
    }

    const minBodyLen = Math.min(1, rest.length)
    const trimmedLen = Math.max(minBodyLen, working.trimEnd().length)
    const metaFrom = bodyFrom + trimmedLen
    const end = offset + source.length

    // Collect indented non-task continuation lines directly below this task.
    const notes: string[] = []
    let blockEnd = end
    for (let next = line + 1; next < rawLines.length; next++) {
      const nextRaw = rawLines[next]
      const nextSource = nextRaw.endsWith('\r') ? nextRaw.slice(0, -1) : nextRaw
      if (!nextSource.trim() || FENCE.test(nextSource) || TASK.test(nextSource)) break
      const nextIndent = /^\s*/.exec(nextSource)![0].length
      if (nextIndent <= taskIndent) break
      notes.push(nextSource.trim())
      blockEnd = lineOffsets[next] + nextSource.length
    }

    // Collect full indented subtree (both plain notes and nested sub-tasks).
    let subLineCount = 0
    let subtreeEnd = end
    for (let next = line + 1; next < rawLines.length; next++) {
      const nextRaw = rawLines[next]
      const nextSource = nextRaw.endsWith('\r') ? nextRaw.slice(0, -1) : nextRaw
      if (!nextSource.trim()) continue
      const nextIndent = /^\s*/.exec(nextSource)![0].length
      if (nextIndent <= taskIndent || FENCE.test(nextSource)) break
      subLineCount += 1
      subtreeEnd = lineOffsets[next] + nextSource.length
    }
    const subRange: DailyNoteRange | null = subtreeEnd > end
      ? { from: lineOffsets[line + 1], to: subtreeEnd }
      : null

    let parentLine: number | null = null
    for (let i = tasks.length - 1; i >= 0; i--) {
      const candidate = tasks[i]
      if (candidate.indent < taskIndent && offset <= candidate.subtreeEnd) {
        parentLine = candidate.line
        break
      }
    }

    tasks.push({
      line,
      indent: taskIndent,
      parentLine,
      done: match[2] !== ' ',
      text: working.trim(),
      quadrant,
      link,
      notes,
      subRange,
      subLineCount,
      marker: offset + match[1].length,
      bodyFrom,
      metaFrom,
      linkRange,
      quadrantRange,
      end,
      lineFrom: offset,
      blockEnd,
      subtreeEnd
    })
  }
  return tasks
}

export function applyDailyNoteChange(markdown: string, change: DailyNoteTextChange): string {
  return markdown.slice(0, change.from) + change.insert + markdown.slice(change.to)
}

export function toggleDailyNoteTaskChange(task: DailyNoteTask, done = !task.done): DailyNoteTextChange {
  return { from: task.marker, to: task.marker + 1, insert: done ? 'x' : ' ' }
}

export function setDailyNoteTaskQuadrantChange(task: DailyNoteTask, quadrant: DailyNoteQuadrant | null): DailyNoteTextChange {
  const linkSpec = task.link ? { label: task.link.label, url: task.link.url } : null
  return { from: task.metaFrom, to: task.end, insert: formatTaskMeta(linkSpec, quadrant) }
}

export function setDailyNoteTaskLinkChange(task: DailyNoteTask, link: DailyNoteLinkSpec | null): DailyNoteTextChange {
  return { from: task.metaFrom, to: task.end, insert: formatTaskMeta(link, task.quadrant) }
}

export function setDailyNoteTaskTitleChange(task: DailyNoteTask, title: string): DailyNoteTextChange {
  const clean = title.replace(/[\r\n]+/g, ' ').trim()
  return { from: task.bodyFrom, to: task.metaFrom, insert: clean ? ` ${clean}` : ' ' }
}

export function extractDailyNoteTaskSubtree(markdown: string, task: DailyNoteTask): string {
  if (!task.subRange) return ''
  const raw = markdown.slice(task.subRange.from, task.subRange.to)
  const strip = task.indent + 2
  return raw.split(/\r?\n/).map(line => {
    if (!line.trim()) return ''
    const leading = /^\s*/.exec(line)![0].length
    return line.slice(Math.min(strip, leading))
  }).join('\n')
}

export function replaceDailyNoteTaskSubtreeChange(
  markdown: string,
  task: DailyNoteTask,
  subtree: string
): DailyNoteTextChange {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = subtree.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop()
  if (lines.length === 0 || lines.every(line => !line.trim())) {
    return { from: task.end, to: task.subtreeEnd, insert: '' }
  }
  const pad = ' '.repeat(task.indent + 2)
  const indented = lines.map(line => line.trim() ? pad + line : '').join(eol)
  return { from: task.end, to: task.subtreeEnd, insert: eol + indented }
}

export function moveDailyNoteTaskBlockChange(
  markdown: string,
  line: number,
  direction: -1 | 1
): { change: DailyNoteTextChange; nextLine: number } | null {
  const tasks = parseDailyNoteTasks(markdown)
  const current = tasks.find(task => task.line === line)
  if (!current) return null
  const siblings = tasks.filter(task => task.parentLine === current.parentLine && task.indent === current.indent)
  const index = siblings.findIndex(task => task.line === line)
  const swapWith = siblings[index + direction]
  if (!swapWith) return null

  const first = direction < 0 ? swapWith : current
  const second = direction < 0 ? current : swapWith
  const firstBlock = markdown.slice(first.lineFrom, first.subtreeEnd)
  const between = markdown.slice(first.subtreeEnd, second.lineFrom)
  const secondBlock = markdown.slice(second.lineFrom, second.subtreeEnd)
  const change: DailyNoteTextChange = {
    from: first.lineFrom,
    to: second.subtreeEnd,
    insert: secondBlock + between + firstBlock
  }
  const firstLines = firstBlock.split('\n').length
  const secondLines = secondBlock.split('\n').length
  const nextLine = direction < 0 ? swapWith.line : current.line + secondLines - firstLines + (second.line - first.line)
  return { change, nextLine }
}

export function buildDailyNoteTaskPrompt(
  markdown: string,
  task: DailyNoteTask,
  options?: { includeParents?: boolean }
): string {
  const tasksByLine = new Map(parseDailyNoteTasks(markdown).map(item => [item.line, item]))
  const subtree = extractDailyNoteTaskSubtree(markdown, task)
  const ancestors: DailyNoteTask[] = []
  if (options?.includeParents) {
    let cursor = task.parentLine
    while (cursor !== null) {
      const parent = tasksByLine.get(cursor)
      if (!parent) break
      ancestors.unshift(parent)
      cursor = parent.parentLine
    }
  }
  const lines: string[] = []
  ancestors.forEach((ancestor, depth) => {
    lines.push(`${'  '.repeat(depth)}- ${ancestor.text}`)
  })
  const baseDepth = ancestors.length
  const basePad = '  '.repeat(baseDepth)
  lines.push(`${basePad}- ${task.text}`)
  if (subtree.trim()) {
    const childPad = '  '.repeat(baseDepth + 1)
    for (const sub of subtree.split('\n')) {
      lines.push(sub.trim() ? childPad + sub : '')
    }
  }
  return lines.join('\n')
}

export function appendDailyNoteTaskChange(
  markdown: string,
  text: string,
  quadrant: DailyNoteQuadrant | null = null,
  link: DailyNoteLinkSpec | null = null
): DailyNoteTextChange {
  const lastLine = markdown.slice(markdown.lastIndexOf('\n') + 1).replace(/\r$/, '')
  const prefix = lastLine.length ? '\n' : ''
  const body = text.trim().replace(/\s*\n\s*/g, ' ')
  return {
    from: markdown.length,
    to: markdown.length,
    insert: `${prefix}- [ ] ${body}${formatTaskMeta(link, quadrant)}`
  }
}

const normalizeTaskText = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()

export function findMatchingDailyNoteTask(
  tasks: readonly DailyNoteTask[],
  query: { linkUrl?: string; linkId?: string; taskText?: string }
): DailyNoteTask | undefined {
  if (query.linkUrl) {
    const byUrl = tasks.find(task => task.link?.url === query.linkUrl)
    if (byUrl) return byUrl
  }
  if (query.linkId) {
    const byLinkId = tasks.find(task => task.link?.kind === 'dispatch' && task.link.linkId === query.linkId)
    if (byLinkId) return byLinkId
  }
  if (query.taskText) {
    const needle = normalizeTaskText(query.taskText)
    const exactOpen = tasks.find(task => !task.done && normalizeTaskText(task.text) === needle)
    if (exactOpen) return exactOpen
    const exactAny = tasks.find(task => normalizeTaskText(task.text) === needle)
    if (exactAny) return exactAny
  }
  return undefined
}

/** Moves incomplete root-level tasks (with their quadrant, link and subtree) from an earlier note into today. */
export function rolloverIncompleteDailyNoteTasks(
  fromMarkdown: string,
  toMarkdown: string
): { nextFrom: string; nextTo: string; movedCount: number } {
  const allTasks = parseDailyNoteTasks(fromMarkdown)
  const openLines = new Set(allTasks.filter(task => !task.done && task.text.length > 0).map(task => task.line))
  if (openLines.size === 0) return { nextFrom: fromMarkdown, nextTo: toMarkdown, movedCount: 0 }

  // Skip open tasks whose parent task is also open so the parent moves its whole subtree intact.
  const openRoots = allTasks.filter(task => openLines.has(task.line) && (task.parentLine === null || !openLines.has(task.parentLine)))
  const existingTexts = new Set(parseDailyNoteTasks(toMarkdown).map(task => normalizeTaskText(task.text)))
  const blocksToAppend: string[] = []
  let nextFrom = fromMarkdown

  // Remove from bottom to top so earlier offsets stay valid.
  for (const task of [...openRoots].reverse()) {
    const block = fromMarkdown.slice(task.lineFrom, task.subtreeEnd)
    let cutFrom = task.lineFrom
    let cutTo = task.subtreeEnd
    if (nextFrom.slice(cutTo, cutTo + 2) === '\r\n') cutTo += 2
    else if (nextFrom[cutTo] === '\n') cutTo += 1
    else if (cutFrom > 0 && nextFrom[cutFrom - 1] === '\n') {
      cutFrom -= nextFrom[cutFrom - 2] === '\r' ? 2 : 1
    }
    nextFrom = nextFrom.slice(0, cutFrom) + nextFrom.slice(cutTo)
    if (!existingTexts.has(normalizeTaskText(task.text))) {
      blocksToAppend.unshift(block)
    }
  }

  if (blocksToAppend.length === 0) {
    return { nextFrom, nextTo: toMarkdown, movedCount: openRoots.length }
  }
  const lastLine = toMarkdown.slice(toMarkdown.lastIndexOf('\n') + 1).replace(/\r$/, '')
  const sep = toMarkdown.length === 0 || lastLine.length === 0 ? '' : '\n'
  const nextTo = toMarkdown + sep + blocksToAppend.join('\n')
  return { nextFrom, nextTo, movedCount: openRoots.length }
}
