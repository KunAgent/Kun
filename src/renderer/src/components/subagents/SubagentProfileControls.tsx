import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Power, Trash2, X } from 'lucide-react'
import type { KunSubagentProfileV1, ModelReasoningEffort } from '@shared/app-settings'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { AgentKun } from './AgentKun'
import { PRESET_COLORS, type EditorVariant } from './subagent-settings-support'

export function SubagentPanelHeader({
  onCollapse
}: {
  onCollapse: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-ds-border px-4 py-3.5">
      <Bot className="h-[17px] w-[17px] text-accent" strokeWidth={2} />
      <b className="text-[14px] font-semibold text-ds-heading">{t('subagents', 'Subagents')}</b>
      <span className="text-[11px] text-ds-faint">· {t('subagentsPanel.configModel', 'configure model')}</span>
      <button data-settings-action="ghost" data-settings-size="icon"
        type="button"
        onClick={onCollapse}
        title={t('agentsView.cancel', 'Close')}
        aria-label={t('agentsView.cancel', 'Close')}
        className="ml-auto rounded-md p-1 text-ds-faint transition hover:bg-ds-subtle hover:text-ds-heading"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  )
}

export function Row({
  variant = 'panel',
  roleId,
  disabled = false,
  builtin = false,
  name,
  desc,
  children
}: {
  variant?: EditorVariant
  roleId: string
  disabled?: boolean
  builtin?: boolean
  name: string
  desc: string
  children: ReactNode
}): ReactElement {
  const { t } = useTranslation('common')
  const settings = variant === 'settings'
  return (
    <div className={`${
      settings
        ? 'grid grid-cols-[42px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 px-4 py-4 transition hover:bg-ds-hover/45 sm:flex sm:gap-3'
        : 'mx-2 flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-ds-hover/60'
    } ${disabled ? 'opacity-60' : ''}`}>
      <span
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full"
        style={{ background: 'radial-gradient(circle at 50% 36%, #fff 0%, rgba(238,244,251,0.9) 78%)', boxShadow: 'inset 0 0 0 1px rgba(188,214,245,0.7)' }}
      >
        <AgentKun id={roleId} disabled={disabled} className="h-9 w-9" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-ds-heading">{name}</span>
          {builtin ? (
            <span
              className="shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold"
              style={{ backgroundColor: 'rgba(59,130,216,0.14)', color: '#3b82d8' }}
            >
              {t('subagentsPanel.builtin', '内置')}
            </span>
          ) : null}
        </div>
        {desc ? (
          <div className={`${settings ? 'text-[12.5px] leading-5' : 'truncate text-[11px]'} text-ds-muted`}>{desc}</div>
        ) : null}
      </div>
      <div className={`${
        settings
          ? 'col-span-2 flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-[340px] sm:shrink-0'
          : 'flex shrink-0 items-center gap-1'
      }`}>{children}</div>
    </div>
  )
}

