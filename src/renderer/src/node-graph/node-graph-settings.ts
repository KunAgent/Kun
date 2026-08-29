import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'
import { NODE_GRAPH_NODE_KINDS, type NodeGraphNodeKind } from './node-graph-types'

export const NODE_GRAPH_SETTINGS_KEY = 'kun.nodeGraph.settings.v1'

/**
 * A named, colored set of nodes.
 *
 * Membership comes from two independent sources and a node may be in only one
 * group, because a node has exactly one color:
 * - `nodeIds` — assigned by hand from a node's context menu. Explicit, so it
 *   always wins over a pattern.
 * - `query` — the Obsidian-style search that colors whatever it matches.
 *
 * A group may use either, both, or neither (an empty group is a valid, if
 * inert, colour slot the user is still filling in).
 */
export type NodeGraphGroup = {
  id: string
  name: string
  color: string
  query: string
  nodeIds: string[]
}

export type NodeGraphSettings = {
  /** Filters */
  search: string
  kinds: Record<NodeGraphNodeKind, boolean>
  /** Hides nodes with fewer connections than this, for decluttering. */
  minDegree: number
  showOrphans: boolean
  /** Sends `changed_files=false` upstream when off, skipping the run scan. */
  includeChangedFiles: boolean
  /** Groups */
  groups: NodeGraphGroup[]
  /** Display */
  showArrows: boolean
  /** Relationship names drawn along the links. */
  showEdgeLabels: boolean
  /** Overview map in the canvas corner. */
  showMinimap: boolean
  /** Zoom level below which labels fade out. */
  textFadeThreshold: number
  nodeSize: number
  linkThickness: number
  /** Forces */
  centerForce: number
  repelForce: number
  linkForce: number
  linkDistance: number
  /** Local graph: hops from the focused node, or 0 for the global graph. */
  localDepth: number
}

/**
 * Quick-pick palette. Any hex colour is allowed — this is only the set offered
 * as one-click swatches in the panel and the node context menu.
 */
export const NODE_GRAPH_GROUP_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
  '#f43f5e',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#64748b'
] as const

export const MAX_NODE_GRAPH_GROUPS = 24
export const MAX_NODE_GRAPH_GROUP_MEMBERS = 2_000

/**
 * Every kind is user-toggleable again: the node-kind legend doubles as the
 * filter, so each kind has a visible control and its stored value can safely be
 * read back. (A kind with no control must never restore from storage — it would
 * be stuck off with no way to fix it — which is why this list exists at all.)
 */
export const USER_TOGGLEABLE_NODE_KINDS: readonly NodeGraphNodeKind[] = NODE_GRAPH_NODE_KINDS

const RANGES = {
  textFadeThreshold: { min: 0, max: 3, step: 0.05 },
  nodeSize: { min: 0.4, max: 3, step: 0.05 },
  linkThickness: { min: 0.4, max: 4, step: 0.05 },
  centerForce: { min: 0, max: 1, step: 0.01 },
  repelForce: { min: 0, max: 3, step: 0.05 },
  linkForce: { min: 0, max: 1, step: 0.01 },
  linkDistance: { min: 20, max: 400, step: 5 },
  localDepth: { min: 1, max: 5, step: 1 },
  minDegree: { min: 0, max: 20, step: 1 }
} as const

export type NodeGraphSliderKey = keyof typeof RANGES

export function nodeGraphSliderRange(key: NodeGraphSliderKey): {
  min: number
  max: number
  step: number
} {
  return RANGES[key]
}

/**
 * Sections are off by default: a mid-size vault has an order of magnitude
 * more headings than files, and Obsidian likewise hides attachments until
 * asked. Everything else starts visible.
 */
export const DEFAULT_NODE_GRAPH_SETTINGS: NodeGraphSettings = {
  search: '',
  kinds: {
    workspace: true,
    thread: true,
    agent: true,
    knowledgeBase: true,
    folder: true,
    document: true,
    section: false,
    memory: true,
    tag: true,
    file: true
  },
  minDegree: 0,
  showOrphans: true,
  includeChangedFiles: true,
  groups: [],
  showArrows: true,
  showEdgeLabels: true,
  showMinimap: true,
  textFadeThreshold: 0.6,
  nodeSize: 1,
  linkThickness: 1,
  centerForce: 0.12,
  repelForce: 1,
  linkForce: 0.35,
  linkDistance: 90,
  localDepth: 1
}

