/**
 * `<kun_assignment>` first-turn input for ADE workers (09 §4.3, 12 §6.3).
 * The host renders the persisted dispatch record into a tagged markdown
 * block; the renderer folds it into a collapsed AssignmentCard while the
 * original text stays in history. Malformed or foreign text returns null so
 * the message falls back to a normal user bubble.
 */
export type AssignmentCardData = {
  dispatchId?: string
  workerId?: string
  /** Display name of the assigning manager (`from` attribute). */
  from?: string
  /** Title line — the first non-empty line of the `## Task` section. */
  title?: string
  /** Full markdown body inside the tag. */
  body: string
}

const OPEN_TAG = '<kun_assignment'
const CLOSE_TAG = '</kun_assignment>'

function readAttr(source: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(source)
  return match?.[1]?.trim() || undefined
}

function taskSectionTitle(body: string): string | undefined {
  const task = /^##\s*(?:Task|任务)\s*$/im
  const match = task.exec(body)
  if (!match) return undefined
  const rest = body.slice(match.index + match[0].length)
  for (const line of rest.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('##')) return undefined
    return trimmed.slice(0, 200)
  }
  return undefined
}

/**
 * Parse the assignment wrapper out of a user message. Returns null when the
 * message carries no `<kun_assignment>` tag or the wrapper is malformed —
 * callers then render the message as an ordinary user bubble (12 §6.3).
 */
export function parseAssignmentCard(text: string): AssignmentCardData | null {
  const open = text.indexOf(OPEN_TAG)
  if (open < 0) return null
  const tagEnd = text.indexOf('>', open)
  if (tagEnd < 0) return null
  const close = text.lastIndexOf(CLOSE_TAG)
  if (close <= tagEnd) return null
  const attrs = text.slice(open + OPEN_TAG.length, tagEnd)
  const body = text.slice(tagEnd + 1, close).trim()
  if (!body) return null
  return {
    dispatchId: readAttr(attrs, 'dispatch'),
    workerId: readAttr(attrs, 'worker'),
    from: readAttr(attrs, 'from'),
    title: taskSectionTitle(body),
    body
  }
}

/** Whether a user block should fold into the assignment card. */
export function isAssignmentBlock(input: {
  kind: string
  text: string
}): boolean {
  return input.kind === 'user' && parseAssignmentCard(input.text) !== null
}
