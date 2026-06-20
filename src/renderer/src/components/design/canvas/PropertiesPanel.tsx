import { memo, useCallback, useMemo, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import { DEFAULT_FILL, type CanvasShape, type Fill, type Stroke } from '../../../design/canvas/canvas-types'

const MIXED = '__mixed__'

function reduceField<T>(shapes: CanvasShape[], getter: (s: CanvasShape) => T): T | typeof MIXED | undefined {
  if (shapes.length === 0) return undefined
  const first = getter(shapes[0])
  for (let i = 1; i < shapes.length; i++) {
    if (getter(shapes[i]) !== first) return MIXED
  }
  return first
}

function commitUpdate(label: string, ids: string[], patch: Partial<CanvasShape>): void {
  if (ids.length === 0) return
  useCanvasUndoStore.getState().withGroup(label, () => {
    const store = useCanvasShapeStore.getState()
    for (const id of ids) {
      store.updateShape(id, patch)
    }
  })
}

function NumberRow({
  label,
  value,
  onCommit,
  step = 1
}: {
  label: string
  value: number | typeof MIXED | undefined
  onCommit: (n: number) => void
  step?: number
}): ReactElement {
  const display = value === MIXED ? '' : value === undefined ? '' : String(Math.round(value * 100) / 100)
  const placeholder = value === MIXED ? '—' : ''
  return (
    <label className="flex items-center gap-1.5 text-[11.5px]">
      <span className="w-6 shrink-0 text-[#8b95a3] dark:text-white/45">{label}</span>
      <input
        type="number"
        step={step}
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          const n = parseFloat(e.target.value)
          if (!Number.isFinite(n)) return
          onCommit(n)
        }}
        className="w-full min-w-0 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-1.5 py-0.5 text-[11.5px] text-[#1f2733] outline-none focus:border-[#3b82d8] dark:text-white/90"
      />
    </label>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="space-y-2 border-b border-[var(--ds-sidebar-row-ring)] px-3 py-3 last:border-b-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8b95a3] dark:text-white/40">
        {title}
      </div>
      {children}
    </section>
  )
}

