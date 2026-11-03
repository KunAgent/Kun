import type { ReactElement, ReactNode } from 'react'
import { CircleAlert, KeyRound, Loader2, Search } from 'lucide-react'
import type { MarketplaceItem } from '../plugin-marketplace-config'
import { PluginAvatar, PluginBadge, PluginPager, pluginButton, type BadgeTone } from './PluginPrimitives'
import type { PluginPage } from './plugin-pagination'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type CardActionTone = 'soft' | 'done' | 'warn' | 'up'

export type DiscoverCardModel = {
  key: string
  item: MarketplaceItem
  title: string
  description: string
  sourceBadge: { tone: BadgeTone; label: string }
  meta: string
  keyCount: number
  footer: string
  action: { label: string; tone: CardActionTone }
}

export type DiscoverEmpty =
  | { kind: 'query'; query: string; scope: string }
  | { kind: 'filter'; scope: string }
  | { kind: 'unavailable'; source: string; message: string }

function PluginCard({ t, card, busy, onOpen, onAction }: {
  t: Translate
  card: DiscoverCardModel
  busy: boolean
  onOpen: () => void
  onAction: () => void
}): ReactElement {
  return (
    <article className="flex min-h-[156px] flex-col gap-2.5 rounded-[14px] border border-ds-border bg-ds-card px-3.5 pb-3 pt-3.5 transition hover:border-[#c9d2ff] dark:hover:border-[#3e4a78]">
      <div className="flex items-start gap-[11px]">
        <PluginAvatar id={card.item.id} title={card.title} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} title={card.title} className="block max-w-full truncate text-left text-[14px] font-semibold text-ds-ink hover:text-[#3651cf] dark:hover:text-[#b7c4ff]">
            {card.title}
          </button>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px] text-ds-muted">
            <PluginBadge tone={card.sourceBadge.tone}>{card.sourceBadge.label}</PluginBadge>
            {card.meta ? <span className="truncate">{card.meta}</span> : null}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onAction}
          className={`${pluginButton.small} ${pluginButton[card.action.tone]}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {card.action.label}
        </button>
      </div>
      <p className="m-0 line-clamp-2 min-h-[37px] break-words text-[12.5px] leading-[1.5] text-ds-muted">{card.description || t('pluginsDetailNoDescription')}</p>
      <div className="mt-auto flex items-center gap-2.5 border-t border-ds-border-muted pt-2 text-[11.5px] text-ds-muted">
        {card.keyCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-[#a35a00] dark:text-[#ffc985]">
            <KeyRound className="h-3.5 w-3.5" />
            {t('pluginsNeedsKeys', { count: card.keyCount })}
          </span>
        ) : null}
        <span className="truncate">{card.footer}</span>
      </div>
    </article>
  )
}

export function PluginDiscover({
  t,
  toolbar,
  scopeLabel,
  page,
  pageSize,
  compact,
  loading,
  empty,
  busyKey,
  onPage,
  onOpen,
  onAction,
  onClearFilters,
  onOnlyKun,
  onRetry
}: {
  t: Translate
  toolbar: ReactNode
  scopeLabel: string
  page: PluginPage<DiscoverCardModel>
  pageSize: number
  compact: boolean
  loading: boolean
  empty: DiscoverEmpty | null
  busyKey: string | null
  onPage: (page: number) => void
  onOpen: (card: DiscoverCardModel) => void
  onAction: (card: DiscoverCardModel) => void
  onClearFilters: () => void
  onOnlyKun: () => void
  onRetry: () => void
}): ReactElement {
  return (
    <div className="min-w-0">
      {toolbar}
      <div className="mx-0.5 mb-2.5 mt-4 flex items-center justify-between gap-3 text-[12px] text-ds-muted">
        <span className="truncate">{t('pluginsScope', { scope: scopeLabel, count: page.total })}</span>
      </div>
      {loading && page.total === 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3" aria-busy="true">
          {Array.from({ length: compact ? 4 : 6 }, (_, index) => (
            <div key={index} className="flex h-[156px] flex-col gap-2.5 rounded-[14px] border border-ds-border bg-ds-card p-3.5">
              <div className="h-2.5 w-3/5 rounded bg-ds-border-muted" />
              <div className="h-2.5 w-full rounded bg-ds-border-muted" />
              <div className="h-2.5 w-4/5 rounded bg-ds-border-muted" />
            </div>
          ))}
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-ds-subtle px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-ds-border bg-ds-card text-ds-muted">
            {empty.kind === 'unavailable' ? <CircleAlert className="h-5 w-5" /> : <Search className="h-5 w-5" />}
          </span>
          <div className="text-[14px] font-semibold text-ds-ink">
            {empty.kind === 'query' ? t('pluginsEmptySearchTitle', { query: empty.query })
              : empty.kind === 'filter' ? t('pluginsEmptyFilterTitle')
                : t('pluginsMarketUnavailableTitle', { source: empty.source })}
          </div>
          <div className="max-w-[420px] break-words text-[12px] text-ds-muted">
            {empty.kind === 'unavailable' ? empty.message : t('pluginsEmptyScope', { scope: empty.scope })}
          </div>
          {empty.kind === 'unavailable' ? (
            <div className="mt-1 flex gap-2">
              <button type="button" className={pluginButton.dark} onClick={onRetry}>{t('pluginsRetry')}</button>
              <button type="button" className={pluginButton.base} onClick={onOnlyKun}>{t('pluginsOnlyKun')}</button>
            </div>
          ) : (
            <button type="button" className={`${pluginButton.base} mt-1`} onClick={onClearFilters}>{t('pluginsClearFilters')}</button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
          {page.items.map((card) => (
            <PluginCard key={card.key} t={t} card={card} busy={busyKey === card.key} onOpen={() => onOpen(card)} onAction={() => onAction(card)} />
          ))}
        </div>
      )}
      <PluginPager
        t={t}
        page={page.page}
        pageCount={page.pageCount}
        start={page.start}
        end={page.end}
        total={page.total}
        pageSize={pageSize}
        compact={compact}
        onPage={onPage}
      />
    </div>
  )
}
