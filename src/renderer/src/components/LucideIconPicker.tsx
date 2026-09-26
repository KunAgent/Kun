import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { icons, ChevronDown, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  calculateComposerPopoverPlacement,
} from './chat/floating-composer-popover-placement'
import { bodyZoom } from '../lib/body-zoom'
import { LucideIconByName } from './lucide-icon-by-name'

const ICON_NAMES = Object.keys(icons)
const PICKER_WIDTH = 336
const PICKER_MAX_HEIGHT = 380
const PICKER_ESTIMATED_HEIGHT = 360
/** Rendering all ~1.6k icons at once janks the popover; a capped grid plus search covers it. */
const MAX_VISIBLE_ICONS = 120

type Props = {
  /** Currently selected lucide icon name; unknown names render the fallback. */
  value: string
  onChange: (iconName: string) => void
  disabled?: boolean
  /** Accessible label for the trigger button (e.g. the preset name it belongs to). */
  ariaLabel?: string
}

/**
 * Trigger button + searchable lucide icon grid in a portal popover. Search
 * matches case-insensitively on the PascalCase icon name.
 */
export function LucideIconPicker({ value, onChange, disabled = false, ariaLabel }: Props): ReactElement {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = needle
      ? ICON_NAMES.filter((name) => name.toLowerCase().includes(needle))
      : ICON_NAMES
    return { visible: all.slice(0, MAX_VISIBLE_ICONS), total: all.length }
  }, [query])

  const updateMenuPosition = useCallback((): void => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const { left, top, width, maxHeight } = calculateComposerPopoverPlacement({
      anchorRect: rect,
      popoverHeight: menuRef.current?.offsetHeight ?? PICKER_ESTIMATED_HEIGHT,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      preferredWidth: PICKER_WIDTH,
      maximumHeight: PICKER_MAX_HEIGHT,
      coordinateScale: bodyZoom()
    })
    setMenuStyle({ left, top, width, maxHeight })
  }, [])

  useEffect(() => {
    if (!open) return
    updateMenuPosition()
    const frame = window.requestAnimationFrame(() => {
      updateMenuPosition()
      searchRef.current?.focus()
    })
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [open, updateMenuPosition])

  const commit = (iconName: string): void => {
    onChange(iconName)
    setOpen(false)
    setQuery('')
  }

  const menu =
    open && typeof document !== 'undefined' ? (
      <div
        ref={menuRef}
        role="dialog"
        aria-label={t('codeAgentIconPickerTitle')}
        style={menuStyle}
        className="fixed z-50 flex max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[18px] border border-ds-border-muted bg-white text-[13px] text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.14)] dark:bg-ds-card"
      >
        <div className="flex items-center gap-2 border-b border-ds-border-muted px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('codeAgentIconSearchPlaceholder')}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </div>
        <div className="grid grid-cols-8 gap-1 overflow-y-auto p-2">
          {matches.visible.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={name === value}
              onClick={() => commit(name)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent/40 ${
                name === value
                  ? 'bg-accent/15 text-accent'
                  : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              <LucideIconByName name={name} className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ))}
          {matches.total === 0 ? (
            <p className="col-span-8 px-1 py-2 text-[12px] text-ds-muted">
              {t('codeAgentIconPickerEmpty')}
            </p>
          ) : null}
        </div>
        {matches.total > matches.visible.length ? (
          <p className="border-t border-ds-border-muted px-3 py-1.5 text-[11.5px] text-ds-faint">
            {t('codeAgentIconPickerMore', { shown: matches.visible.length, total: matches.total })}
          </p>
        ) : null}
      </div>
    ) : null

  return (
    <>
      <div ref={rootRef} className="relative inline-flex shrink-0">
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            updateMenuPosition()
            setOpen((current) => !current)
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={ariaLabel ?? t('codeAgentIconPickerTitle')}
          title={value}
          className="inline-flex h-9 items-center gap-1 rounded-xl border border-ds-border bg-ds-main/60 px-2.5 text-ds-ink outline-none transition-colors hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-ds-accent/40 disabled:cursor-not-allowed disabled:opacity-55"
        >
          <LucideIconByName name={value} className="h-4 w-4" strokeWidth={1.8} />
          <ChevronDown className="h-3 w-3 text-ds-faint" strokeWidth={1.9} />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
