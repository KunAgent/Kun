import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { bodyZoom } from '../../lib/body-zoom'
import { useComposerPickerPopover } from '../chat/use-composer-picker-popover'

export const agentSettingFieldClass = 'flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-left text-[13px] text-ds-ink outline-none transition hover:border-accent/30 hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-50'
export const agentSettingMenuClass = 'ds-no-drag fixed z-[1100] min-w-0 overflow-hidden rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card'

/** Keyboard navigation works for both simple options and the shared model list. */
export function moveAgentPickerFocus(event: KeyboardEvent<HTMLDivElement>): void {
  const input = event.target instanceof HTMLInputElement
  if (input && !['ArrowDown', 'ArrowUp'].includes(event.key)) return
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled), [role="menuitemradio"]:not(:disabled)')]
  if (!options.length) return
  event.preventDefault()
  const current = options.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
    : current < 0 ? event.key === 'ArrowUp' ? options.length - 1 : 0
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  options[next].focus()
  options[next].scrollIntoView?.({ block: 'nearest' })
}

export type AgentSettingOption = { value: string; label: string; icon?: ReactNode }

/** Settings use the composer's zoom-aware portal, never an OS select popup. */
export function AgentSettingsSelect({ label, value, options, onChange, marker, disabled = false }: {
  label: string; value: string; options: AgentSettingOption[]; onChange: (value: string) => void
  marker?: string; disabled?: boolean
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(320)
  const close = useCallback(() => setOpen(false), [])
  const id = useId()
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({ open, onClose: close,
    preferredWidth: width, estimatedHeight: Math.min(320, options.length * 40 + 12), maximumHeight: 320 })
  const selected = options.find((option) => option.value === value)
  const show = (): void => {
    setWidth(Math.max(240, (triggerRef.current?.getBoundingClientRect().width ?? 320) / bodyZoom()))
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ;(selected ?? menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, menuRef])
  return <div className="w-full min-w-0">
    <button ref={triggerRef} type="button" role="combobox" aria-label={label} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      {...(marker ? { [marker]: true } : {})} className={agentSettingFieldClass}
      onClick={() => open ? close() : show()}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() } }}>
      {selected?.icon}<span className="min-w-0 flex-1 truncate">{selected?.label ?? (value || label)}</span>
      <ChevronDown size={15} className="shrink-0 text-ds-faint" aria-hidden="true" />
    </button>
    {open ? createPortal(<div ref={menuRef} id={id} role="listbox" aria-label={label}
      data-agent-settings-listbox className={`${agentSettingMenuClass} overflow-y-auto overscroll-contain`}
      style={{ ...menuStyle, visibility: menuStyle.left === undefined ? 'hidden' : 'visible' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); triggerRef.current?.focus() }
        else moveAgentPickerFocus(event)
      }} onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== triggerRef.current) close()
      }}>
      {options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value}
        data-agent-setting-option={option.value} className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-ds-hover focus-visible:bg-ds-hover ${option.value === value ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted'}`}
        onClick={() => { if (option.value !== value) onChange(option.value); close(); triggerRef.current?.focus() }}>
        {option.icon}<span className="min-w-0 flex-1 break-words">{option.label}</span>
        {option.value === value ? <Check size={15} className="shrink-0 text-accent" /> : null}
      </button>)}
    </div>, document.body) : null}
  </div>
}
