import { FigmaError, FIGMA_MAX_NODE_IDS_PER_REQUEST } from './ports.js'
import type { FigmaFileReference } from './ports.js'

/** User pastes these; the REST API is never addressed through a user link. */
const FIGMA_LINK_HOSTS = new Set(['www.figma.com', 'figma.com'])
const FIGMA_LINK_SECTIONS = new Set(['file', 'design', 'board', 'slides', 'proto'])
const FILE_KEY_PATTERN = /^[A-Za-z0-9]{10,64}$/u
const NODE_ID_PATTERN = /^(\d{1,20})[:-](\d{1,20})$/u

export function isFigmaFileKey(value: string): boolean {
  return FILE_KEY_PATTERN.test(value)
}

export function assertFigmaFileKey(value: string): string {
  if (!isFigmaFileKey(value)) {
    throw new FigmaError('invalid_link', 'That Figma file key is not valid. Paste the full file link instead.')
  }
  return value
}

/**
 * Accepts `1:2` or the `1-2` form Figma puts in `node-id` query parameters and
 * returns the canonical `1:2` id used by the REST API.
 */
export function parseFigmaNodeId(value: string): string {
  const match = NODE_ID_PATTERN.exec(value.trim())
  if (!match) {
    throw new FigmaError('invalid_input', 'Figma node ids look like 1:2 or 1-2. Check the copied node link.')
  }
  return `${match[1]}:${match[2]}`
}

/** Deduplicates while preserving order, then enforces the per-request id budget. */
export function parseFigmaNodeIds(input: readonly string[] | string | undefined): string[] {
  const raw = typeof input === 'string' ? input.split(',') : [...(input ?? [])]
  const ids: string[] = []
  for (const entry of raw) {
    if (!entry.trim()) continue
    const id = parseFigmaNodeId(entry)
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length === 0) {
    throw new FigmaError('invalid_input', 'Select at least one Figma node to read.')
  }
  if (ids.length > FIGMA_MAX_NODE_IDS_PER_REQUEST) {
    throw new FigmaError(
      'invalid_input',
      `Figma reads at most ${FIGMA_MAX_NODE_IDS_PER_REQUEST} nodes per request. Split the selection.`
    )
  }
  return ids
}

/**
 * Parses a pasted Figma link into the file key plus an optional node id.
 * Anything that is not an https figma.com file/design/board/slides/proto link
 * with a plausible key is rejected instead of being fetched.
 */
export function parseFigmaReference(link: string): FigmaFileReference {
  const value = link.trim()
  if (!value) throw new FigmaError('invalid_link', 'Paste a Figma file link to continue.')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new FigmaError('invalid_link', 'Paste a full Figma link that starts with https://www.figma.com/.')
  }
  if (url.protocol !== 'https:' || !FIGMA_LINK_HOSTS.has(url.hostname) || url.username || url.password) {
    throw new FigmaError('invalid_link', 'Only https://www.figma.com/ file links can be read.')
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const section = segments[0]
  const fileKey = segments[1]
  if (!section || !FIGMA_LINK_SECTIONS.has(section) || !fileKey || !isFigmaFileKey(fileKey)) {
    throw new FigmaError('invalid_link', 'That link is not a Figma file. Open the file in Figma and copy its link.')
  }
  const nodeParam = url.searchParams.get('node-id')
  return nodeParam === null ? { fileKey } : { fileKey, nodeId: parseFigmaNodeId(nodeParam) }
}
