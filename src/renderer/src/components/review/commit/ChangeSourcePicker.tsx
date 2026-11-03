import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type ChangeSourceOption = {
  id: string
  label: string
  hint?: string
  /** Right-aligned detail: a file count or a workspace state. */
  detail?: string
  mono?: boolean
}

export type ChangeSourceGroup = { id: string; label: string; options: ChangeSourceOption[] }

/** Grouped source menu for the Changes panel: one button, a listbox with hints and counts. */
export function ChangeSourcePicker({
  label,
  groups,
  value,
  onChange
}: {
  label: string
  groups: ChangeSourceGroup[]
  value: string
  onChange: (id: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const listId = useId()
  const options = groups.flatMap((group) => group.options)
  const selected = options.find((option) => option.id === value)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    const current = root.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
      ?? root.current?.querySelector<HTMLElement>('[role="option"]')
    current?.focus()
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  const choose = (id: string): void => {
    setOpen(false)
    onChange(id)
    root.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus()
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      root.current?.querySelector<HTMLElement>('button[aria-haspopup]')?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(index + step + items.length) % items.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={root} className="relative flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 text-[12px] text-ds-muted">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-change-source-picker={value}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${selected?.label ?? ''}`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border bg-ds-main px-2 text-left text-[12px] text-ds-ink ${
          open ? 'border-accent ring-2 ring-accent-soft' : 'border-ds-border-muted hover:border-ds-border'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? ''}</span>
        {selected?.detail ? <span className="shrink-0 text-[11px] text-ds-muted">{selected.detail}</span> : null}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-muted transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKeyDown}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[min(70vh,520px)] overflow-y-auto rounded-[12px] border border-ds-border-muted bg-ds-card p-1.5 shadow-[var(--ds-shadow-overlay)]"
        >
          {groups.map((group, groupIndex) => (
            <div key={group.id} role="group" aria-label={group.label}>
              {groupIndex > 0 ? <div className="mx-1.5 my-1 h-px bg-ds-border-muted" /> : null}
              <div className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-semibold text-ds-muted">{group.label}</div>
              {group.options.map((option) => {
                const isSelected = option.id === value
                return (
                  <div
                    key={option.id}
                    role="option"
                    tabIndex={-1}
                    data-change-source-option={option.id}
                    aria-selected={isSelected}
                    onClick={() => choose(option.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        choose(option.id)
                      }
                    }}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                      isSelected ? 'bg-accent-soft' : 'hover:bg-ds-hover focus:bg-ds-hover'
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={`truncate text-ds-ink ${isSelected ? 'font-semibold' : 'font-medium'}`}>{option.label}</span>
                      {option.hint ? (
                        <span className={`text-[11px] leading-4 text-ds-muted ${option.mono ? 'font-mono' : ''}`}>{option.hint}</span>
                      ) : null}
                    </span>
                    {option.detail ? <span className="shrink-0 text-[11px] text-ds-muted">{option.detail}</span> : null}
                    {isSelected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.2} /> : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
