import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type {
  AnnotationStylePatch,
  DrawingAnnotationTool
} from './image-annotation-model'
import { ANNOTATION_SWATCHES } from './image-annotation-model'

type Props = {
  target: DrawingAnnotationTool | null
  style: AnnotationStylePatch
  selected: boolean
  disabled?: boolean
  onChange: (patch: AnnotationStylePatch) => void
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-white/50">{label}</div>
      {children}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  suffix,
  disabled,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  disabled?: boolean
  onCommit: (value: number) => void
}): ReactElement {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = (): void => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const next = Math.min(Math.max(parsed, min), max)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }
  return (
    <label className="flex h-8 items-center rounded-lg border border-white/15 bg-black/15 px-2">
      <span className="min-w-0 flex-1 text-[11px] text-white/65">{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(String(value))
            event.currentTarget.blur()
          }
        }}
        className="w-12 bg-transparent text-right text-[11px] tabular-nums text-white outline-none"
      />
      <span className="ml-1 text-[10px] text-white/40">{suffix}</span>
    </label>
  )
}

function Segmented<T extends string | number>({
  value,
  options,
  disabled,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  disabled?: boolean
  onChange: (value: T) => void
}): ReactElement {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/15 p-1">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-1.5 py-1.5 text-[10px] transition ${
            value === option.value ? 'bg-white text-black' : 'text-white/65 hover:bg-white/10 hover:text-white'
          } disabled:opacity-45`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function ImageAnnotationStylePanel({
  target,
  style,
  selected,
  disabled = false,
  onChange
}: Props): ReactElement {
  if (!target) {
    return (
      <div data-testid="image-annotation-style-panel" className="w-52 rounded-2xl border border-white/15 bg-[#17191d]/95 p-3 text-[11px] leading-5 text-white/55 shadow-2xl backdrop-blur-xl">
        选择一个标注后可调整样式
      </div>
    )
  }
  const isText = target === 'text'
  return (
    <div data-testid="image-annotation-style-panel" className="w-52 space-y-3 rounded-2xl border border-white/15 bg-[#17191d]/95 p-3 text-white shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold">{selected ? '所选标注' : '绘制样式'}</span>
        <span className="text-[10px] text-white/45">{target === 'rect' ? '方框' : target === 'arrow' ? '箭头' : target === 'pen' ? '画笔' : '文字'}</span>
      </div>

      <Field label="颜色">
        <div className="flex flex-wrap gap-1.5">
          {ANNOTATION_SWATCHES.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              disabled={disabled}
              title={swatch.name}
              aria-label={swatch.name}
              aria-pressed={style.color === swatch.value}
              onClick={() => onChange({ color: swatch.value })}
              className={`h-6 w-6 rounded-md border transition ${
                style.color === swatch.value ? 'scale-110 border-white ring-2 ring-white/45' : 'border-white/25'
              } disabled:opacity-45`}
              style={{ background: swatch.value }}
            />
          ))}
        </div>
      </Field>

      <NumberField
        label="透明度"
        value={Math.round((style.opacity ?? 1) * 100)}
        min={10}
        max={100}
        suffix="%"
        disabled={disabled}
        onCommit={(value) => onChange({ opacity: value / 100 })}
      />

      {isText ? (
        <>
          <Field label="字体">
            <select
              value={style.fontFamily ?? 'sans'}
              disabled={disabled}
              onChange={(event) => onChange({ fontFamily: event.target.value as 'sans' | 'serif' | 'mono' })}
              className="h-8 w-full rounded-lg border border-white/15 bg-[#202329] px-2 text-[11px] text-white outline-none"
            >
              <option value="sans">无衬线</option>
              <option value="serif">衬线</option>
              <option value="mono">等宽</option>
            </select>
          </Field>
          <NumberField
            label="字号"
            value={style.fontSize ?? 32}
            min={16}
            max={128}
            suffix="px"
            disabled={disabled}
            onCommit={(value) => onChange({ fontSize: value })}
          />
          <Field label="字重">
            <Segmented
              value={style.fontWeight ?? 500}
              disabled={disabled}
              options={[{ value: 400, label: '常规' }, { value: 500, label: '中等' }, { value: 700, label: '粗体' }]}
              onChange={(fontWeight) => onChange({ fontWeight })}
            />
          </Field>
        </>
      ) : (
        <>
          <NumberField
            label="线宽"
            value={style.width ?? 3}
            min={1}
            max={24}
            suffix="px"
            disabled={disabled}
            onCommit={(value) => onChange({ width: value })}
          />
          <Field label="线型">
            <Segmented
              value={style.dash ?? 'solid'}
              disabled={disabled}
              options={[{ value: 'solid', label: '实线' }, { value: 'dashed', label: '虚线' }, { value: 'dotted', label: '点线' }]}
              onChange={(dash) => onChange({ dash })}
            />
          </Field>
          {target === 'arrow' ? (
            <Field label="箭头">
              <Segmented
                value={style.arrowhead ?? 'arrow'}
                disabled={disabled}
                options={[{ value: 'arrow', label: '开放' }, { value: 'triangle', label: '实心' }, { value: 'none', label: '无' }]}
                onChange={(arrowhead) => onChange({ arrowhead })}
              />
            </Field>
          ) : null}
        </>
      )}
    </div>
  )
}
