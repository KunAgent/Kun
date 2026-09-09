import type { NodeGraphNodeKind } from '../../node-graph/node-graph-types'

/**
 * Per-kind node colors. Chosen to stay distinguishable on both the light and
 * dark shell backgrounds, so the canvas does not need two palettes.
 */
export const NODE_GRAPH_KIND_COLORS: Record<NodeGraphNodeKind, string> = {
  workspace: '#a855f7',
  thread: '#3b82f6',
  agent: '#f59e0b',
  knowledgeBase: '#14b8a6',
  folder: '#94a3b8',
  document: '#38bdf8',
  section: '#22c55e',
  memory: '#f97316',
  tag: '#ec4899',
  file: '#94a3b8'
}

/**
 * Per-kind silhouette.
 *
 * Colour alone fails the people who cannot separate the hues, and it fails
 * everyone once a graph holds nine kinds — so kind is encoded twice, in hue and
 * in outline, and either one alone is enough to read the graph.
 */
export type NodeGraphShape =
  | 'hexagon'
  | 'roundedSquare'
  | 'circle'
  | 'cylinder'
  | 'document'
  | 'star'
  | 'diamond'

export const NODE_GRAPH_KIND_SHAPES: Record<NodeGraphNodeKind, NodeGraphShape> = {
  workspace: 'hexagon',
  thread: 'roundedSquare',
  agent: 'circle',
  knowledgeBase: 'cylinder',
  folder: 'hexagon',
  document: 'document',
  section: 'circle',
  memory: 'star',
  tag: 'diamond',
  file: 'document'
}

/** Human-readable kind name used in canvas labels and the legend. */
export const NODE_GRAPH_KIND_LABEL_KEYS: Record<NodeGraphNodeKind, string> = {
  workspace: 'nodeGraphKindWorkspaceOne',
  thread: 'nodeGraphKindThreadOne',
  agent: 'nodeGraphKindAgentOne',
  knowledgeBase: 'nodeGraphKindKnowledgeBaseOne',
  folder: 'nodeGraphKindFolderOne',
  document: 'nodeGraphKindDocumentOne',
  section: 'nodeGraphKindSectionOne',
  memory: 'nodeGraphKindMemoryOne',
  tag: 'nodeGraphKindTagOne',
  file: 'nodeGraphKindFileOne'
}

export type NodeGraphCanvasTheme = {
  background: string
  link: string
  linkStrong: string
  text: string
  textMuted: string
  /** Third text level, for the kind line above a node's name. */
  textFaint: string
  accent: string
  ring: string
}

const FALLBACK_THEME: NodeGraphCanvasTheme = {
  background: '#0b0d12',
  link: 'rgba(148, 163, 184, 0.28)',
  linkStrong: 'rgba(148, 163, 184, 0.85)',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textFaint: '#64748b',
  accent: '#6366f1',
  ring: '#f8fafc'
}

function cssVariable(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim()
  return value || fallback
}

/**
 * Resolves the shell's design tokens so the canvas repaints correctly after a
 * theme switch. Canvas pixels cannot inherit CSS, so the values are read once
 * per theme change and passed into the painter.
 */
export function readNodeGraphCanvasTheme(): NodeGraphCanvasTheme {
  if (typeof window === 'undefined' || typeof document === 'undefined') return FALLBACK_THEME
  const style = window.getComputedStyle(document.documentElement)
  const text = cssVariable(style, '--ds-text', FALLBACK_THEME.text)
  return {
    background: cssVariable(style, '--ds-bg-main', FALLBACK_THEME.background),
    link: FALLBACK_THEME.link,
    linkStrong: FALLBACK_THEME.linkStrong,
    text,
    textMuted: cssVariable(style, '--ds-text-muted', FALLBACK_THEME.textMuted),
    textFaint: cssVariable(style, '--ds-text-faint', FALLBACK_THEME.textFaint),
    accent: cssVariable(style, '--ds-accent', FALLBACK_THEME.accent),
    ring: text
  }
}

/**
 * Node radius grows with the square root of degree, the same damping Obsidian
 * uses so a single hub does not swallow the canvas.
 */
export function nodeGraphRadius(degree: number, nodeSize: number): number {
  return (3.4 + Math.sqrt(degree) * 1.9) * nodeSize
}
