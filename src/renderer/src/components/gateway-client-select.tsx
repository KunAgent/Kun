import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { GATEWAY_CLIENTS, type GatewayClientId } from '@shared/gateway-client-setup'
import { AgentIcon } from './agent-icon'
import { useComposerPickerPopover } from './chat/use-composer-picker-popover'

/** Uses the harness picker's zoom-aware portal so settings overflow cannot clip the list. */
export function GatewayClientSelect({ label, value, onChange }: {
  label: string
  value: GatewayClientId
  onChange: (value: GatewayClientId) => void
}): ReactElement {
  const labelId = useId()
  const valueId = useId()
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const selectedIndex = GATEWAY_CLIENTS.findIndex((entry) => entry.id === value)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const searchRef = useRef({ text: '', time: 0 })
  const closeMenu = useCallback(() => setOpen(false), [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open, onClose: closeMenu, preferredWidth: 260, estimatedHeight: 154, maximumHeight: 154
  })
  const selected = GATEWAY_CLIENTS[selectedIndex]
  const active = GATEWAY_CLIENTS[activeIndex]
  const optionId = (id: GatewayClientId): string => `${listboxId}-${id}`

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, menuRef, open])

  const openMenu = (index = selectedIndex): void => {
    setActiveIndex(index)
    searchRef.current = { text: '', time: 0 }
    setOpen(true)
  }
  const select = (id: GatewayClientId): void => {
    onChange(id)
    closeMenu()
    triggerRef.current?.focus()
  }

  return <div className="grid min-w-0 gap-1 text-[11px] text-ds-muted" data-gateway-client-control>
    <label id={labelId} htmlFor={valueId}>{label}</label>
    <button
      ref={triggerRef}
      id={valueId}
      type="button"
      role="combobox"
      aria-labelledby={labelId}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      aria-activedescendant={open ? optionId(active.id) : undefined}
      data-gateway-client-select
      onClick={() => open ? closeMenu() : openMenu()}
      onBlur={closeMenu}
      onKeyDown={(event) => {
        if (event.key === 'Tab') { closeMenu(); return }
        if (event.key === 'Escape') {
          if (open) {
            event.preventDefault()
            event.stopPropagation()
            closeMenu()
          }
          return
        }
        if (['Enter', ' '].includes(event.key)) {
          event.preventDefault()
          if (open) select(active.id)
          else openMenu()
          return
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? GATEWAY_CLIENTS.length - 1
            : open ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + GATEWAY_CLIENTS.length) % GATEWAY_CLIENTS.length
              : selectedIndex
          if (open) setActiveIndex(index)
          else openMenu(index)
          return
        }
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
        event.preventDefault()
        const now = Date.now()
        const previous = now - searchRef.current.time < 700 ? searchRef.current.text : ''
        const character = event.key.toLowerCase()
        const repeated = previous === character
        const query = repeated ? character : `${previous}${character}`
        searchRef.current = { text: query, time: now }
        const startIndex = repeated ? activeIndex + 1 : 0
        for (let offset = 0; offset < GATEWAY_CLIENTS.length; offset += 1) {
          const index = (startIndex + offset) % GATEWAY_CLIENTS.length
          if (!GATEWAY_CLIENTS[index].label.toLowerCase().startsWith(query)) continue
          setActiveIndex(index)
          setOpen(true)
          break
        }
      }}
      className="flex w-full min-w-0 max-w-full items-center gap-2 rounded-lg border border-ds-border bg-ds-main px-3 py-2 text-left text-[12px] text-ds-ink outline-none hover:bg-ds-hover focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <AgentIcon harnessId={selected.id} size={16} />
      <span className="min-w-0 flex-1 truncate">{selected.label}</span>
      <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ds-muted" />
    </button>
    {open && typeof document !== 'undefined' ? createPortal(<div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-labelledby={labelId}
      data-gateway-client-listbox
      style={menuStyle}
      onPointerDown={(event) => event.preventDefault()}
      className="ds-no-drag fixed z-[110] min-w-0 overflow-y-auto overscroll-contain rounded-lg border border-ds-border bg-ds-main p-1 shadow-xl"
    >
      {GATEWAY_CLIENTS.map((entry, index) => <button
        key={entry.id}
        id={optionId(entry.id)}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={entry.id === value}
        data-active={index === activeIndex}
        data-gateway-client-option={entry.id}
        onPointerMove={() => setActiveIndex(index)}
        onClick={() => select(entry.id)}
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12px] text-ds-ink ${index === activeIndex ? 'bg-ds-hover' : ''}`}
      >
        <AgentIcon harnessId={entry.id} size={16} />
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.id === value ? <Check size={14} aria-hidden="true" className="shrink-0 text-accent" /> : null}
      </button>)}
    </div>, document.body) : null}
  </div>
}
