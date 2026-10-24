import type { ReactNode } from 'react'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'

/**
 * Contract between the composer activity tray and the kinds it hosts.
 *
 * Each kind module exports one hook, `use<Kind>TrayKind(context)`, that
 * ComposerTrayHost calls unconditionally on every render with the whole
 * composer render context. The hook owns its data subscription / polling
 * exactly once and returns either `null` (nothing to show: the segment
 * disappears) or a `TrayKind` describing its segment and optional sheet.
 *
 * Render cost: every state change in a kind hook re-renders the tray host
 * (not the composer around it, but every kind and the queue). So:
 * - Clocks never live in the hook. A ticking label belongs inside the
 *   segment / sheet component that shows it (TrayElapsedLabel, or
 *   `useTrayNow(active)` inside that component), so only it re-renders.
 * - Polling sets state only when the derived data changed (compare ids,
 *   statuses, counts; keep the previous array when equal). An idle poll
 *   that returns the same empty list must not re-render anything.
 * - Store selectors return stable values (primitives, or memoized /
 *   shallow-compared slices), never a fresh array or object per call.
 *
 * The container owns the segment `<button>` (click, `aria-expanded`,
 * `aria-controls`, compact tooltip, open styling) and the sheet frame
 * (`<section>`, close on Esc / outside click / composer menu). A kind only
 * renders the segment's inner content and the sheet's inner content, so it
 * never nests a button inside the segment button.
 *
 * `renderSegment` / `renderSheet` are called during the container's render
 * and only while visible, so they must not call hooks themselves: return an
 * element of a component that owns its hooks instead
 * (`renderSheet: ({ close }) => <TodoSheet todos={todos} onClose={close} />`).
 */

/** Stable kind ids, also the default `data-composer-stack-item` marker. */
export type TrayKindId = 'graph' | 'todo' | 'workers' | 'dispatch' | 'shells' | 'goal'

/**
 * Visual tone of a segment / status pill.
 * - default: neutral
 * - running: live work (accent)
 * - waiting: needs the user (warning)
 * - error: failed (danger)
 * - done: finished (success)
 */
export type TrayTone = 'default' | 'running' | 'waiting' | 'error' | 'done'

/** `end` segments are pushed to the trailing edge of the bar (Goal). */
export type TrayAlign = 'start' | 'end'

export type TraySegmentRenderArgs = {
  /** The kind's sheet is currently open (the segment is drawn as a raised chip). */
  open: boolean
  /** Side conversation / narrow composer: render icon + count only. */
  compact: boolean
}

export type TraySheetRenderArgs = {
  /** Close the sheet (for a header collapse button or after an action). */
  close: () => void
  compact: boolean
}

export type TrayKind = {
  id: TrayKindId
  align: TrayAlign
  tone: TrayTone
  /**
   * Accessible name of the segment button. In compact mode it is also the
   * hover tooltip (`title`), because the visible label is hidden there.
   */
  ariaLabel: string
  /** Optional tooltip in the regular (non-compact) bar. */
  title?: string
  /** Inner content of the segment chip (icon, label, count). No buttons. */
  renderSegment: (args: TraySegmentRenderArgs) => ReactNode
  /**
   * Inner content of the expanded sheet, or `null` for a non-expandable
   * segment. Returning `null` from the function at render time is treated as
   * "nothing to show" and closes the sheet.
   */
  renderSheet: ((args: TraySheetRenderArgs) => ReactNode) | null
  /** Click handler for non-expandable segments (renderSheet === null). */
  onActivate?: () => void
  /** Value for `data-composer-stack-item` (defaults to `id`). Smoke tests use it. */
  marker?: string
  /**
   * Extra `data-*` attributes spread on the segment `<button>` (for markers
   * tests and smoke scripts read, e.g. `data-todo-plan-outline`).
   */
  segmentAttributes?: Record<`data-${string}`, string | number | undefined>
}

/** Every kind hook has this signature. */
export type TrayKindHook = (context: FloatingComposerRenderContext) => TrayKind | null

/** Canonical bar order; `end`-aligned kinds still keep this relative order. */
export const TRAY_KIND_ORDER: readonly TrayKindId[] = [
  'graph',
  'todo',
  'workers',
  'dispatch',
  'shells',
  'goal'
]

/**
 * Normalizes the hook results into bar order: drops `null`, hides Dispatch
 * whenever Workers is present (the Workers sheet lists dispatchable agents
 * itself), and sorts start-aligned kinds before end-aligned kinds, each group
 * in `TRAY_KIND_ORDER`.
 */
export function resolveTrayKinds(kinds: ReadonlyArray<TrayKind | null | undefined>): TrayKind[] {
  const present = kinds.filter((kind): kind is TrayKind => Boolean(kind))
  const hasWorkers = present.some((kind) => kind.id === 'workers')
  const visible = hasWorkers ? present.filter((kind) => kind.id !== 'dispatch') : present
  const rank = (kind: TrayKind): number => {
    const index = TRAY_KIND_ORDER.indexOf(kind.id)
    return (kind.align === 'end' ? TRAY_KIND_ORDER.length : 0) + (index < 0 ? TRAY_KIND_ORDER.length - 1 : index)
  }
  return [...visible].sort((left, right) => rank(left) - rank(right))
}
