import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type PaperMoreMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}

/** "⋯" button with a small menu that opens upward (it lives in card footers). */
export function PaperMoreMenu({ items, label }: { items: readonly PaperMoreMenuItem[]; label: string }): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
        className={`grid h-8 w-8 place-items-center rounded-lg transition hover:bg-ds-hover hover:text-ds-ink ${open ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted'}`}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-1.5 min-w-[168px] rounded-xl border border-ds-border bg-ds-elevated p-1 shadow-[0_12px_32px_rgba(15,23,42,0.16)]"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover disabled:opacity-40"
            >
              <span className="text-ds-faint">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
