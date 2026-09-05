import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { Briefcase, Check, ChevronDown, Code2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  activeView: 'chat' | 'write' | 'design' | 'claw' | 'board' | 'schedule' | 'workflow' | 'subagents'
  onCodeOpen: () => void
  onWriteOpen: () => void
  disabled?: boolean
  disabledReason?: string
}

type WorkspaceMode = 'chat' | 'write'

export function WorkspaceModeTabs({
  activeView,
  onCodeOpen,
  onWriteOpen,
  disabled = false,
  disabledReason
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusIndexRef = useRef<number | null>(null)
  const menuId = useId()
  const selectedMode: WorkspaceMode = activeView === 'write' ? 'write' : 'chat'
  const options = [
    {
      id: 'write' as const,
      label: t('workspaceModeWorkLabel'),
      description: t('workspaceModeWorkDescription'),
      Icon: Briefcase,
      onSelect: onWriteOpen
    },
    {
      id: 'chat' as const,
      label: t('code'),
      description: t('workspaceModeCodeDescription'),
      Icon: Code2,
      onSelect: onCodeOpen
    }
  ]
  const selectedOption = options.find((option) => option.id === selectedMode) ?? options[0]
  const SelectedIcon = selectedOption.Icon

  useEffect(() => {
    setOpen(false)
  }, [activeView])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open || pendingFocusIndexRef.current === null) return
    optionRefs.current[pendingFocusIndexRef.current]?.focus()
    pendingFocusIndexRef.current = null
  }, [open])

  const openAndFocus = (index: number): void => {
    if (open) {
      optionRefs.current[index]?.focus()
      return
    }
    pendingFocusIndexRef.current = index
    setOpen(true)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openAndFocus(event.key === 'ArrowDown' ? 0 : options.length - 1)
  }

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    optionRefs.current[nextIndex]?.focus()
  }

  const selectMode = (mode: WorkspaceMode): void => {
    setOpen(false)
    if (mode === selectedMode) {
      triggerRef.current?.focus()
      return
    }
    options.find((option) => option.id === mode)?.onSelect()
  }

  return (
    <div ref={rootRef} className="workspace-mode-tabs relative z-40 mb-1.5 w-fit max-w-full">
      <button
        ref={triggerRef}
        type="button"
        data-workspace-mode-trigger
        data-workspace-mode={selectedMode}
        data-cursor-spotlight-target
        aria-label={`${t('code')} / ${t('workspaceModeWorkLabel')}`}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={handleTriggerKeyDown}
        className="workspace-mode-trigger group inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border border-transparent bg-transparent px-3 text-[13px] font-medium text-ds-ink outline-none transition-[background-color,box-shadow] duration-150 hover:bg-[var(--ds-sidebar-field-bg)] focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55"
        title={disabled ? disabledReason : selectedOption.label}
      >
        <SelectedIcon
          aria-hidden
          className="workspace-mode-active-icon h-4 w-4 shrink-0"
          strokeWidth={1.9}
        />
        <span className="workspace-mode-tab-label min-w-0 truncate whitespace-nowrap">
          {selectedOption.label}
        </span>
        <ChevronDown
          aria-hidden
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.9}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={`${t('code')} / ${t('workspaceModeWorkLabel')}`}
          className="workspace-mode-menu ds-no-drag absolute left-0 top-[calc(100%+6px)] z-50 w-[248px] max-w-[calc(100vw-32px)] rounded-xl border border-[var(--ds-border-strong)] p-1.5"
        >
          {options.map(({ id, label, description, Icon }, index) => {
            const selected = id === selectedMode
            return (
              <button
                key={id}
                ref={(node) => { optionRefs.current[index] = node }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                data-workspace-mode={id}
                data-selected={selected ? 'true' : 'false'}
                onClick={() => selectMode(id)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className="workspace-mode-option group flex min-h-[58px] w-full items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left outline-none transition-colors duration-150 focus-visible:border-[var(--ds-focus-ring)]"
              >
                <Icon
                  aria-hidden
                  data-active={selected ? 'true' : 'false'}
                  className="workspace-mode-option-icon h-[18px] w-[18px] shrink-0 text-ds-muted"
                  strokeWidth={1.8}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium leading-5 text-ds-ink">
                    {label}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] leading-4 text-ds-faint">
                    {description}
                  </span>
                </span>
                {selected ? (
                  <Check aria-hidden className="h-4 w-4 shrink-0 text-ds-ink" strokeWidth={2} />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
