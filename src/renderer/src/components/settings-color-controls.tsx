import { DEFAULT_CURSOR_SPOTLIGHT_COLOR } from '@shared/app-settings'
import { useEffect, useMemo, useState, type ReactElement } from 'react'

type Rgb = { r: number; g: number; b: number }
type Translate = (key: string, values?: Record<string, unknown>) => string

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const color = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback
}

function hexToRgb(color: string): Rgb {
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16)
  }
}

function rgbToHex(rgb: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount)
  }
}

function spotlightColorScale(color: string): string[] {
  const rgb = hexToRgb(normalizeHexColor(color, DEFAULT_CURSOR_SPOTLIGHT_COLOR))
  return [
    rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.46)),
    rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.28)),
    rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.12)),
    rgbToHex(rgb),
    rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.18)),
    rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.36)),
    rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.54))
  ]
}

export function HexColorControl({
  value,
  ariaLabel,
  disabled = false,
  resetValue,
  resetLabel,
  onChange
}: {
  value: string
  ariaLabel: string
  disabled?: boolean
  resetValue?: string
  resetLabel?: string
  onChange: (color: string) => void
}): ReactElement {
  const normalized = normalizeHexColor(value, resetValue ?? '#000000')
  const [draft, setDraft] = useState(normalized)

  useEffect(() => setDraft(normalized), [normalized])

  const commit = (candidate: string): boolean => {
    const trimmed = candidate.trim()
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return false
    onChange(trimmed.toLowerCase())
    return true
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <input
        type="color"
        value={normalized}
        aria-label={ariaLabel}
        disabled={disabled}
        className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-ds-border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(event) => onChange(event.target.value.toLowerCase())}
      />
      <input
        className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
        value={draft}
        aria-label={`${ariaLabel} HEX`}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value)
          void commit(event.target.value)
        }}
        onBlur={() => {
          if (!commit(draft)) setDraft(normalized)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          if (!commit(draft)) setDraft(normalized)
          event.currentTarget.blur()
        }}
      />
      {resetValue && resetLabel ? (
        <button
          type="button"
          disabled={disabled || normalized === resetValue}
          onClick={() => onChange(resetValue)}
          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resetLabel}
        </button>
      ) : null}
    </div>
  )
}

export function SpotlightColorControl({
  color,
  disabled,
  t,
  onChange
}: {
  color: string
  disabled: boolean
  t: Translate
  onChange: (color: string) => void
}): ReactElement {
  const normalized = normalizeHexColor(color, DEFAULT_CURSOR_SPOTLIGHT_COLOR)
  const [baseColor, setBaseColor] = useState(normalized)
  const [toneIndex, setToneIndex] = useState(3)
  const scale = useMemo(() => spotlightColorScale(baseColor), [baseColor])
  const gradient = `linear-gradient(90deg, ${scale.join(', ')})`

  useEffect(() => {
    const nextIndex = scale.indexOf(normalized)
    if (nextIndex >= 0) {
      setToneIndex(nextIndex)
      return
    }
    setBaseColor(normalized)
    setToneIndex(3)
  }, [normalized, scale])

  const selectColor = (nextColor: string): void => {
    const next = normalizeHexColor(nextColor, DEFAULT_CURSOR_SPOTLIGHT_COLOR)
    setBaseColor(next)
    setToneIndex(3)
    onChange(next)
  }
  const selectTone = (index: number): void => {
    const nextIndex = Math.max(0, Math.min(scale.length - 1, index))
    setToneIndex(nextIndex)
    onChange(scale[nextIndex] ?? normalized)
  }

  return (
    <div className="grid w-full min-w-0 gap-2 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
      <HexColorControl
        value={normalized}
        ariaLabel={t('cursorSpotlightColor')}
        disabled={disabled}
        resetValue={DEFAULT_CURSOR_SPOTLIGHT_COLOR}
        resetLabel={t('cursorSpotlightColorReset')}
        onChange={selectColor}
      />
      <input
        type="range"
        min={0}
        max={scale.length - 1}
        step={1}
        value={toneIndex}
        aria-label={t('cursorSpotlightColorTone')}
        disabled={disabled}
        className="h-2 w-full cursor-pointer rounded-full accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: gradient }}
        onChange={(event) => selectTone(Number(event.target.value))}
      />
      <div className="flex gap-1.5">
        {scale.map((shade, index) => (
          <button
            key={`${shade}-${index}`}
            type="button"
            disabled={disabled}
            aria-label={t('cursorSpotlightColorShade', { index: index + 1 })}
            title={shade}
            className={`h-6 min-w-0 flex-1 rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50 ${
              shade === normalized ? 'border-ds-ink ring-1 ring-ds-ink/25' : 'border-ds-border hover:scale-[1.02]'
            }`}
            style={{ backgroundColor: shade }}
            onClick={() => selectTone(index)}
          />
        ))}
      </div>
      <p className="text-[12px] leading-5 text-ds-faint">{t('cursorSpotlightColorDesc')}</p>
    </div>
  )
}