function clampNumber(value: unknown, key: NodeGraphSliderKey): number {
  const range = RANGES[key]
  const fallback = DEFAULT_NODE_GRAPH_SETTINGS[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

export function normalizeNodeGraphColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase()
  // `#abc` shorthand is what a hand-edited value or an older build may hold.
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed.toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return fallback
}

function normalizeGroupMembers(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (seen.size >= MAX_NODE_GRAPH_GROUP_MEMBERS) break
  }
  return [...seen]
}

function normalizeGroups(value: unknown): NodeGraphGroup[] {
  if (!Array.isArray(value)) return []
  const groups: NodeGraphGroup[] = []
  for (const entry of value.slice(0, MAX_NODE_GRAPH_GROUPS)) {
    if (!entry || typeof entry !== 'object') continue
    const group = entry as Partial<NodeGraphGroup>
    const position = groups.length
    groups.push({
      id: typeof group.id === 'string' && group.id ? group.id : `group-${position + 1}`,
      name: typeof group.name === 'string' ? group.name.slice(0, 60) : '',
      color: normalizeNodeGraphColor(
        group.color,
        NODE_GRAPH_GROUP_COLORS[position % NODE_GRAPH_GROUP_COLORS.length]!
      ),
      query: typeof group.query === 'string' ? group.query.slice(0, 200) : '',
      nodeIds: normalizeGroupMembers(group.nodeIds)
    })
  }
  return groups
}

export function normalizeNodeGraphSettings(value: unknown): NodeGraphSettings {
  const raw = (value ?? {}) as Partial<NodeGraphSettings>
  const kinds = { ...DEFAULT_NODE_GRAPH_SETTINGS.kinds }
  const storedKinds = (raw.kinds ?? {}) as Partial<Record<string, unknown>>
  for (const kind of USER_TOGGLEABLE_NODE_KINDS) {
    if (typeof storedKinds[kind] === 'boolean') kinds[kind] = storedKinds[kind] as boolean
  }
  return {
    search: typeof raw.search === 'string' ? raw.search.slice(0, 200) : '',
    kinds,
    minDegree: Math.round(clampNumber(raw.minDegree, 'minDegree')),
    showOrphans: raw.showOrphans !== false,
    includeChangedFiles: raw.includeChangedFiles !== false,
    groups: normalizeGroups(raw.groups),
    showArrows: raw.showArrows !== false,
    showEdgeLabels: raw.showEdgeLabels !== false,
    showMinimap: raw.showMinimap !== false,
    textFadeThreshold: clampNumber(raw.textFadeThreshold, 'textFadeThreshold'),
    nodeSize: clampNumber(raw.nodeSize, 'nodeSize'),
    linkThickness: clampNumber(raw.linkThickness, 'linkThickness'),
    centerForce: clampNumber(raw.centerForce, 'centerForce'),
    repelForce: clampNumber(raw.repelForce, 'repelForce'),
    linkForce: clampNumber(raw.linkForce, 'linkForce'),
    linkDistance: clampNumber(raw.linkDistance, 'linkDistance'),
    localDepth: Math.round(clampNumber(raw.localDepth, 'localDepth'))
  }
}

export function readStoredNodeGraphSettings(): NodeGraphSettings {
  const stored = readBrowserStorageItem(NODE_GRAPH_SETTINGS_KEY)
  if (!stored) return { ...DEFAULT_NODE_GRAPH_SETTINGS }
  try {
    return normalizeNodeGraphSettings(JSON.parse(stored))
  } catch {
    return { ...DEFAULT_NODE_GRAPH_SETTINGS }
  }
}

export function writeStoredNodeGraphSettings(settings: NodeGraphSettings): void {
  // `search` is a transient lens, not a preference; persisting it would make
  // the graph open empty after a session that ended mid-search.
  writeBrowserStorageItem(
    NODE_GRAPH_SETTINGS_KEY,
    JSON.stringify({ ...settings, search: '' })
  )
}

/** First palette colour no group is using yet, so new groups stay legible. */
export function nextGroupColor(groups: readonly NodeGraphGroup[]): string {
  const used = new Set(groups.map((group) => group.color.toLowerCase()))
  const unused = NODE_GRAPH_GROUP_COLORS.find((color) => !used.has(color))
  return unused ?? NODE_GRAPH_GROUP_COLORS[groups.length % NODE_GRAPH_GROUP_COLORS.length]!
}

/** The group a node is explicitly assigned to, if any. */
export function groupForNode(
  groups: readonly NodeGraphGroup[],
  nodeId: string
): NodeGraphGroup | null {
  return groups.find((group) => group.nodeIds.includes(nodeId)) ?? null
}