export function RowActions({
  enabled,
  builtin,
  t,
  onToggle,
  onEdit,
  onDelete
}: {
  enabled: boolean
  builtin: boolean
  t: TFunction<'common'>
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {builtin ? null : (
        <button aria-pressed={enabled} aria-label={enabled ? t('disable', 'Disable') : t('enable', 'Enable')}
          type="button"
          onClick={onToggle}
          title={enabled ? t('disable', 'Disable') : t('enable', 'Enable')}
          className={`rounded p-1.5 hover:bg-ds-subtle ${enabled ? 'text-accent' : 'text-ds-faint'}`}
        >
          <Power className="h-3.5 w-3.5" />
        </button>
      )}
      <button data-settings-action="ghost" data-settings-size="icon" aria-label={t('agentsView.edit', 'Edit')}
        type="button"
        onClick={onEdit}
        title={t('agentsView.edit', 'Edit')}
        className="rounded p-1.5 text-ds-muted hover:bg-ds-subtle hover:text-ds-heading"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {builtin ? null : (
        <button data-settings-action="danger-ghost" data-settings-size="icon" aria-label={t('agentsView.delete', 'Delete')}
          type="button"
          onClick={onDelete}
          title={t('agentsView.delete', 'Delete')}
          className="rounded p-1.5 text-ds-muted hover:bg-ds-subtle hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Two-step model picker (mirrors the composer): trigger → pick provider → pick
 * model, with a "follow default" option. `stretch` = full-width dialog variant.
 * Reasoning lives in ReasoningEffortPicker, not inside this dropdown.
 */
export function ModelSelect({
  value,
  providerId,
  groups,
  onChange,
  disabled,
  small,
  stretch,
  emptyLabel,
  ariaLabel
}: {
  value: string
  providerId: string
  groups: ModelProviderModelGroup[]
  onChange: (model: string, providerId: string) => void
  disabled?: boolean
  small?: boolean
  stretch?: boolean
  emptyLabel?: string
  ariaLabel?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  useEffect(() => {
    if (open) setPicked(providerId || null)
  }, [open, providerId])

  const label = value || emptyLabel || t('agentsView.followDefault', '跟随默认')
  const activeGroup = groups.find((g) => g.providerId === picked)

  const triggerCls = stretch
    ? 'flex h-9 w-full items-center justify-between rounded-md border border-ds-border bg-[var(--ds-surface-elevated)] pl-3 pr-2.5 text-sm text-ds-heading disabled:opacity-50'
    : `flex h-8 w-[132px] items-center justify-between gap-1 rounded-[9px] border bg-[var(--ds-surface-elevated)] pl-3 pr-2 text-[12px] font-semibold disabled:opacity-50 ${
        small ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300' : 'border-ds-border text-accent'
      }`

  return (
    <div className={`relative ${stretch ? 'min-w-0 flex-1' : 'shrink-0'}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={triggerCls}
        style={{ backgroundColor: 'var(--ds-surface-elevated)' }}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
      </button>
      {open ? (
        <div
          style={{ backgroundColor: 'var(--ds-surface-elevated)' }}
          className={`absolute z-50 mt-1 max-h-[300px] overflow-auto rounded-xl border border-ds-border p-1 shadow-[0_12px_32px_rgba(31,45,64,0.16)] ${
            stretch ? 'left-0 w-full' : 'right-0 w-[230px]'
          }`}
        >
          {picked === null ? (
            <>
              <PickerItem active={!value} onClick={() => { onChange('', ''); setOpen(false) }}>
                {t('agentsView.followDefault', '跟随默认')}
              </PickerItem>
              {groups.map((g) => (
                <button
                  key={g.providerId}
                  type="button"
                  onClick={() => setPicked(g.providerId)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-ds-ink hover:bg-accent-soft"
                >
                  <span className="truncate">{g.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
                </button>
              ))}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="mb-0.5 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium text-ds-muted hover:bg-ds-card-muted"
              >
                <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{activeGroup?.label ?? picked}</span>
              </button>
              {(activeGroup?.modelIds ?? []).map((id) => (
                <PickerItem
                  key={id}
                  active={value === id && providerId === picked}
                  onClick={() => { onChange(id, picked); setOpen(false) }}
                >
                  {id}
                </PickerItem>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function ReasoningEffortPicker({
  value,
  onChange,
  options,
  compact = false,
  ariaLabel,
  mixedLabel
}: {
  value: ModelReasoningEffort | null
  onChange: (effort: ModelReasoningEffort) => void
  options: Array<{ id: ModelReasoningEffort; labelKey: string }>
  compact?: boolean
  ariaLabel?: string
  mixedLabel?: string
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('subagentsPanel.reasoning', 'Reasoning')}
      className={`flex flex-wrap items-center gap-1 ${compact ? 'justify-end' : ''}`}
    >
      {mixedLabel && value === null ? (
        <span className="mr-0.5 text-[10px] font-semibold text-ds-faint">{mixedLabel}</span>
      ) : null}
      {options.map((opt) => {
        const on = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-md px-2 py-1 font-semibold transition ${
              compact ? 'text-[10px]' : 'text-[11px]'
            } ${
              on
                ? 'bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--ds-accent)]'
                : 'text-ds-muted hover:bg-ds-card-muted'
            }`}
          >
            {t(opt.labelKey, opt.id)}
          </button>
        )
      })}
    </div>
  )
}

export function PickerItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-accent-soft ${
        active ? 'font-semibold text-accent' : 'text-ds-ink'
      }`}
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent opacity-100' : 'opacity-0'}`} />
      <span className="truncate">{children}</span>
    </button>
  )
}
