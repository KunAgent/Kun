import { useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, Check, Info, Loader2, Search, X } from 'lucide-react'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import type {
  ModelsDevCatalogMetadataIssue,
  ModelsDevCatalogResult,
  ProviderModelCatalogSource
} from '@shared/kun-gui-api'
import {
  PROVIDER_MODEL_KINDS,
  describeContextWindowTokens,
  type ProviderModelKind
} from './provider-model-editor'
import {
  buildProviderModelImportEntries,
  defaultSelectedProviderModelImportKeys,
  providerModelImportEntryCanEnrich,
  providerModelImportEntryKey,
  providerModelImportResult,
  type ProviderModelImportResult
} from './provider-model-import'

export type { ProviderModelImportResult } from './provider-model-import'

type Translate = (key: string, params?: Record<string, unknown>) => string
type SourceFilter = ProviderModelCatalogSource | 'all'

const KIND_LABEL_KEYS: Record<ProviderModelKind, string> = {
  chat: 'providerModelKindChat',
  image: 'providerModelKindImage',
  speech: 'providerModelKindSpeech',
  tts: 'providerModelKindTts',
  music: 'providerModelKindMusic',
  video: 'providerModelKindVideo'
}

export function ProviderModelImportDialog({
  provider,
  providerModelIds,
  catalogResult,
  providerError,
  authoritative = false,
  t,
  onCancel,
  onConfirm
}: {
  provider: ModelProviderProfileV1
  providerModelIds: readonly string[]
  catalogResult: ModelsDevCatalogResult
  providerError?: string
  authoritative?: boolean
  t: Translate
  onCancel: () => void
  onConfirm: (result: ProviderModelImportResult) => Promise<void>
}): ReactElement {
  const entries = useMemo(
    () => buildProviderModelImportEntries(provider, providerModelIds, catalogResult),
    [provider, providerModelIds, catalogResult]
  )
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<ProviderModelKind | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [hideExisting, setHideExisting] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => defaultSelectedProviderModelImportKeys(entries, authoritative)
  )

  const normalizedQuery = query.trim().toLowerCase()
  const visibleEntries = useMemo(
    () => entries.filter((entry) => {
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
      if (sourceFilter !== 'all' && !entry.sources.includes(sourceFilter)) return false
      if (hideExisting && entry.alreadyExists) return false
      if (normalizedQuery) {
        const searchable = `${entry.modelId} ${entry.catalog?.name ?? ''} ${entry.catalog?.description ?? ''}`
          .toLowerCase()
        if (!searchable.includes(normalizedQuery)) return false
      }
      return true
    }),
    [entries, hideExisting, kindFilter, normalizedQuery, sourceFilter]
  )

  const kindCounts = useMemo(() => {
    const counts: Record<ProviderModelKind, number> = {
      chat: 0, image: 0, speech: 0, tts: 0, music: 0, video: 0
    }
    for (const entry of entries) counts[entry.kind] += 1
    return counts
  }, [entries])
  const sourceCounts = useMemo(() => ({
    'provider-api': entries.filter((entry) => entry.sources.includes('provider-api')).length,
    'models-dev': entries.filter((entry) => entry.sources.includes('models-dev')).length
  }), [entries])
  const existingCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.alreadyExists ? 1 : 0), 0),
    [entries]
  )
  const metadataIssueCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.catalog?.metadataIssues?.length ?? 0), 0),
    [entries]
  )

  const toggleOne = (key: string): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const selectAllVisible = (): void => {
    setSelected((previous) => {
      const next = new Set(previous)
      for (const entry of visibleEntries) {
        next.add(providerModelImportEntryKey(entry.kind, entry.modelId))
      }
      return next
    })
  }
  const clearVisible = (): void => {
    setSubmitError('')
    setSelected((previous) => {
      const next = new Set(previous)
      for (const entry of visibleEntries) {
        next.delete(providerModelImportEntryKey(entry.kind, entry.modelId))
      }
      return next
    })
  }

  const submit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await onConfirm(providerModelImportResult(entries, selected))
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const totalSelected = selected.size
  const existingMetadataCount = entries.filter((entry) =>
    providerModelImportEntryCanEnrich(provider, entry)
  ).length
  const allVisibleSelected = visibleEntries.length > 0 && visibleEntries.every((entry) =>
    selected.has(providerModelImportEntryKey(entry.kind, entry.modelId))
  )
  const filterChipClass = (active: boolean): string => [
    'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition',
    active
      ? 'border-accent/60 bg-ds-main/45 text-ds-ink ring-1 ring-accent/30'
      : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
  ].join(' ')

  return (
    <div
      className="ds-no-drag fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label={t('providerModelImportTitle')}
    >
      <section className="grid max-h-[calc(100vh-2rem)] w-full max-w-3xl grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-panel">
        <header className="flex items-start justify-between gap-3 border-b border-ds-border px-5 py-4">
          <div className="grid gap-1">
            <h2 className="text-[15px] font-semibold text-ds-ink">{t('providerModelImportTitle')}</h2>
            <p className="text-[12.5px] text-ds-faint">
              {t('providerModelImportSubtitle', {
                provider: provider.name,
                total: entries.length,
                existing: existingCount
              })}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('providerModelImportCancel')}
            onClick={onCancel}
            className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </header>

        <div className="grid gap-2.5 border-b border-ds-border px-5 py-3">
          {submitError ? (
            <ImportNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {t('providerModelImportSubmitFailed', { message: submitError })}
            </ImportNotice>
          ) : null}
          {providerError ? (
            <ImportNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {t('providerModelImportProviderWarning', { message: providerError })}
            </ImportNotice>
          ) : null}
          {metadataIssueCount > 0 ? (
            <ImportNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {t('providerModelImportMetadataIgnored', { count: metadataIssueCount })}
            </ImportNotice>
          ) : null}
          {catalogResult.status === 'error' ? (
            <ImportNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {t('providerModelImportCatalogError', { message: catalogResult.message })}
            </ImportNotice>
          ) : catalogResult.status === 'unmapped' ? (
            <ImportNotice tone="info" icon={<Info className="h-3.5 w-3.5" />}>
              {t('providerModelImportCatalogUnmapped')}
            </ImportNotice>
          ) : catalogResult.stale ? (
            <ImportNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              {t('providerModelImportCatalogStale')}
            </ImportNotice>
          ) : null}

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
              strokeWidth={1.9}
            />
            <input
              className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card py-2 pl-9 pr-3 text-[13px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
              value={query}
              placeholder={t('providerModelImportSearchPlaceholder')}
              aria-label={t('providerModelImportSearchPlaceholder')}
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={sourceFilter === 'all'}
              onClick={() => setSourceFilter('all')}
              className={filterChipClass(sourceFilter === 'all')}
            >
              {t('providerModelImportSourceAll', { count: entries.length })}
            </button>
            <button
              type="button"
              aria-pressed={sourceFilter === 'provider-api'}
              onClick={() => setSourceFilter('provider-api')}
              className={filterChipClass(sourceFilter === 'provider-api')}
            >
              {t('providerModelImportSourceApi', { count: sourceCounts['provider-api'] })}
            </button>
            <button
              type="button"
              aria-pressed={sourceFilter === 'models-dev'}
              onClick={() => setSourceFilter('models-dev')}
              className={filterChipClass(sourceFilter === 'models-dev')}
            >
              {t('providerModelImportSourceCatalog', { count: sourceCounts['models-dev'] })}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-pressed={kindFilter === 'all'}
              onClick={() => setKindFilter('all')}
              className={filterChipClass(kindFilter === 'all')}
            >
              {t('providerModelImportFilterAll', { count: entries.length })}
            </button>
            {PROVIDER_MODEL_KINDS.map((kind) => {
              const count = kindCounts[kind]
              if (count === 0) return null
              const active = kindFilter === kind
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKindFilter(kind)}
                  className={filterChipClass(active)}
                >
                  {`${t(KIND_LABEL_KEYS[kind])} · ${count}`}
                </button>
              )
            })}
            {existingCount > 0 ? (
              <label className={`${filterChipClass(hideExisting)} cursor-pointer`}>
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-accent"
                  checked={hideExisting}
                  onChange={(event) => setHideExisting(event.target.checked)}
                />
                {t('providerModelImportHideExisting', { count: existingCount })}
              </label>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-3">
          {visibleEntries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-6 text-center text-[12.5px] text-ds-faint">
              {entries.length === 0
                ? t('providerModelImportNoneFetched')
                : t('providerModelImportNoneMatch')}
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {visibleEntries.map((entry) => {
                const key = providerModelImportEntryKey(entry.kind, entry.modelId)
                const checked = selected.has(key)
                const sourceLabel = entry.sources.length === 2
                  ? t('providerModelImportSourceBothBadge')
                  : entry.sources[0] === 'provider-api'
                    ? t('providerModelImportSourceApiBadge')
                    : t('providerModelImportSourceCatalogBadge')
                return (
                  <li key={key}>
                    <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                      checked
                        ? 'border-accent/40 bg-ds-main/35'
                        : 'border-ds-border bg-ds-card hover:bg-ds-hover'
                    }`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-accent"
                        checked={checked}
                        onChange={() => toggleOne(key)}
                      />
                      <span className="grid min-w-0 flex-1 gap-1">
                        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="truncate font-mono text-[13px] text-ds-ink">{entry.modelId}</span>
                          {entry.catalog?.name && entry.catalog.name.toLowerCase() !== entry.modelId.toLowerCase() ? (
                            <span className="truncate text-[12px] font-medium text-ds-muted">{entry.catalog.name}</span>
                          ) : null}
                        </span>
                        {entry.catalog?.description ? (
                          <span className="line-clamp-2 text-[11.5px] leading-4 text-ds-faint">
                            {entry.catalog.description}
                          </span>
                        ) : null}
                        <span className="flex flex-wrap items-center gap-1 text-[11px] text-ds-faint">
                          <ModelBadge>{t(KIND_LABEL_KEYS[entry.kind])}</ModelBadge>
                          <ModelBadge tone={entry.sources.length === 2 ? 'accent' : 'muted'}>{sourceLabel}</ModelBadge>
                          {entry.alreadyExists ? (
                            <ModelBadge tone="warning">{t('providerModelImportAlreadyAdded')}</ModelBadge>
                          ) : null}
                          {entry.catalog?.metadataIssues?.length ? (
                            <ModelBadge tone="warning">{t('providerModelImportMetadataIssueBadge')}</ModelBadge>
                          ) : null}
                          {entry.catalog?.contextWindowTokens ? (
                            <ModelBadge>{t('providerModelImportContextBadge', {
                              value: describeContextWindowTokens(entry.catalog.contextWindowTokens)
                            })}</ModelBadge>
                          ) : null}
                          {entry.catalog?.maxOutputTokens ? (
                            <ModelBadge>{t('providerModelImportOutputBadge', {
                              value: describeContextWindowTokens(entry.catalog.maxOutputTokens)
                            })}</ModelBadge>
                          ) : null}
                          {entry.catalog?.inputModalities.includes('image') ? (
                            <ModelBadge tone="accent">{t('providerModelImportVisionBadge')}</ModelBadge>
                          ) : null}
                          {entry.catalog?.inputModalities.includes('audio') ? (
                            <ModelBadge tone="accent">{t('providerModelImportAudioInputBadge')}</ModelBadge>
                          ) : null}
                          {entry.catalog?.toolCalling === true ? (
                            <ModelBadge tone="accent">{t('providerModelImportToolsBadge')}</ModelBadge>
                          ) : entry.catalog?.toolCalling === false ? (
                            <ModelBadge tone="warning">{t('providerModelImportNoToolsBadge')}</ModelBadge>
                          ) : null}
                          {entry.catalog?.reasoning ? (
                            <ModelBadge tone="accent">{t('providerModelImportReasoningBadge')}</ModelBadge>
                          ) : null}
                        </span>
                        {entry.catalog?.metadataIssues?.map((issue) => (
                          <span key={issue.field} className="text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                            {metadataIssueMessage(t, issue)}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-ds-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={allVisibleSelected ? clearVisible : selectAllVisible}
              disabled={visibleEntries.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-3 w-3" strokeWidth={2} />
              {allVisibleSelected
                ? t('providerModelImportClearVisible')
                : t('providerModelImportSelectAllVisible', { count: visibleEntries.length })}
            </button>
            <span className="text-[12px] text-ds-faint">
              {t('providerModelImportSelectedCount', { count: totalSelected })}
            </span>
            {existingMetadataCount > 0 ? (
              <span className="text-[12px] text-ds-faint">
                {t('providerModelImportMetadataUpdates', { count: existingMetadataCount })}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex h-8 items-center rounded-full border border-ds-border bg-ds-card px-3.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('providerModelImportCancel')}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || (totalSelected === 0 && existingMetadataCount === 0)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                  {t('providerModelImportSubmitting')}
                </>
              ) : totalSelected > 0
                ? t('providerModelImportConfirm', { count: totalSelected })
                : existingMetadataCount > 0
                  ? t('providerModelImportApplyMetadata')
                  : t('providerModelImportConfirm', { count: 0 })}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function metadataIssueMessage(t: Translate, issue: ModelsDevCatalogMetadataIssue): string {
  return t('providerModelImportMetadataIssueDetail', {
    field: t(issue.field === 'maxOutputTokens'
      ? 'providerModelFieldMaxOutput'
      : 'providerModelFieldContextWindow'),
    value: issue.rawValue.toLocaleString(),
    max: issue.maxAllowed.toLocaleString()
  })
}

function ImportNotice({
  tone,
  icon,
  children
}: {
  tone: 'info' | 'warning'
  icon: ReactElement
  children: string
}): ReactElement {
  return (
    <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-4 ${
      tone === 'warning'
        ? 'border-amber-400/35 bg-amber-400/10 text-amber-800 dark:text-amber-200'
        : 'border-sky-400/30 bg-sky-400/10 text-sky-800 dark:text-sky-200'
    }`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  )
}

function ModelBadge({
  tone = 'muted',
  children
}: {
  tone?: 'muted' | 'accent' | 'warning'
  children: string
}): ReactElement {
  const toneClass = tone === 'accent'
    ? 'bg-accent/10 text-accent'
    : tone === 'warning'
      ? 'bg-amber-400/15 text-amber-700 dark:text-amber-300'
      : 'bg-ds-main/45 text-ds-faint'
  return <span className={`rounded-full px-1.5 py-0.5 ${toneClass}`}>{children}</span>
}
