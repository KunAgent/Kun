import { useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import type { AgentModelBinding } from '@shared/rooms-api'
import { formatRelativeTime } from '../../lib/format-relative-time'
import { modelAccountLabel, modelProviderLabel, type ConversationStatus } from './conversation-info'

export function InfoSection({ title, action, danger = false, children }: {
  title: string; action?: ReactNode; danger?: boolean; children: ReactNode
}): ReactElement {
  return <section className="conversation-info-section" data-danger={danger || undefined}>
    <header><h3>{title}</h3>{action}</header>
    {children}
  </section>
}

export function InfoStatus({ status, label }: { status: ConversationStatus; label: string }): ReactElement {
  return <span className="conversation-info-status" data-status={status}><i aria-hidden="true" />{label}</span>
}

/** Equal-width shortcuts under the identity, like a contact card. */
export function InfoQuickActions({ actions }: {
  actions: Array<{ id: string; icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean }>
}): ReactElement {
  return <div className="conversation-info-quick">
    {actions.map(({ id, icon: Icon, label, onClick, disabled }) => <button type="button" key={id}
      data-info-action={id} disabled={disabled} onClick={onClick}>
      <Icon size={17} strokeWidth={1.75} aria-hidden="true" /><span>{label}</span>
    </button>)}
  </div>
}

export type InfoModelSource = 'room' | 'agent' | 'preset' | 'default' | 'main'

/** One resolved model binding: what runs, where it comes from and whether it can run now. */
export function InfoModelCard({ label, binding, available, source, verifiedAt, options, compact = false }: {
  label: string
  binding?: AgentModelBinding
  available?: boolean
  source?: InfoModelSource
  verifiedAt?: string
  options?: ReadonlyArray<{ model: string; providerId?: string; accountId?: string; providerLabel?: string }>
  compact?: boolean
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const provider = modelProviderLabel(binding, options)
  const account = modelAccountLabel(binding)
  return <div className="conversation-info-model" data-compact={compact || undefined}
    data-available={binding ? String(available !== false) : undefined}>
    <div className="conversation-info-model-head">
      <small>{label}</small>
      {binding && available !== undefined ? <span className="conversation-info-model-state">
        <i aria-hidden="true" />{t(available ? 'conversationInfoModelAvailable' : 'conversationInfoModelUnavailable')}
      </span> : null}
    </div>
    <strong title={binding?.model}>{binding?.model ?? '—'}</strong>
    {provider || account ? <p title={[binding?.providerId, binding?.accountId].filter(Boolean).join(' / ')}>
      {[provider, account].filter(Boolean).join(' · ')}</p> : null}
    {source || verifiedAt ? <div className="conversation-info-model-meta">
      {source ? <span data-source={source}>{t('conversationInfoSource_' + source)}</span> : null}
      {verifiedAt ? <small>{t('conversationInfoVerified', { time: formatRelativeTime(verifiedAt, i18n.language) })}</small> : null}
    </div> : null}
  </div>
}

/** Long instructions stay readable without pushing the danger zone out of reach. */
export function InfoPersona({ text, empty }: { text?: string; empty: string }): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const value = text?.trim() ?? ''
  if (!value) return <p className="conversation-info-persona is-empty">{empty}</p>
  const long = value.length > 160 || value.split('\n').length > 3
  return <div className="conversation-info-persona" data-expanded={expanded || !long || undefined}>
    <p>{value}</p>
    {long ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {t(expanded ? 'conversationInfoShowLess' : 'conversationInfoShowMore')}</button> : null}
  </div>
}

/** A destructive action reads as a row: what it does, what survives, and the danger color. */
export function InfoDangerRow({ id, icon: Icon, label, hint, onClick, disabled }: {
  id: string; icon: LucideIcon; label: string; hint: string; onClick: () => void; disabled?: boolean
}): ReactElement {
  return <button type="button" className="conversation-info-danger" data-info-danger={id} disabled={disabled} onClick={onClick}>
    <Icon size={16} aria-hidden="true" />
    <span><strong>{label}</strong><small>{hint}</small></span>
  </button>
}
