import { useMemo, useState, type ReactElement } from 'react'
import { Check, Search, X } from 'lucide-react'
import type { ModelProviderProfileV1 } from '@shared/app-settings'
import {
  PROVIDER_MODEL_KINDS,
  classifyProviderModelIds,
  providerModelListEntries,
  type ProviderModelIdGroups,
  type ProviderModelKind
} from './provider-model-editor'

type Translate = (key: string, params?: Record<string, unknown>) => string

const KIND_LABEL_KEYS: Record<ProviderModelKind, string> = {
  chat: 'providerModelKindChat',
  image: 'providerModelKindImage',
  speech: 'providerModelKindSpeech',
  tts: 'providerModelKindTts',
  music: 'providerModelKindMusic',
  video: 'providerModelKindVideo'
}

type FetchedEntry = {
  modelId: string
  kind: ProviderModelKind
  alreadyExists: boolean
}

export type ProviderModelImportResult = {
  chat: string[]
  image: string[]
  speech: string[]
  tts: string[]
  music: string[]
  video: string[]
}

function entryKey(kind: ProviderModelKind, modelId: string): string {
  return `${kind}${modelId}`
}

function existingKeysFor(provider: ModelProviderProfileV1): Set<string> {
  const existing = new Set<string>()
  for (const { kind, modelId } of providerModelListEntries(provider)) {
    existing.add(entryKey(kind, modelId.trim().toLowerCase()))
  }
  return existing
}

function buildEntries(
  provider: ModelProviderProfileV1,
  groups: ProviderModelIdGroups
): FetchedEntry[] {
  const existing = existingKeysFor(provider)
  const out: FetchedEntry[] = []
  for (const kind of PROVIDER_MODEL_KINDS) {
    for (const modelId of groups[kind]) {
      const trimmed = modelId.trim()
      if (!trimmed) continue
      out.push({
        modelId: trimmed,
        kind,
        alreadyExists: existing.has(entryKey(kind, trimmed.toLowerCase()))
      })
    }
  }
  return out
}

export function ProviderModelImportDialog({
  provider,
  fetchedModelIds,
  t,
  onCancel,
  onConfirm
}: {
  provider: ModelProviderProfileV1
  fetchedModelIds: readonly string[]
  t: Translate
  onCancel: () => void
  onConfirm: (result: ProviderModelImportResult) => void
}): ReactElement {
  const groups = useMemo(() => classifyProviderModelIds(provider, fetchedModelIds), [provider, fetchedModelIds])
  const entries = useMemo(() => buildEntries(provider, groups), [provider, groups])

  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<ProviderModelKind | 'all'>('all')
  const [hideExisting, setHideExisting] = useState(true)

  // Default selection: every fresh model. Skips duplicates by default so user
  // doesn't have to uncheck N already-known IDs.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const seed = new Set<string>()
    for (const entry of entries) {
      if (!entry.alreadyExists) seed.add(entryKey(entry.kind, entry.modelId))
    }
    return seed
  })

  const normalizedQuery = query.trim().toLowerCase()
  const visibleEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
        if (hideExisting && entry.alreadyExists) return false
        if (normalizedQuery && !entry.modelId.toLowerCase().includes(normalizedQuery)) return false
        return true
      }),
    [entries, kindFilter, hideExisting, normalizedQuery]
  )

  const kindCounts = useMemo(() => {
    const counts: Record<ProviderModelKind, number> = {
      chat: 0, image: 0, speech: 0, tts: 0, music: 0, video: 0
    }
    for (const entry of entries) counts[entry.kind] += 1
    return counts
  }, [entries])

  const existingCount = useMemo(
    () => entries.reduce((n, e) => (e.alreadyExists ? n + 1 : n), 0),
    [entries]
  )

  const toggleOne = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAllVisible = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const entry of visibleEntries) next.add(entryKey(entry.kind, entry.modelId))
      return next
    })
  }

  const clearVisible = (): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const entry of visibleEntries) next.delete(entryKey(entry.kind, entry.modelId))
      return next
    })
  }

  const handleConfirm = (): void => {
    const result: ProviderModelImportResult = {
      chat: [], image: [], speech: [], tts: [], music: [], video: []
    }
    for (const entry of entries) {
      if (selected.has(entryKey(entry.kind, entry.modelId))) {
        result[entry.kind].push(entry.modelId)
      }
    }
    onConfirm(result)
  }

  const totalSelected = selected.size
  const allVisibleSelected =
    visibleEntries.length > 0 &&
    visibleEntries.every((entry) => selected.has(entryKey(entry.kind, entry.modelId)))

  const filterChipClass = (active: boolean): string =>
    [
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
      <section className="grid w-full max-w-2xl grid-rows-[auto_auto_1fr_auto] gap-0 rounded-2xl border border-ds-border bg-ds-card shadow-panel">
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
              onChange={(e) => setQuery(e.target.value)}
            />
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
                  onChange={(e) => setHideExisting(e.target.checked)}
                />
                {t('providerModelImportHideExisting', { count: existingCount })}
              </label>
            ) : null}
          </div>
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-3">
          {visibleEntries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-6 text-center text-[12.5px] text-ds-faint">
              {entries.length === 0
                ? t('providerModelImportNoneFetched')
                : t('providerModelImportNoneMatch')}
            </p>
          ) : (
            <ul className="grid gap-1">
              {visibleEntries.map((entry) => {
                const key = entryKey(entry.kind, entry.modelId)
                const checked = selected.has(key)
                return (
                  <li key={key}>
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition ${
                        checked
                          ? 'border-accent/40 bg-ds-main/35'
                          : 'border-ds-border bg-ds-card hover:bg-ds-hover'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={checked}
                        onChange={() => toggleOne(key)}
                      />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="truncate font-mono text-[13px] text-ds-ink">{entry.modelId}</span>
                        <span className="flex flex-wrap items-center gap-1 text-[11px] text-ds-faint">
                          <span className="rounded-full bg-ds-main/40 px-1.5 py-0.5">
                            {t(KIND_LABEL_KEYS[entry.kind])}
                          </span>
                          {entry.alreadyExists ? (
                            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                              {t('providerModelImportAlreadyAdded')}
                            </span>
                          ) : null}
                        </span>
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
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 items-center rounded-full border border-ds-border bg-ds-card px-3.5 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('providerModelImportCancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={totalSelected === 0}
              className="inline-flex h-8 items-center rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('providerModelImportConfirm', { count: totalSelected })}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