function PropertiesPanelInner(): ReactElement | null {
  const { t } = useTranslation('common')
  const selectedIds = useCanvasSelectionStore((s) => s.selectedIds)
  const document = useCanvasShapeStore((s) => s.document)

  const ids = useMemo(() => Array.from(selectedIds), [selectedIds])
  const shapes = useMemo(
    () => ids.map((id) => document.objects[id]).filter((s): s is CanvasShape => Boolean(s)),
    [ids, document]
  )

  const updateAll = useCallback(
    (label: string, patch: Partial<CanvasShape>) => commitUpdate(label, ids, patch),
    [ids]
  )

  if (shapes.length === 0) return null

  const x = reduceField(shapes, (s) => s.x)
  const y = reduceField(shapes, (s) => s.y)
  const w = reduceField(shapes, (s) => s.width)
  const h = reduceField(shapes, (s) => s.height)
  const rot = reduceField(shapes, (s) => s.rotation || 0)
  const opacity = reduceField(shapes, (s) => s.opacity)
  const cornerR = reduceField(shapes, (s) => (typeof s.cornerRadius === 'number' ? s.cornerRadius : s.cornerRadius[0]))

  const firstFill: Fill | undefined = shapes[0]?.fills[0]
  const fillColor = reduceField(shapes, (s) => s.fills[0]?.color ?? '')
  const fillOpacity = reduceField(shapes, (s) => s.fills[0]?.opacity ?? 1)

  const firstStroke: Stroke | undefined = shapes[0]?.strokes[0]
  const strokeColor = reduceField(shapes, (s) => s.strokes[0]?.color ?? '')
  const strokeWidth = reduceField(shapes, (s) => s.strokes[0]?.width ?? 0)

  const allText = shapes.every((s) => s.type === 'text')
  const fontSize = allText ? reduceField(shapes, (s) => s.fontSize ?? 16) : undefined
  const fontFamily = allText ? reduceField(shapes, (s) => s.fontFamily ?? '') : undefined
  const fontWeight = allText ? reduceField(shapes, (s) => s.fontWeight ?? 400) : undefined
  const fontColor = allText ? reduceField(shapes, (s) => s.fontColor ?? '#000') : undefined

  return (
    <div className="ds-no-drag flex h-full w-[260px] shrink-0 flex-col overflow-y-auto border-l border-[var(--ds-sidebar-row-ring)] bg-white text-[12px] dark:bg-[#1f242c]">
      <div className="shrink-0 px-3 py-2 text-[11px] font-medium text-[#8b95a3] shadow-[inset_0_-1px_0_var(--ds-sidebar-row-ring)] dark:text-white/45">
        {t('canvasInspectorTitle', 'Properties')}
        {shapes.length > 1 ? <span className="ml-1 text-[#9aa4b2]">×{shapes.length}</span> : null}
      </div>

      <Section title={t('canvasInspectorPosition', 'Position & size')}>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberRow label="X" value={x} onCommit={(n) => updateAll('set-x', { x: n })} />
          <NumberRow label="Y" value={y} onCommit={(n) => updateAll('set-y', { y: n })} />
          <NumberRow label="W" value={w} onCommit={(n) => updateAll('set-w', { width: Math.max(1, n) })} />
          <NumberRow label="H" value={h} onCommit={(n) => updateAll('set-h', { height: Math.max(1, n) })} />
        </div>
        <NumberRow
          label="↻"
          value={rot}
          step={1}
          onCommit={(n) => updateAll('set-rotation', { rotation: ((n % 360) + 360) % 360 })}
        />
      </Section>

      {shapes.some((s) => s.type !== 'group') && (
        <Section title={t('canvasInspectorFill', 'Fill')}>
          {firstFill ? (
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={fillColor === MIXED || !fillColor ? '#000000' : (fillColor as string)}
                onChange={(e) =>
                  updateAll('set-fill-color', {
                    fills: [{ type: 'solid', color: e.target.value, opacity: firstFill.opacity }]
                  })
                }
                className="h-6 w-8 cursor-pointer rounded border border-[var(--ds-sidebar-row-ring)]"
              />
              <input
                type="text"
                value={fillColor === MIXED ? '' : (fillColor as string) ?? ''}
                placeholder={fillColor === MIXED ? '—' : '#000000'}
                onChange={(e) =>
                  updateAll('set-fill-color', {
                    fills: [{ type: 'solid', color: e.target.value, opacity: firstFill.opacity }]
                  })
                }
                className="min-w-0 flex-1 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none focus:border-[#3b82d8] dark:text-white/90"
              />
              <input
                type="number"
                min={0}
                max={100}
                value={fillOpacity === MIXED || fillOpacity === undefined ? '' : Math.round((fillOpacity as number) * 100)}
                placeholder={fillOpacity === MIXED ? '—' : ''}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value)
                  if (!Number.isFinite(pct)) return
                  updateAll('set-fill-opacity', {
                    fills: [{ type: 'solid', color: firstFill.color, opacity: Math.max(0, Math.min(1, pct / 100)) }]
                  })
                }}
                className="w-12 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-1 py-0.5 text-[11.5px] outline-none focus:border-[#3b82d8] dark:text-white/90"
              />
              <button
                type="button"
                onClick={() => updateAll('clear-fill', { fills: [] })}
                className="text-[#8b95a3] hover:text-[#c0392b]"
                title={t('canvasInspectorRemoveFill', 'Remove fill')}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => updateAll('add-fill', { fills: [{ ...DEFAULT_FILL }] })}
              className="w-full rounded-md border border-dashed border-[var(--ds-sidebar-row-ring)] py-1 text-[11px] text-[#8b95a3] hover:bg-black/[0.03] dark:hover:bg-white/5"
            >
              + {t('canvasInspectorAddFill', 'Add fill')}
            </button>
          )}
        </Section>
      )}

      <Section title={t('canvasInspectorStroke', 'Stroke')}>
        {firstStroke ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={strokeColor === MIXED || !strokeColor ? '#000000' : (strokeColor as string)}
                onChange={(e) =>
                  updateAll('set-stroke-color', {
                    strokes: [{ ...firstStroke, color: e.target.value }]
                  })
                }
                className="h-6 w-8 cursor-pointer rounded border border-[var(--ds-sidebar-row-ring)]"
              />
              <input
                type="text"
                value={strokeColor === MIXED ? '' : (strokeColor as string) ?? ''}
                onChange={(e) =>
                  updateAll('set-stroke-color', {
                    strokes: [{ ...firstStroke, color: e.target.value }]
                  })
                }
                className="min-w-0 flex-1 rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none focus:border-[#3b82d8] dark:text-white/90"
              />
              <button
                type="button"
                onClick={() => updateAll('clear-stroke', { strokes: [] })}
                className="text-[#8b95a3] hover:text-[#c0392b]"
                title={t('canvasInspectorRemoveStroke', 'Remove stroke')}
              >
                ×
              </button>
            </div>
            <NumberRow
              label="W"
              value={strokeWidth}
              step={0.5}
              onCommit={(n) =>
                updateAll('set-stroke-width', { strokes: [{ ...firstStroke, width: Math.max(0, n) }] })
              }
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              updateAll('add-stroke', {
                strokes: [{ color: '#000000', width: 1, opacity: 1, position: 'center' }]
              })
            }
            className="w-full rounded-md border border-dashed border-[var(--ds-sidebar-row-ring)] py-1 text-[11px] text-[#8b95a3] hover:bg-black/[0.03] dark:hover:bg-white/5"
          >
            + {t('canvasInspectorAddStroke', 'Add stroke')}
          </button>
        )}
      </Section>

      <Section title={t('canvasInspectorCorner', 'Corner radius')}>
        <NumberRow
          label="R"
          value={cornerR}
          step={1}
          onCommit={(n) => updateAll('set-corner-radius', { cornerRadius: Math.max(0, n) })}
        />
      </Section>

      <Section title={t('canvasInspectorOpacity', 'Opacity')}>
        <NumberRow
          label="%"
          value={opacity === MIXED || opacity === undefined ? opacity : Math.round((opacity as number) * 100)}
          step={1}
          onCommit={(n) => updateAll('set-opacity', { opacity: Math.max(0, Math.min(1, n / 100)) })}
        />
      </Section>

      {allText && (
        <Section title={t('canvasInspectorText', 'Text')}>
          <div className="space-y-1.5">
            <NumberRow
              label="Sz"
              value={fontSize}
              onCommit={(n) => updateAll('set-font-size', { fontSize: Math.max(1, n) })}
            />
            <NumberRow
              label="Wt"
              value={fontWeight}
              step={100}
              onCommit={(n) => updateAll('set-font-weight', { fontWeight: Math.max(100, Math.min(900, n)) })}
            />
            <input
              type="text"
              value={fontFamily === MIXED ? '' : (fontFamily as string) ?? ''}
              placeholder={fontFamily === MIXED ? '—' : 'font-family'}
              onChange={(e) => updateAll('set-font-family', { fontFamily: e.target.value })}
              className="w-full rounded-md border border-[var(--ds-sidebar-row-ring)] bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none focus:border-[#3b82d8] dark:text-white/90"
            />
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={fontColor === MIXED || !fontColor ? '#000000' : (fontColor as string)}
                onChange={(e) => updateAll('set-font-color', { fontColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-[var(--ds-sidebar-row-ring)]"
              />
              <span className="text-[11px] text-[#8b95a3]">{t('canvasInspectorTextColor', 'Color')}</span>
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}

export const PropertiesPanel = memo(PropertiesPanelInner)
