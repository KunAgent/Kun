/**
 * Fixed 10-color identity palette (docs/ade/12 §2): answers only "who",
 * never "how" — status keeps its own tokens. Mid-saturation hexes legible
 * on both light and dark surfaces; red is omitted (destructive-only) and
 * green is omitted (diff-add background).
 */
export const IDENTITY_COLORS = [
  '#3b82d8',
  '#8b5cf6',
  '#d946ef',
  '#f59e0b',
  '#14b8a6',
  '#0ea5e9',
  '#6366f1',
  '#f97316',
  '#84a816',
  '#a855f7'
] as const

/** Stable key → palette index (same unit always renders the same color). */
export function identityColor(key: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return IDENTITY_COLORS[(hash >>> 0) % IDENTITY_COLORS.length]!
}
