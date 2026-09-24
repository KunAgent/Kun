import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  RefObject
} from 'react'
import { Download, Plus, Search, X } from 'lucide-react'
import { ProviderIcon } from './provider-icon'
import { SUBSCRIPTION_REGION_TABS } from './settings-section-providers-profile'
import type { SubscriptionRegionFilter } from './settings-section-providers-profile'

type SheetProps = {
  t: (key: string, options?: Record<string, unknown>) => string
  dialogRef: RefObject<HTMLElement | null>
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void
  onClose: () => void
  query: string
  setQuery: (value: string) => void
  onOpenExternalImport: () => void
  importLinkInput: string
  setImportLinkInput: (value: string) => void
  importLinkError: string
  clearImportLinkError: () => void
  onStageImportLink: () => Promise<void>
  onAddCustom: () => void
  onAddDefault: () => void
  showDefaultProviderEntry: boolean
  freeAddEntries: any[]
  planAddEntries: any[]
  apiAddEntries: any[]
  showPlanAddGroup: boolean
  renderAddEntry: (entry: any) => ReactElement
  subscriptionRegion: SubscriptionRegionFilter
  setSubscriptionRegion: (region: SubscriptionRegionFilter) => void
  onRegionTabKeyDown: (
    event: ReactKeyboardEvent,
    id: SubscriptionRegionFilter
  ) => void
}

/**
 * The "add provider" sheet (plan §6.5): searchable preset cards grouped by
 * subscription/plans/api, a custom-provider tile, an external import entry
 * point, and a `kun://import` paste field.
 */
export function ProviderAddSheet(props: SheetProps): ReactElement {
  const {
    t, dialogRef, onKeyDown, onClose, query, setQuery, onOpenExternalImport,
    importLinkInput, setImportLinkInput, importLinkError, clearImportLinkError,
    onStageImportLink, onAddCustom, onAddDefault, showDefaultProviderEntry,
    freeAddEntries, planAddEntries, apiAddEntries, showPlanAddGroup,
    renderAddEntry, subscriptionRegion, setSubscriptionRegion, onRegionTabKeyDown
  } = props
  return (
        <div
          className="ds-no-drag fixed inset-0 z-50 grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-provider-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <section
            ref={dialogRef}
            onKeyDown={onKeyDown}
            className="flex max-h-[min(720px,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
              <div>
                <h2 id="add-provider-dialog-title" className="text-[15px] font-semibold text-ds-ink">
                  {t('modelProviderAddDialogTitle')}
                </h2>
                <p className="mt-1 text-[12.5px] text-ds-faint">{t('modelProviderAddDialogDesc')}</p>
              </div>
              <button
                type="button"
                aria-label={t('modelProviderAddDialogCancel')}
                onClick={onClose}
                className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </header>
            <div className="shrink-0 border-b border-ds-border px-5 py-3">
              <div className="flex items-center gap-2">
                <label className="relative block min-w-0 flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                    strokeWidth={1.9}
                  />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('modelProviderAddDialogSearch')}
                    aria-label={t('modelProviderAddDialogSearch')}
                    className="w-full rounded-xl border border-ds-border bg-ds-card py-2 pl-9 pr-3 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onOpenExternalImport()}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {t('modelProviderImportButton')}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={importLinkInput}
                  onChange={(event) => {
                    setImportLinkInput(event.target.value)
                    if (importLinkError) clearImportLinkError()
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void onStageImportLink()
                  }}
                  placeholder={t('modelProviderPasteLinkPlaceholder')}
                  aria-label={t('modelProviderPasteLinkPlaceholder')}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
                <button
                  type="button"
                  disabled={!importLinkInput.trim()}
                  onClick={() => void onStageImportLink()}
                  className="inline-flex h-8 shrink-0 items-center rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {t('modelProviderPasteLinkButton')}
                </button>
              </div>
              {importLinkError ? (
                <p role="alert" className="mt-1.5 text-[12px] text-red-600 dark:text-red-300">
                  {importLinkError}
                </p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onAddCustom()
                }}
                className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-accent/45 bg-accent/5 px-4 py-3 text-left transition hover:bg-accent/10"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-main/45 text-ds-muted">
                    <ProviderIcon providerId="custom" className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ds-ink">{t('modelProviderAddMenuCustom')}</span>
                    <span className="mt-0.5 block text-[12px] text-ds-faint">{t('modelProviderAddCustomDesc')}</span>
                  </span>
                </span>
                <Plus className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
              </button>
              {showDefaultProviderEntry ? (
                <button
                  type="button"
                  data-testid="provider-add-deepseek"
                  onClick={() => { onClose(); onAddDefault() }}
                  className="mb-4 flex w-full items-center gap-3 rounded-xl border border-ds-border bg-ds-card px-4 py-3 text-left transition hover:bg-ds-hover"
                >
                  <ProviderIcon providerId="deepseek" className="h-5 w-5" />
                  <span className="flex-1 text-[13.5px] font-semibold text-ds-ink">DeepSeek</span>
                  <Plus className="h-4 w-4 text-accent" strokeWidth={2} />
                </button>
              ) : null}
              {freeAddEntries.length > 0 ? (
                <div className="mb-5 grid gap-2">
                  <div className="flex items-center gap-2 px-1">
                    <h3 className="text-[12px] font-semibold text-ds-muted">{t('modelProviderGroupFree')}</h3>
                    <span className="text-[11px] text-ds-faint">{freeAddEntries.length}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">{freeAddEntries.map(renderAddEntry)}</div>
                </div>
              ) : null}
              {showPlanAddGroup ? (
                <div className="mb-5 grid gap-2">
                  <div className="flex flex-wrap items-center gap-2 px-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[12px] font-semibold text-ds-muted">{t('modelProviderGroupPlans')}</h3>
                      <span className="text-[11px] text-ds-faint">{planAddEntries.length}</span>
                    </div>
                    <div
                      role="tablist"
                      aria-label={t('modelProviderSubscriptionRegions')}
                      className="inline-flex items-center rounded-lg border border-ds-border-muted bg-ds-main/70 p-0.5"
                    >
                      {SUBSCRIPTION_REGION_TABS.map((tab) => {
                        const selected = subscriptionRegion === tab.id
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => setSubscriptionRegion(tab.id)}
                            onKeyDown={(event) => onRegionTabKeyDown(event, tab.id)}
                            className={`min-w-12 rounded-md border px-2.5 py-1 text-[11.5px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                              selected
                                ? 'border-accent/25 bg-accent/10 text-accent shadow-sm'
                                : 'border-transparent text-ds-faint hover:bg-ds-card hover:text-ds-muted'
                            }`}
                          >
                            {t(tab.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {planAddEntries.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">{planAddEntries.map(renderAddEntry)}</div>
                  ) : null}
                </div>
              ) : null}
              {apiAddEntries.length > 0 ? (
                <div className="grid gap-2">
                  <div className="flex items-center gap-2 px-1">
                    <h3 className="text-[12px] font-semibold text-ds-muted">{t('modelProviderGroupApi')}</h3>
                    <span className="text-[11px] text-ds-faint">{apiAddEntries.length}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">{apiAddEntries.map(renderAddEntry)}</div>
                </div>
              ) : null}
              {!showDefaultProviderEntry && freeAddEntries.length === 0 && planAddEntries.length === 0 && apiAddEntries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ds-border-muted px-4 py-8 text-center text-[12.5px] text-ds-faint">
                  {t('modelProviderAddDialogEmpty', { query: query.trim() })}
                </p>
              ) : null}
            </div>
          </section>
        </div>
  )
}
