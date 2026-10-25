import { Check } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

export type PreviewMenuItem =
  | { kind: 'item'; label: string; onSelect: () => void; disabled?: boolean; hint?: string }
  | { kind: 'check'; label: string; checked: boolean; onSelect: () => void }
  | { kind: 'separator' }

type Props = {
  label: string
  /** Visible trigger content; icon-only triggers rely on `label` for their name. */
  children: ReactNode
  items: PreviewMenuItem[]
  className?: string
  align?: 'start' | 'end'
  placement?: 'below' | 'above'
}

/** Small popover menu used by the file preview toolbar and status bar. */
export function PreviewMenuButton({
  label,
  children,
  items,
  className,
  align = 'end',
  placement = 'below'
}: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    rootRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
        onClick={() => setOpen((value) => !value)}
      >
        {children}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={`absolute z-40 min-w-[210px] rounded-[10px] border border-ds-border bg-ds-card p-[5px] shadow-xl ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${placement === 'below' ? 'top-[calc(100%+4px)]' : 'bottom-[calc(100%+4px)]'}`}
        >
          {items.map((item, index) => {
            if (item.kind === 'separator') {
              return <div key={`separator-${index}`} role="separator" className="mx-1.5 my-1 h-px bg-ds-border-muted" />
            }
            const checked = item.kind === 'check' ? item.checked : undefined
            return (
              <button
                key={item.label}
                type="button"
                role={item.kind === 'check' ? 'menuitemcheckbox' : 'menuitem'}
                aria-label={item.label}
                aria-checked={checked}
                disabled={item.kind === 'item' ? item.disabled : false}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className="flex h-7 w-full items-center gap-3 rounded-md px-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover focus-visible:bg-ds-hover focus-visible:outline-none disabled:cursor-default disabled:opacity-45"
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.kind === 'item' && item.hint ? <span className="text-[11px] text-ds-muted">{item.hint}</span> : null}
                {checked ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
