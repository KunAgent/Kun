import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useCanvasShapeStore } from '../../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../../design/canvas/canvas-undo-store'
import { filterEditableShapeIds } from '../../../../design/canvas/canvas-editability'
import type { Arrowhead, CanvasShape, StrokeDash } from '../../../../design/canvas/canvas-types'

export const MIXED = '__mixed__'

// Deliberate 5-color palette, excalidraw style. No rainbow.
const SWATCHES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']

export function reduceField<T>(shapes: CanvasShape[], getter: (s: CanvasShape) => T): T | typeof MIXED | undefined {
  if (shapes.length === 0) return undefined
  const first = getter(shapes[0])
  for (let i = 1; i < shapes.length; i++) {
    if (getter(shapes[i]) !== first) return MIXED
  }
  return first
}

export function commitUpdate(label: string, ids: string[], patch: Partial<CanvasShape>): void {
  const document = useCanvasShapeStore.getState().document
  const editableIds = filterEditableShapeIds(document, ids)
  if (editableIds.length === 0) return
  useCanvasUndoStore.getState().withGroup(label, () => {
    const store = useCanvasShapeStore.getState()
    for (const id of editableIds) {
      store.updateShape(id, patch)
    }
  })
}

// ────────────────────────────────────────────────────────────────────────────
// Atoms
// ────────────────────────────────────────────────────────────────────────────

