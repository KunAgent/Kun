import { useSyncExternalStore } from 'react'
import { readFocusModePreference } from '../lib/focus-mode'
import type { NodeGraphNodeKind } from './node-graph-types'

/**
 * Kun style: illustrated mascot icons in place of coloured silhouettes.
 *
 * It is not a switch of its own. Focus mode is the shell's stripped-back state —
 * the mascot leaves the sidebar the moment it turns on — so the graph follows
 * the same signal: Focus off means the illustrated nodes are on and the colour
 * controls stand down, Focus on means plain colour-and-shape encoding returns.
 * One switch, one meaning, in both places.
 */

/** Kinds with a mascot icon. Every other kind keeps its silhouette either way. */
export const KUN_NODE_STYLE_KINDS = ['workspace', 'thread', 'folder', 'document'] as const

export type KunStyledNodeKind = (typeof KUN_NODE_STYLE_KINDS)[number]

const STYLED_KINDS: ReadonlySet<string> = new Set(KUN_NODE_STYLE_KINDS)

export function isKunStyledNodeKind(kind: NodeGraphNodeKind): kind is KunStyledNodeKind {
  return STYLED_KINDS.has(kind)
}

/** Attribute the workbench mirrors focus mode onto, on `<html>`. */
export const FOCUS_MODE_ATTRIBUTE = 'data-focus-mode'

/**
 * The attribute is the live value, but it is absent until the workbench's effect
 * first runs — and the graph can paint before that — so the stored preference is
 * the fallback rather than a guess at the default.
 */
export function kunNodeStyleFromFocusMode(attribute: string | null, preference: boolean): boolean {
  if (attribute === 'on') return false
  if (attribute === 'off') return true
  return !preference
}

export function readKunNodeStyle(): boolean {
  if (typeof document === 'undefined') return true
  return kunNodeStyleFromFocusMode(
    document.documentElement.getAttribute(FOCUS_MODE_ATTRIBUTE),
    readFocusModePreference()
  )
}

const listeners = new Set<() => void>()
let observer: MutationObserver | null = null

/**
 * One observer for every consumer.
 *
 * A legend row, an insights row and an inspector row each render a glyph, so a
 * per-hook observer would mean a dozen of them watching the same attribute.
 */
function subscribeKunNodeStyle(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => {
      for (const listener of listeners) listener()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [FOCUS_MODE_ATTRIBUTE]
    })
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      observer?.disconnect()
      observer = null
    }
  }
}

/** True while the graph should paint Kun icons and hide the colour controls. */
export function useKunNodeStyle(): boolean {
  return useSyncExternalStore(subscribeKunNodeStyle, readKunNodeStyle, readKunNodeStyle)
}
