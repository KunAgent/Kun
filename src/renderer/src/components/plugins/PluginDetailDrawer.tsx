import { useEffect, type ReactElement } from 'react'
import { ExternalLink, FileText, Globe, KeyRound, Loader2, Lock, SquareTerminal, X } from 'lucide-react'
import type { SupplyChainPermission } from '../plugin-marketplace-config'
import { PluginAvatar, PluginBadge, pluginButton, type BadgeTone } from './PluginPrimitives'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type PluginDetail = {
  id: string
  kind: 'mcp' | 'skill'
  title: string
  description: string
  sourceBadge: { tone: BadgeTone; label: string }
  /** Market name, for the provenance note; absent for Kun picks. */
  marketLabel?: string
  categoryLabel?: string
  requiredKeys: string[]
  optionalKeys: string[]
  launch?: string
  remote: boolean
  permissions: SupplyChainPermission[]
  version?: string
  originLabel?: string
  originUrl?: string
  statusLabel: string
  primaryLabel: string
  primaryDisabled: boolean
}

const PERMISSION_ICONS: Record<SupplyChainPermission, typeof Globe> = {
  command: SquareTerminal,
  network: Globe,
  secret: Lock,
  file: FileText
}

export function PluginDetailDrawer({ t, detail, busy, onPrimary, onClose }: {
  t: Translate
  detail: PluginDetail
  busy: boolean
  onPrimary: () => void
  onClose: () => void
}): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openOrigin = (): void => {
    if (!detail.originUrl?.startsWith('https://') || typeof window.kunGui?.openExternal !== 'function') return
    void window.kunGui.openExternal(detail.originUrl).catch(() => undefined)
  }
  const permissionCopy = (permission: SupplyChainPermission): { title: string; body: string } => {
    switch (permission) {
      case 'command':
        if (detail.kind === 'skill') return { title: t('pluginsPermCommandTitle'), body: t('pluginsPermSkillScriptsDesc') }
        return { title: t('pluginsPermCommandTitle'), body: detail.launch ? t('pluginsPermCommandDesc', { launch: detail.launch }) : t('pluginsPermCommandDescPlain') }
      case 'network':
        return { title: t('pluginsPermNetworkTitle'), body: t('pluginsPermNetworkDesc') }
      case 'secret':
        return { title: t('pluginsPermSecretTitle'), body: t('pluginsPermSecretDesc') }
      case 'file':
        return { title: t('pluginsPermFileTitle'), body: t('pluginsPermFileDesc') }
    }
  }
  const sectionTitle = 'mb-2.5 mt-0 text-[12px] font-semibold tracking-wide text-ds-muted'

  return (
    <div className="ds-no-drag fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-black/20" onMouseDown={onClose} />
      <aside role="dialog" aria-modal="true" aria-label={detail.title} className="absolute inset-y-0 right-0 flex w-[460px] max-w-full flex-col border-l border-ds-border bg-ds-card shadow-[0_18px_48px_rgba(32,55,90,0.14)]">
        <div className="flex items-start gap-3.5 border-b border-ds-border-muted px-6 pb-4 pt-[22px]">
          <PluginAvatar id={detail.id} title={detail.title} size={48} />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 break-words text-[19px] font-semibold leading-tight text-ds-ink">{detail.title}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ds-muted">
              <PluginBadge tone={detail.sourceBadge.tone}>{detail.sourceBadge.label}</PluginBadge>
              {detail.categoryLabel ? <span>{detail.categoryLabel}</span> : null}
              {detail.version ? <span>· v{detail.version}</span> : null}
              {detail.originLabel ? <span>· {detail.originLabel}</span> : null}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('pluginsClose')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-[18px]">
          <section>
            <h3 className={sectionTitle}>{t('pluginsDetailIntro')}</h3>
            <p className="m-0 whitespace-pre-line break-words text-[13.5px] leading-[1.65] text-ds-ink">{detail.description || t('pluginsDetailNoDescription')}</p>
          </section>
          {detail.kind === 'mcp' ? (
            <section>
              <h3 className={sectionTitle}>{t('pluginsDetailNeeds', { count: detail.requiredKeys.length })}</h3>
              {detail.requiredKeys.length + detail.optionalKeys.length === 0 ? (
                <p className="m-0 text-[13px] text-ds-muted">{t('pluginsDetailNoKeys')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {[...detail.requiredKeys.map((key) => ({ key, required: true })), ...detail.optionalKeys.map((key) => ({ key, required: false }))].map(({ key, required }) => (
                    <div key={key} className="flex items-center gap-2.5 rounded-[10px] border border-ds-border-muted px-3 py-2.5">
                      <KeyRound className={`h-4 w-4 shrink-0 ${required ? 'text-[#a35a00] dark:text-[#ffc985]' : 'text-ds-muted'}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ds-ink">{key}</span>
                      <PluginBadge tone={required ? 'warn' : 'muted'}>{required ? t('pluginsRequired') : t('pluginsOptional')}</PluginBadge>
                    </div>
                  ))}
                  {detail.requiredKeys.length > 0 ? <p className="m-0 text-[12px] leading-5 text-ds-muted">{t('pluginsDetailNeedsHint')}</p> : null}
                </div>
              )}
            </section>
          ) : null}
          {detail.permissions.length > 0 ? (
            <section>
              <h3 className={sectionTitle}>{t('pluginsDetailCan')}</h3>
              <div className="flex flex-col">
                {detail.permissions.map((permission) => {
                  const Icon = PERMISSION_ICONS[permission]
                  const copy = permissionCopy(permission)
                  return (
                    <div key={permission} className="flex items-start gap-2.5 py-2">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ds-muted" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ds-ink">{copy.title}</div>
                        <div className="break-words text-[12px] leading-5 text-ds-muted">{copy.body}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}
          {detail.launch ? (
            <section>
              <h3 className={sectionTitle}>{detail.remote ? t('pluginsUrl') : t('pluginsDetailLaunch')}</h3>
              <div className="break-all rounded-[10px] bg-ds-subtle px-3 py-2.5 font-mono text-[12px] text-ds-ink">{detail.launch}</div>
              {!detail.remote && detail.kind === 'mcp' ? <p className="mb-0 mt-2 text-[12px] leading-5 text-ds-muted">{t('pluginsDetailPinNote')}</p> : null}
            </section>
          ) : null}
          <section>
            <h3 className={sectionTitle}>{t('pluginsDetailSource')}</h3>
            <p className="m-0 text-[12px] leading-5 text-ds-muted">
              {detail.marketLabel ? t('pluginsDetailMarketNote', { source: detail.marketLabel }) : t('pluginsDetailKunNote')}
            </p>
            {detail.originUrl ? (
              <button type="button" onClick={openOrigin} className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12.5px] font-semibold text-[#3651cf] hover:bg-accent-soft dark:text-[#b7c4ff]">
                <ExternalLink className="h-3.5 w-3.5" />
                {t('pluginsDetailOrigin')}
              </button>
            ) : null}
          </section>
        </div>
        <div className="flex items-center gap-2 border-t border-ds-border-muted px-6 py-3.5">
          <PluginBadge tone="muted">{detail.statusLabel}</PluginBadge>
          <span className="flex-1" />
          <button type="button" className={pluginButton.base} onClick={onClose}>{t('pluginsClose')}</button>
          <button type="button" className={pluginButton.dark} disabled={busy || detail.primaryDisabled} onClick={onPrimary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {detail.primaryLabel}
          </button>
        </div>
      </aside>
    </div>
  )
}
