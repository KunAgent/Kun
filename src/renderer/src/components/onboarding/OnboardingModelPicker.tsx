import { useState, type ReactElement } from 'react'
import { Link2, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ProviderIcon } from '../provider-icon'
import {
  onboardingProviderCount,
  onboardingTabCounts,
  onboardingTabEntries,
  searchOnboardingProviders,
  type OnboardingProviderEntry,
  type OnboardingProviderTab,
  type OnboardingRegionFilter
} from './onboarding-provider-catalog'

export type OnboardingPickerState = {
  tab: OnboardingProviderTab
  region: OnboardingRegionFilter
  query: string
}

const TABS: readonly OnboardingProviderTab[] = ['featured', 'api', 'plan', 'login', 'local']
const REGIONS: ReadonlyArray<{ id: OnboardingRegionFilter; key: string }> = [
  { id: 'all', key: 'all' },
  { id: 'china', key: 'china' },
  { id: 'united-states', key: 'unitedStates' }
]

/** Brand tints for the three providers the guide has always featured. */
export function onboardingProviderTint(presetId: string): string | undefined {
  return presetId === 'deepseek' || presetId === 'xiaomi' || presetId === 'minimax' ? presetId : undefined
}

function entryTag(entry: OnboardingProviderEntry): { kind: string; key: string } | null {
  if (entry.connect === 'login' || entry.tab === 'login') return { kind: 'login', key: 'login' }
  if (entry.connect === 'local') return { kind: 'local', key: 'local' }
  if (entry.tab === 'plan') return { kind: 'plan', key: 'plan' }
  if (entry.speech) return { kind: 'speech', key: 'speech' }
  if (entry.image) return { kind: 'image', key: 'image' }
  return null
}

export function OnboardingProviderGlyph({ entry, size = 18 }: { entry: Pick<OnboardingProviderEntry, 'presetId'>; size?: number }): ReactElement {
  return entry.presetId === 'deepseek'
    ? <ProviderIcon providerId="deepseek" size={size} aria-hidden="true" />
    : <ProviderIcon presetId={entry.presetId} size={size} aria-hidden="true" />
}

export function OnboardingModelPicker({ state, selectedId, customSelected, onState, onSelect, onConfirm, onCustom, onImport }: {
  state: OnboardingPickerState
  selectedId: string
  customSelected: boolean
  onState: (patch: Partial<OnboardingPickerState>) => void
  onSelect: (entry: OnboardingProviderEntry) => void
  onConfirm: () => void
  onCustom: () => void
  /** Returns an error message, or null after the link was applied. */
  onImport: (link: string) => string | null
}): ReactElement {
  const { t, i18n } = useTranslation('settings')
  const [importOpen, setImportOpen] = useState(false)
  const [importLink, setImportLink] = useState('')
  const [importError, setImportError] = useState('')
  const counts = onboardingTabCounts()
  const query = state.query.trim()
  const entries = query ? searchOnboardingProviders(query) : onboardingTabEntries(state.tab, state.region)
  const noteFor = (entry: OnboardingProviderEntry): string => {
    const key = `onboarding.model.notes.${entry.id.replace(':', '_')}`
    return i18n.exists(key, { ns: 'settings' }) ? t(key) : entry.note
  }
  return (
    <>
      <label className="kun-onb-search">
        <Search size={16} strokeWidth={1.9} aria-hidden="true" />
        <input
          type="search"
          value={state.query}
          onChange={(event) => onState({ query: event.target.value })}
          placeholder={t('onboarding.model.searchPlaceholder', { count: onboardingProviderCount() })}
          aria-label={t('onboarding.model.searchLabel')}
          data-onboarding-provider-search
        />
      </label>

      {query ? null : (
        <div className="kun-onb-tabs-row">
          <div className="kun-onb-tabs" role="tablist" aria-label={t('onboarding.model.tabsLabel')}>
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={state.tab === tab}
                className="kun-onb-tab"
                onClick={() => onState({ tab })}
                data-onboarding-provider-tab={tab}
              >
                {t(`onboarding.model.tabs.${tab}`)}<small>{counts[tab]}</small>
              </button>
            ))}
          </div>
          {state.tab === 'plan' ? (
            <div className="kun-onb-region" role="group" aria-label={t('onboarding.model.regionsLabel')}>
              {REGIONS.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  aria-pressed={state.region === region.id}
                  onClick={() => onState({ region: region.id })}
                >
                  {t(`onboarding.model.regions.${region.key}`)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {entries.length ? (
        <div className="kun-onb-providers" role="radiogroup" aria-label={t('onboarding.model.tabsLabel')}>
          {entries.map((entry, index) => {
            const on = !customSelected && entry.id === selectedId
            const tag = entryTag(entry)
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? 'kun-onb-provider is-on' : 'kun-onb-provider'}
                style={{ animationDelay: `${Math.min(index * 0.025, 0.3)}s` }}
                onClick={() => onSelect(entry)}
                onDoubleClick={() => { onSelect(entry); onConfirm() }}
                data-onboarding-provider={entry.id}
              >
                <span className="kun-onb-provider-icon" data-tint={onboardingProviderTint(entry.presetId)}>
                  <OnboardingProviderGlyph entry={entry} />
                </span>
                <span className="kun-onb-provider-text">
                  <span className="kun-onb-provider-title">
                    <span className="kun-onb-provider-name">{entry.name}</span>
                    {tag ? <span className="kun-onb-provider-tag" data-kind={tag.kind}>{t(`onboarding.model.tags.${tag.key}`)}</span> : null}
                  </span>
                  <span className="kun-onb-provider-note">{noteFor(entry)}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="kun-onb-empty-search">{t('onboarding.model.noResults', { query })}</p>
      )}

      <div className="kun-onb-provider-extra">
        <button
          type="button"
          className={customSelected ? 'kun-onb-add is-on' : 'kun-onb-add'}
          aria-pressed={customSelected}
          onClick={onCustom}
          data-onboarding-provider="custom"
        >
          <Plus size={18} strokeWidth={1.9} aria-hidden="true" />
          <span><b>{t('onboarding.model.custom')}</b><small>{t('onboarding.model.customDesc')}</small></span>
        </button>
        <button
          type="button"
          className="kun-onb-add"
          aria-expanded={importOpen}
          onClick={() => { setImportOpen((open) => !open); setImportError('') }}
        >
          <Link2 size={18} strokeWidth={1.9} aria-hidden="true" />
          <span><b>{t('onboarding.model.import')}</b><small>{t('onboarding.model.importDesc')}</small></span>
        </button>
      </div>
      {importOpen ? (
        <div>
          <div className="kun-onb-import">
            <div className="kun-onb-field" data-invalid={importError ? 'true' : undefined}>
              <span className="kun-onb-field-lead"><Link2 size={16} strokeWidth={1.8} aria-hidden="true" /></span>
              <input
                value={importLink}
                onChange={(event) => { setImportLink(event.target.value); setImportError('') }}
                placeholder="kun://import?…"
                aria-label={t('onboarding.model.import')}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <button
              type="button"
              className="kun-onb-btn is-accent"
              style={{ height: 48 }}
              disabled={!importLink.trim()}
              onClick={() => {
                const error = onImport(importLink)
                if (error) setImportError(error)
                else { setImportOpen(false); setImportLink('') }
              }}
            >
              {t('onboarding.model.importApply')}
            </button>
          </div>
          {importError ? <p className="kun-onb-hint" data-tone="danger" role="alert">{importError}</p> : null}
        </div>
      ) : null}
    </>
  )
}
