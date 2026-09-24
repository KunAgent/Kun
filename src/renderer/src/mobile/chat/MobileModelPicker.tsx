import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ImageIcon, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import './mobile-model-picker.css'

/** Providers with more models than this get a search box. */
export const MOBILE_MODEL_SEARCH_THRESHOLD = 8

type PickerModel = {
  id: string
  label: string
  contextLabel: string
  imageInput: boolean
}

type PickerProvider = {
  id: string
  label: string
  models: PickerModel[]
}

/** 131072 → "128K", 1000000 → "1M". */
export function formatContextWindow(tokens: number | undefined): string {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return ''
  if (tokens >= 1_000_000) {
    // One decimal, dropped when it rounds away (1,048,576 → "1M", 2.5M stays).
    return `${Number((tokens / 1_000_000).toFixed(1))}M`
  }
  return `${Math.round(tokens / 1024)}K`
}

function providersFrom(groups: ModelProviderModelGroup[], fallbackIds: string[]): PickerProvider[] {
  if (groups.length === 0) {
    return fallbackIds.length
      ? [{ id: '', label: '', models: fallbackIds.map((id) => ({ id, label: id, contextLabel: '', imageInput: false })) }]
      : []
  }
  return groups.map((group) => ({
    id: group.providerId,
    label: group.label || group.providerId,
    models: group.modelIds.map((id) => {
      const profile = group.modelProfiles?.[id]
      return {
        id,
        label: profile?.aliases?.[0] || id,
        contextLabel: formatContextWindow(profile?.contextWindowTokens),
        imageInput: profile?.inputModalities?.includes('image') === true
      }
    })
  }))
}

/** The provider to show first: the explicit provider, else the one listing the model. */
export function initialPickerProvider(
  providers: Array<{ id: string; models: Array<{ id: string }> }>,
  providerId: string,
  model: string
): string {
  if (providerId && providers.some((provider) => provider.id === providerId)) return providerId
  const owner = providers.find((provider) => provider.models.some((entry) => entry.id === model))
  return owner?.id ?? providers[0]?.id ?? ''
}

/**
 * Two-step model picker for phone sheets: pick a provider from a horizontally
 * scrolling chip row, then a model from that provider's list. Large catalogs
 * get a search box, the current model scrolls into view, and each row shows
 * the alias, raw id, context window and image-input capability.
 */
export function MobileModelPicker({ model, providerId, groups, fallbackIds, onChange }: {
  model: string
  providerId: string
  groups: ModelProviderModelGroup[]
  fallbackIds: string[]
  onChange: (model: string, providerId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('common')
  const providers = useMemo(() => providersFrom(groups, fallbackIds), [groups, fallbackIds])
  const [activeProvider, setActiveProvider] = useState(() => initialPickerProvider(providers, providerId, model))
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  // Follow an external selection change (another sheet, a thread switch) and
  // recover when the active provider disappears from the catalog.
  useEffect(() => {
    setActiveProvider((current) => {
      const selectedOwner = initialPickerProvider(providers, providerId, model)
      if (!providers.some((provider) => provider.id === current)) return selectedOwner
      return current
    })
  }, [model, providerId, providers])
  useEffect(() => { setQuery('') }, [activeProvider])

  const provider = providers.find((entry) => entry.id === activeProvider) ?? providers[0]
  const selectedProvider = initialPickerProvider(providers, providerId, model)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleModels = useMemo(() => {
    const models = provider?.models ?? []
    if (!normalizedQuery) return models
    return models.filter((entry) =>
      entry.id.toLowerCase().includes(normalizedQuery) || entry.label.toLowerCase().includes(normalizedQuery))
  }, [normalizedQuery, provider])

  // Bring the selected model into view when its provider's list is shown.
  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
    selected?.scrollIntoView?.({ block: 'nearest' })
  }, [activeProvider])

  if (!provider) {
    return <p className="kun-mobile-hint">{t('mobileModelNone')}</p>
  }
  const showProviders = providers.length > 1
  const showSearch = provider.models.length > MOBILE_MODEL_SEARCH_THRESHOLD

  return (
    <div className="kun-mobile-model-picker">
      {showProviders ? (
        <div className="kun-mobile-provider-chips" role="tablist" aria-label={t('mobileModelProvider')}>
          {providers.map((entry) => {
            const active = entry.id === provider.id
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-has-selection={entry.id === selectedProvider && Boolean(model) ? 'true' : undefined}
                onClick={() => setActiveProvider(entry.id)}
              >
                <span className="kun-mobile-provider-chip-label">{entry.label}</span>
                <span className="kun-mobile-provider-chip-count">{entry.models.length}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {showSearch ? (
        <label className="kun-mobile-model-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('mobileModelSearch', { count: provider.models.length })}
            aria-label={t('mobileModelSearch', { count: provider.models.length })}
          />
        </label>
      ) : null}
      <ul className="kun-mobile-model-list" ref={listRef} role="listbox" aria-label={provider.label || t('composerModel')}>
        {visibleModels.map((entry) => {
          const selected = entry.id === model && provider.id === selectedProvider
          return (
            <li key={entry.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-pressed={selected}
                onClick={() => onChange(entry.id, provider.id)}
              >
                <span className="kun-mobile-model-text">
                  <span className="kun-mobile-model-name">{entry.label}</span>
                  {entry.label !== entry.id || entry.contextLabel || entry.imageInput ? (
                    <span className="kun-mobile-model-meta">
                      {entry.label !== entry.id ? <span data-mono>{entry.id}</span> : null}
                      {entry.contextLabel ? <span>{entry.contextLabel}</span> : null}
                      {entry.imageInput ? (
                        <span className="kun-mobile-model-cap" title={t('mobileModelImageInput')}>
                          <ImageIcon size={12} aria-hidden />{t('mobileModelImageInput')}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                {selected ? <Check size={18} aria-hidden className="kun-mobile-model-check" /> : null}
              </button>
            </li>
          )
        })}
        {visibleModels.length === 0 ? (
          <li className="kun-mobile-model-empty">{t('mobileModelNoMatch')}</li>
        ) : null}
      </ul>
    </div>
  )
}
