import { useCallback, useEffect, useId, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AgentIcon } from '../agent-icon'
import { useComposerPickerPopover } from '../chat/use-composer-picker-popover'
import { agentSettingMenuClass } from './AgentSettingsSelect'
import { AgentBadge, AgentStatusDot } from './AgentCenterParts'
import { agentLineText, type AgentPresentation } from './agent-center-presentation'

type T = (key: string, options?: Record<string, unknown>) => string

export type AgentMenuAction = { id: string; label: string; onSelect: () => void; danger?: boolean; hint?: string }

const TRANSPORT_LABEL_KEY: Record<string, string> = {
  'agent-sdk': 'adeAgentTransport.agentSdk', 'cursor-sdk': 'adeAgentTransport.cursorSdk',
  'antigravity-cli': 'adeAgentTransport.antigravityCli', acp: 'adeAgentTransport.acp',
  'codex-app-server': 'adeAgentTransport.codexAppServer', 'pi-rpc': 'adeAgentTransport.piRpc'
}

function AgentMoreMenu({ label, actions }: { label: string; actions: AgentMenuAction[] }): ReactElement {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const id = useId()
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({ open, onClose: close, preferredWidth: 224,
    estimatedHeight: actions.length * 36 + 12, maximumHeight: 320 })
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, menuRef])
  return <>
    <button ref={triggerRef} type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? id : undefined} data-agent-more onClick={() => setOpen((value) => !value)}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border-muted text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
      <MoreHorizontal aria-hidden size={16} />
    </button>
    {open ? createPortal(<div ref={menuRef} id={id} role="menu" aria-label={label} className={agentSettingMenuClass}
      style={{ ...menuStyle, visibility: menuStyle.left === undefined ? 'hidden' : 'visible' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); triggerRef.current?.focus(); return }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }}>
      {actions.map((action, index) => <div key={action.id}>
        {action.danger && index > 0 ? <div className="mx-1 my-1 h-px bg-ds-border-muted" role="separator" /> : null}
        <button type="button" role="menuitem" data-agent-menu-action={action.id}
          onClick={() => { close(); action.onSelect() }}
          className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-[12.5px] outline-none hover:bg-ds-hover focus-visible:bg-ds-hover ${action.danger ? 'text-ds-status-danger' : 'text-ds-ink'}`}>
          <span>{action.label}</span>
          {action.hint ? <span className="text-[11px] text-ds-faint">{action.hint}</span> : null}
        </button>
      </div>)}
    </div>, document.body) : null}
  </>
}

/**
 * Identity, one status line, the "use in chats" switch and the overflow menu.
 * Everything it shows comes from the Agent's presentation.
 */
export function AgentDetailHeader({ row, presentation, isDefault, version, baseName, onSwitch, menu, t }: {
  row: AdeHarnessRow
  presentation: AgentPresentation
  isDefault: boolean
  version?: string
  /** Display name of the engine a derived Agent is based on. */
  baseName?: string
  onSwitch: () => void
  menu: AgentMenuAction[]
  t: T
}): ReactElement {
  const { definition } = row
  const switchLabel = t('agentCenter.useInChats')
  const on = presentation.switch === 'on' || presentation.switch === 'busy'
  const disabled = presentation.switch === 'locked' || presentation.switch === 'busy'
  return <header className="flex min-w-0 flex-wrap items-start gap-3.5" data-agent-detail-header>
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-ds-border-muted bg-ds-subtle text-ds-ink">
      <AgentIcon harnessId={definition.id} size={24} />
    </span>
    <div className="min-w-0 flex-1 basis-56">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <h3 className="min-w-0 break-words text-[17px] font-semibold leading-6 text-ds-ink">{definition.displayName}</h3>
        {version ? <AgentBadge mono>{version}</AgentBadge> : null}
        <AgentBadge>{t(TRANSPORT_LABEL_KEY[definition.transport] ?? 'adeAgentTransport.acp')}</AgentBadge>
        {definition.derivedFrom ? <AgentBadge>{t('agentCenter.source.derived', { base: baseName ?? definition.derivedFrom })}</AgentBadge> : null}
        {definition.extension ? <AgentBadge>{t('agentIntegrations.fromExtension', { name: definition.extension.name ?? definition.extension.id })}</AgentBadge> : null}
        {definition.availability === 'preview' ? <AgentBadge tone="warning">{t('agentEnablement.preview')}</AgentBadge> : null}
        {isDefault ? <AgentBadge tone="accent">{t('agentCenter.defaultBadge')}</AgentBadge> : null}
      </div>
      <p role="status" aria-live="polite" data-agent-status={presentation.state}
        className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5 text-ds-muted">
        <AgentStatusDot tone={presentation.tone} />
        <span className="min-w-0 break-words">{agentLineText(t, presentation.statusLine)}</span>
      </p>
    </div>
    <div className="ml-auto flex shrink-0 items-center gap-3">
      <span className="flex items-center gap-2 text-[12.5px] text-ds-muted">
        <span id={`agent-switch-${definition.id}`}>{switchLabel}</span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={`agent-switch-${definition.id}`}
          aria-busy={presentation.switch === 'busy' || undefined} disabled={disabled} data-agent-enable
          data-agent-switch={presentation.switch} onClick={onSwitch}
          className={`ds-settings-toggle relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${on ? 'bg-[var(--ds-control)]' : 'bg-ds-faint'} ${disabled ? 'cursor-not-allowed opacity-60' : 'active:scale-[0.98]'}`}>
          <span className={`ds-settings-toggle-thumb absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${on ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </span>
      <AgentMoreMenu label={t('agentCenter.more')} actions={menu} />
    </div>
  </header>
}