export function Section({
  title,
  action,
  children
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="space-y-2">
      {title || action ? (
        <div className="flex h-4 items-center justify-between">
          {title ? (
            <h3 className="select-none text-[10px] font-medium uppercase tracking-[0.08em] text-ds-faint">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {action ?? null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function NumberBox({
  icon,
  value,
  onCommit,
  step = 1,
  min
}: {
  icon: string
  value: number | typeof MIXED | undefined
  onCommit: (n: number) => void
  step?: number
  min?: number
}): ReactElement {
  const display =
    value === MIXED ? '' : value === undefined ? '' : String(Math.round((value as number) * 100) / 100)
  const [draft, setDraft] = useState(display)
  useEffect(() => setDraft(display), [display])
  const commit = (): void => {
    const next = parseFloat(draft)
    if (Number.isFinite(next)) onCommit(next)
    else setDraft(display)
  }
  return (
    <label className="group flex h-7 min-w-0 items-center gap-1 rounded-[8px] bg-transparent px-1.5 transition hover:bg-ds-hover/60 focus-within:bg-ds-hover/70">
      <span className="w-3 shrink-0 text-center text-[10px] font-medium text-ds-faint group-focus-within:text-ds-muted">
        {icon}
      </span>
      <input
        type="number"
        step={step}
        {...(min !== undefined ? { min } : {})}
        value={draft}
        placeholder={value === MIXED ? '—' : '0'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(display)
            event.currentTarget.blur()
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[11.5px] tabular-nums text-ds-ink outline-none placeholder:text-ds-faint"
      />
    </label>
  )
}

export function Seg<T extends string | number>({
  value,
  options,
  onPick
}: {
  value: T | typeof MIXED | undefined
  options: { value: T; render: ReactNode; label: string }[]
  onPick: (v: T) => void
}): ReactElement {
  return (
    <div className="flex items-center gap-0.5 rounded-[10px] bg-ds-hover/35 p-0.5 dark:bg-white/5">
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onPick(o.value)}
            title={o.label}
            aria-label={o.label}
            className={`flex h-7 flex-1 items-center justify-center rounded-[8px] transition ${
              active
                ? 'bg-white text-ds-ink shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-white/12 dark:text-ds-ink'
                : 'text-ds-muted hover:text-ds-ink'
            }`}
          >
            {o.render}
          </button>
        )
      })}
    </div>
  )
}

export function Swatches({
  value,
  onPick,
  showClear,
  onClear
}: {
  value: string | typeof MIXED | undefined
  onPick: (c: string) => void
  showClear?: boolean
  onClear?: () => void
}): ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      {SWATCHES.map((c) => {
        const active = value === c
        return (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            title={c}
            aria-label={c}
            className={`relative h-5 w-5 shrink-0 rounded-[6px] transition ${
              active
                ? 'shadow-[0_0_0_2px_white,0_0_0_3px_var(--accent,#5b6dd1)] dark:shadow-[0_0_0_2px_var(--ds-canvas,#0f1116),0_0_0_3px_var(--accent,#7c8bf5)]'
                : 'shadow-[inset_0_0_0_1px_rgba(15,23,42,0.14)] hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.28)]'
            }`}
            style={{ background: c }}
          />
        )
      })}
      {showClear && onClear ? (
        <button
          type="button"
          onClick={onClear}
          title="无"
          aria-label="无"
          className="relative h-5 w-5 shrink-0 overflow-hidden rounded-[6px] bg-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.14)] hover:shadow-[inset_0_0_0_1px_rgba(15,23,42,0.28)] dark:bg-ds-card"
        >
          <svg viewBox="0 0 20 20" className="absolute inset-0">
            <line x1="3.5" y1="16.5" x2="16.5" y2="3.5" stroke="#e03131" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}

export function HexInput({
  value,
  onCommit
}: {
  value: string | typeof MIXED | undefined
  onCommit: (c: string) => void
}): ReactElement {
  const [local, setLocal] = useState<string | null>(null)
  const display = local ?? (value === MIXED ? '' : (value as string) ?? '')
  const placeholder = value === MIXED ? '—' : '#000000'
  return (
    <input
      type="text"
      value={display}
      spellCheck={false}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={(e) => {
        setLocal(null)
        const v = e.target.value.trim()
        if (v && /^#?[0-9a-fA-F]{3,8}$/.test(v)) {
          onCommit(v.startsWith('#') ? v : `#${v}`)
        }
      }}
      placeholder={placeholder}
      className="h-7 w-full rounded-[8px] bg-transparent px-2 text-[11px] font-mono lowercase text-ds-muted outline-none transition hover:bg-ds-hover/60 focus:bg-ds-hover/70 placeholder:text-ds-faint"
    />
  )
}

export function OpacitySlider({
  value,
  onChange
}: {
  value: number | typeof MIXED | undefined
  onChange: (n: number) => void
}): ReactElement {
  const mixed = value === MIXED
  const num = mixed || value === undefined ? 100 : Math.round((value as number) * 100)
  const [draft, setDraft] = useState<number | null>(null)
  useEffect(() => setDraft(null), [num])
  const displayed = draft ?? num
  const commit = (candidate: number): void => {
    const bounded = Math.max(0, Math.min(100, candidate))
    setDraft(null)
    onChange(bounded / 100)
  }
  return (
    <div className="space-y-0.5">
      <input
        type="range"
        min={0}
        max={100}
        value={displayed}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
            commit(Number(e.currentTarget.value))
          }
        }}
        onBlur={(e) => {
          if (draft !== null) commit(Number(e.currentTarget.value))
        }}
        className="canvas-inspector-range w-full"
      />
      <div className="flex items-center justify-between text-[10px] tabular-nums text-ds-faint">
        <span>0</span>
        <span className={mixed ? '' : 'text-ds-muted'}>{mixed ? '—' : `${displayed}`}</span>
        <span>100</span>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SVG icon sets
// ────────────────────────────────────────────────────────────────────────────

function Line({
  strokeWidth,
  dash
}: {
  strokeWidth: number
  dash?: string
}): ReactElement {
  return (
    <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
      <line
        x1="3"
        y1="5"
        x2="21"
        y2="5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        {...(dash ? { strokeDasharray: dash } : {})}
      />
    </svg>
  )
}

export const WIDTH_OPTIONS: { value: number; label: string; render: ReactNode }[] = [
  { value: 1, label: 'Thin', render: <Line strokeWidth={1.25} /> },
  { value: 2, label: 'Medium', render: <Line strokeWidth={2.25} /> },
  { value: 4, label: 'Bold', render: <Line strokeWidth={3.5} /> }
]

export const DASH_OPTIONS: { value: StrokeDash; label: string; render: ReactNode }[] = [
  { value: 'solid', label: 'Solid', render: <Line strokeWidth={1.75} /> },
  { value: 'dashed', label: 'Dashed', render: <Line strokeWidth={1.75} dash="3.5 3" /> },
  { value: 'dotted', label: 'Dotted', render: <Line strokeWidth={1.75} dash="0.5 3" /> }
]

function arrowheadIcon(style: Arrowhead, flip: boolean): ReactElement {
  // 24x10 viewBox. Stem horizontal y=5; decoration at one end. `flip` swaps the
  // decoration side so the start picker mirrors the end picker visually.
  const tipX = flip ? 3 : 21
  const stemFrom = flip ? 6 : 3
  const stemTo = flip ? 21 : 18
  const inward = flip ? 1 : -1
  const stem = (
    <line
      x1={stemFrom}
      y1="5"
      x2={stemTo}
      y2="5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  )
  switch (style) {
    case 'none':
      return (
        <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
          <line x1="3" y1="5" x2="21" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )
    case 'arrow':
      return (
        <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
          {stem}
          <path
            d={`M ${tipX + inward * 4} 1.8 L ${tipX} 5 L ${tipX + inward * 4} 8.2`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'triangle':
      return (
        <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
          {stem}
          <path
            d={`M ${tipX} 5 L ${tipX + inward * 5} 1.5 L ${tipX + inward * 5} 8.5 Z`}
            fill="currentColor"
          />
        </svg>
      )
    case 'circle':
      return (
        <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
          {stem}
          <circle cx={tipX} cy="5" r="2.4" fill="currentColor" />
        </svg>
      )
    case 'bar':
      return (
        <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
          {stem}
          <line x1={tipX} y1="1.5" x2={tipX} y2="8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'diamond':
      return (
        <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
          {stem}
          <path
            d={`M ${tipX} 5 L ${tipX + inward * 3} 2.2 L ${tipX + inward * 6} 5 L ${tipX + inward * 3} 7.8 Z`}
            fill="currentColor"
          />
        </svg>
      )
  }
}

export function arrowheadOptions(flip: boolean): { value: Arrowhead; label: string; render: ReactNode }[] {
  const styles: Arrowhead[] = ['none', 'arrow', 'triangle', 'circle', 'bar', 'diamond']
  return styles.map((s) => ({ value: s, label: s, render: arrowheadIcon(s, flip) }))
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────
