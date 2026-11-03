import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export type WorkerMenuItem = {
  id: string
  label: string
  icon?: ReactNode
  /** Destructive: the first click asks again with `confirmLabel`. */
  confirmLabel?: string
  disabled?: boolean
  onSelect: () => void
}

/**
 * "⋯" menu for worker rows and the worker tab header. It opens downward
 * unless its scroll container lacks the room; destructive items confirm
 * inside the menu instead of a dialog.
 */
export function WorkerMoreMenu({
  items,
  label,
  size = 'sm'
}: {
  items: readonly WorkerMenuItem[]
  label: string
  size?: 'sm' | 'md'
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
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

  const toggle = (): void => {
    if (!open) {
      // Both rects share one coordinate space, so body zoom cancels out.
      const root = rootRef.current
      const box = root?.closest('[data-workers-scroll]')?.getBoundingClientRect?.()
      const anchor = root?.getBoundingClientRect?.()
      setUpward(Boolean(box && anchor && box.bottom - anchor.bottom < 36 * items.length + 16))
      setConfirming(null)
    }
    setOpen((value) => !value)
  }

  const button = size === 'md' ? 'h-[30px] w-[30px] rounded-lg' : 'h-7 w-7 rounded-lg'
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={toggle}
        className={`grid place-items-center transition hover:bg-ds-hover hover:text-ds-ink ${button} ${
          open ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted'
        }`}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute right-0 z-30 min-w-[176px] rounded-xl border border-ds-border bg-ds-elevated p-1 shadow-[0_12px_32px_rgba(15,23,42,0.16)] ${
            upward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {items.map((item) => {
            const asking = confirming === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                data-worker-menu-item={item.id}
                data-armed={asking || undefined}
                onClick={() => {
                  if (item.confirmLabel && !asking) {
                    setConfirming(item.id)
                    return
                  }
                  setOpen(false)
                  item.onSelect()
                }}
                className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition disabled:opacity-40 ${
                  item.confirmLabel
                    ? `ds-worker-menu-danger ${asking ? 'font-semibold' : ''}`
                    : 'text-ds-ink hover:bg-ds-hover'
                }`}
              >
                <span className={`inline-flex ${item.confirmLabel ? '' : 'text-ds-faint'}`}>{item.icon}</span>
                {asking ? item.confirmLabel : item.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
