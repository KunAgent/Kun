import { useState, type ReactElement, type ReactNode } from 'react'
import { ArrowLeftRight, ArrowUpRight, ChevronRight, Eye, EyeOff, Globe, KeyRound, MonitorSmartphone, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_MODEL_PROVIDER_ID, defaultModelProviderSettings, type ModelEndpointFormat } from '@shared/app-settings'
import { ClaudeSubscriptionSection } from '../claude-subscription-section'
import { CodexLoginSection } from '../settings-section-providers-codex-login'
import { GeminiCliApiSubscriptionSection, GeminiSubscriptionSection } from '../settings-section-providers-gemini'
import { GrokLoginSection } from '../settings-section-providers-grok-login'
import { antigravityProviderCatalogPatch, geminiCliApiCatalogPatch } from '../settings-section-providers-profile'
import {
  initialSetupDraftProfile,
  presetForInitialSetup,
  type InitialSetupAccessMode,
  type InitialSetupDraft
} from '../initial-setup-save'
import { OnboardingProviderGlyph, onboardingProviderTint } from './OnboardingModelPicker'
import {
  onboardingChatModels,
  onboardingEndpointHint,
  onboardingEntryHasModels,
  onboardingEntryRegions,
  onboardingKeyHintKey,
  onboardingKeyPageUrl,
  onboardingKeyPlaceholder,
  type OnboardingConfigureIssue,
  type OnboardingProviderEntry
} from './onboarding-provider-catalog'

const KNOWN_REGION_IDS = new Set(['cn', 'global', 'sgp', 'ams'])
const ENDPOINT_FORMATS: readonly ModelEndpointFormat[] = ['chat_completions', 'messages', 'responses']

type Discovery = { status: 'idle' | 'busy' | 'ok' | 'error'; count?: number; message?: string }

function openExternal(url: string): void {
  if (!url || typeof window.kunGui?.openExternal !== 'function') return
  void window.kunGui.openExternal(url).catch(() => undefined)
}

export function OnboardingModelConfigure({ entry, profileId, draft, mode, issue, wireNote, onMode, onDraft, onChange }: {
  /** Null when the custom endpoint is being configured. */
  entry: OnboardingProviderEntry | null
  profileId: string
  draft: InitialSetupDraft
  mode: InitialSetupAccessMode
  issue: OnboardingConfigureIssue | null
  wireNote: string | null
  onMode: (mode: InitialSetupAccessMode) => void
  onDraft: (patch: Partial<InitialSetupDraft>) => void
  onChange: () => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const [showKey, setShowKey] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [discovery, setDiscovery] = useState<Discovery>({ status: 'idle' })
  const [manualModel, setManualModel] = useState('')
  const custom = entry === null
  const preset = entry ? presetForInitialSetup(entry.presetId) : null
  const profile = profileId === DEFAULT_MODEL_PROVIDER_ID ? null : initialSetupDraftProfile(profileId, draft)
  const connect = entry?.connect ?? 'custom'
  const providerName = custom ? draft.name?.trim() || t('onboarding.model.custom') : entry.name
  const kindKey = custom ? 'custom' : connect === 'login' || entry.tab === 'login' ? 'login'
    : connect === 'local' ? 'local' : mode === 'token-plan' || entry.tab === 'plan' ? 'plan' : 'key'
  const regions = entry ? onboardingEntryRegions(entry) : []
  const endpointHint = entry ? onboardingEndpointHint(entry) : null
  const presetModels = profileId === DEFAULT_MODEL_PROVIDER_ID
    ? defaultModelProviderSettings().providers.find((entry) => entry.id === DEFAULT_MODEL_PROVIDER_ID)?.models ?? []
    : profile?.models ?? []
  const discoveredModels = draft.models ?? []
  const needsDiscovery = custom || connect === 'local' || (entry ? !onboardingEntryHasModels(entry) : true)
  const modelChoices = needsDiscovery ? discoveredModels : presetModels
  const selectedModel = draft.model && modelChoices.includes(draft.model) ? draft.model : modelChoices[0]

  const fetchModels = async (): Promise<void> => {
    if (!profile || typeof window.kunGui?.probeModelProvider !== 'function') return
    setDiscovery({ status: 'busy' })
    try {
      const result = await window.kunGui.probeModelProvider({
        providerId: profile.id,
        baseUrl: profile.baseUrl,
        apiKey: draft.apiKey.trim(),
        endpointFormat: profile.endpointFormat,
        ...(profile.endpoints ? { endpoints: profile.endpoints } : {}),
        useProxy: profile.useProxy
      })
      if (!result.ok) { setDiscovery({ status: 'error', message: result.message }); return }
      const models = onboardingChatModels(result.modelIds)
      if (!models.length) { setDiscovery({ status: 'error', message: t('onboarding.model.modelsEmpty') }); return }
      onDraft({ models, model: models[0] })
      setDiscovery({ status: 'ok', count: models.length })
    } catch (error) {
      setDiscovery({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const keyField = (labelKey: string, optional = false): ReactNode => (
    <section>
      <div className="kun-onb-section-label">
        <label htmlFor="kun-onb-key">
          {optional ? t('onboarding.model.keyOptional') : t(labelKey, { provider: providerName })}
        </label>
        {entry && !optional ? (
          <button type="button" className="kun-onb-link" onClick={() => openExternal(onboardingKeyPageUrl(entry))}>
            {t('firstRunGetKeyAction')}<ArrowUpRight size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="kun-onb-field" data-invalid={issue === 'key' ? 'true' : undefined}>
        <span className="kun-onb-field-lead"><KeyRound size={17} strokeWidth={1.8} aria-hidden="true" /></span>
        <input
          id="kun-onb-key"
          className="is-secret"
          type={showKey ? 'text' : 'password'}
          value={draft.apiKey}
          onChange={(event) => onDraft({ apiKey: event.target.value })}
          placeholder={entry ? onboardingKeyPlaceholder(entry) : 'API Key'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={!optional}
          data-onboarding-key
        />
        <button
          type="button"
          className="kun-onb-eye"
          aria-label={t(showKey ? 'onboarding.model.hideKey' : 'onboarding.model.showKey')}
          onClick={() => setShowKey((value) => !value)}
        >
          {showKey ? <EyeOff size={17} strokeWidth={1.8} /> : <Eye size={17} strokeWidth={1.8} />}
        </button>
      </div>
      {optional ? null : (
        <p className="kun-onb-hint">
          {entry && onboardingKeyHintKey(entry) ? t(onboardingKeyHintKey(entry)!) : t('onboarding.model.keyHint', { provider: providerName })}
        </p>
      )}
    </section>
  )

  const urlField = (label: string, hint: string | null, trailing?: ReactNode): ReactNode => (
    <section>
      <div className="kun-onb-section-label"><label htmlFor="kun-onb-url">{label}</label></div>
      <div className="kun-onb-field" data-invalid={issue === 'baseUrl' ? 'true' : undefined}>
        <span className="kun-onb-field-lead">
          {connect === 'local' ? <MonitorSmartphone size={17} strokeWidth={1.8} aria-hidden="true" /> : <Globe size={17} strokeWidth={1.8} aria-hidden="true" />}
        </span>
        <input
          id="kun-onb-url"
          type="text"
          value={draft.baseUrl}
          onChange={(event) => onDraft({ baseUrl: event.target.value })}
          placeholder={preset?.baseUrl || 'https://'}
          autoComplete="off"
          spellCheck={false}
          data-onboarding-base-url
        />
        {trailing}
      </div>
      {hint ? <p className="kun-onb-hint">{hint}</p> : null}
    </section>
  )

  const loginSection = (): ReactNode => {
    if (!entry?.loginFlow || !profile) return null
    switch (entry.loginFlow) {
      case 'codex':
        return <CodexLoginSection provider={profile} onCredentialChange={(apiKey) => onDraft({ apiKey })} t={t} />
      case 'grok':
        return <GrokLoginSection provider={profile} onCredentialChange={(apiKey) => onDraft({ apiKey })} t={t} />
      case 'claude':
        return <ClaudeSubscriptionSection provider={profile} onTokenChange={(apiKey) => onDraft({ apiKey })}
          onModelsChange={(models) => onDraft({ models })} t={t} />
      case 'antigravity':
        return <GeminiSubscriptionSection t={t}
          onModelsChange={(catalog) => onDraft({ profilePatch: antigravityProviderCatalogPatch(catalog, profile.modelProfiles) })} />
      case 'gemini-cli':
        return <GeminiCliApiSubscriptionSection t={t}
          onModelsChange={(models) => onDraft({ profilePatch: geminiCliApiCatalogPatch(models, profile.models, profile.modelProfiles) })} />
    }
  }

  return (
    <>
      <div className="kun-onb-config-head">
        <span className="kun-onb-provider-icon" data-tint={entry ? onboardingProviderTint(entry.presetId) : undefined}>
          {entry ? <OnboardingProviderGlyph entry={entry} size={22} /> : <Globe size={20} strokeWidth={1.8} aria-hidden="true" />}
        </span>
        <span className="kun-onb-config-head-text">
          <b>{providerName}</b>
          <span>{t(`onboarding.model.kind.${kindKey}`)}{entry ? ` · ${entry.note}` : ''}</span>
        </span>
        <button type="button" className="kun-onb-btn" onClick={onChange} data-onboarding-change-provider>
          <ArrowLeftRight size={14} strokeWidth={2} aria-hidden="true" />{t('onboarding.model.change')}
        </button>
      </div>

      {preset?.tokenPlan && connect === 'key' ? (
        <section aria-labelledby="kun-onb-mode">
          <div className="kun-onb-section-label">
            <span id="kun-onb-mode">{t('firstRunModeLabel')}</span>
            <small>{t('onboarding.model.modeHint')}</small>
          </div>
          <div className="kun-onb-row">
            <div className="kun-onb-seg" role="radiogroup" aria-labelledby="kun-onb-mode">
              {(['api', 'token-plan'] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={mode === value} onClick={() => onMode(value)}
                  data-onboarding-mode={value}>
                  {t(value === 'api' ? 'firstRunModeApi' : 'firstRunModeTokenPlan')}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {regions.length > 1 ? (
        <section aria-labelledby="kun-onb-region">
          <div className="kun-onb-section-label"><span id="kun-onb-region">{preset?.regionLabel ?? t('firstRunRegionLabel')}</span></div>
          <div className="kun-onb-pills" role="radiogroup" aria-labelledby="kun-onb-region">
            {regions.map((region) => (
              <button key={region.id} type="button" role="radio" className="kun-onb-pill"
                aria-checked={(draft.baseUrl.trim() || regions[0].baseUrl) === region.baseUrl}
                onClick={() => onDraft({ baseUrl: region.baseUrl })}>
                {KNOWN_REGION_IDS.has(region.id) ? t(`firstRunRegion_${region.id}`) : region.name ?? region.id}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {custom ? (
        <>
          <section>
            <div className="kun-onb-section-label"><label htmlFor="kun-onb-name">{t('onboarding.model.customName')}</label></div>
            <div className="kun-onb-field">
              <input id="kun-onb-name" style={{ paddingLeft: 14 }} value={draft.name ?? ''} onChange={(event) => onDraft({ name: event.target.value })}
                placeholder={t('onboarding.model.customNamePlaceholder')} autoFocus />
            </div>
          </section>
          <section aria-labelledby="kun-onb-format">
            <div className="kun-onb-section-label"><span id="kun-onb-format">{t('onboarding.model.customFormat')}</span></div>
            <div className="kun-onb-pills" role="radiogroup" aria-labelledby="kun-onb-format">
              {ENDPOINT_FORMATS.map((format) => (
                <button key={format} type="button" role="radio" className="kun-onb-pill"
                  aria-checked={(draft.endpointFormat ?? 'chat_completions') === format}
                  onClick={() => onDraft({ endpointFormat: format })}>
                  {t(`onboarding.model.formats.${format}`)}
                </button>
              ))}
            </div>
          </section>
          {urlField(t('onboarding.model.customBaseUrl'), t('onboarding.model.baseUrlHint'))}
          {keyField('firstRunApiKeyLabel')}
        </>
      ) : connect === 'login' ? (
        <>
          <div className="kun-onb-login-host" data-onboarding-login={entry.loginFlow}>{loginSection()}</div>
          <div className="kun-onb-callout" data-tone="success">
            <Sparkles size={16} strokeWidth={1.9} aria-hidden="true" />
            <span>{t('onboarding.model.loginNote')}</span>
          </div>
        </>
      ) : connect === 'local' ? (
        <>
          {urlField(t('onboarding.model.localLabel'), discovery.status === 'error' ? null : t('onboarding.model.localHint', { provider: providerName }),
            <button type="button" className="kun-onb-btn" disabled={discovery.status === 'busy'} onClick={() => { void fetchModels() }} data-onboarding-detect>
              {discovery.status === 'busy' ? t('onboarding.model.localDetecting') : discovery.status === 'ok' ? t('onboarding.model.localRedetect') : t('onboarding.model.localDetect')}
            </button>)}
          {keyField('firstRunApiKeyLabel', true)}
        </>
      ) : (
        <>
          {endpointHint ? urlField(t('onboarding.model.endpointLabel'), endpointHint) : null}
          {keyField(mode === 'token-plan' ? 'onboarding.model.planKeyLabel' : 'firstRunApiKeyLabel')}
        </>
      )}

      {wireNote ? (
        <div className="kun-onb-callout" data-tone="success">
          <Sparkles size={16} strokeWidth={1.9} aria-hidden="true" />
          <span>{wireNote}</span>
        </div>
      ) : null}

      {connect === 'login' && !needsDiscovery ? null : (
        <section aria-labelledby="kun-onb-model">
          <div className="kun-onb-section-label">
            <span id="kun-onb-model">{t('onboarding.model.modelLabel')}</span>
            {needsDiscovery && connect !== 'local' ? (
              <button type="button" className="kun-onb-btn" disabled={discovery.status === 'busy'} onClick={() => { void fetchModels() }} data-onboarding-fetch-models>
                {discovery.status === 'busy' ? <><span className="kun-onb-spin" />{t('onboarding.model.modelFetching')}</> : t(discoveredModels.length ? 'onboarding.model.modelRefetch' : 'onboarding.model.modelFetch')}
              </button>
            ) : null}
          </div>
          {modelChoices.length ? (
            <div className="kun-onb-models" role="radiogroup" aria-labelledby="kun-onb-model">
              {modelChoices.slice(0, 12).map((model) => (
                <button key={model} type="button" role="radio" className="kun-onb-model" aria-checked={model === selectedModel}
                  onClick={() => onDraft({ model })}>{model}</button>
              ))}
            </div>
          ) : (
            <p className="kun-onb-hint" data-tone={issue === 'model' ? 'danger' : undefined}>{t('onboarding.model.modelNeeded')}</p>
          )}
          {discovery.status === 'ok' ? <p className="kun-onb-hint" data-tone="success">{t('onboarding.model.modelFound', { count: discovery.count })}</p> : null}
          {discovery.status === 'error' ? <p className="kun-onb-hint" data-tone="danger" role="alert">{t('onboarding.model.modelFetchFailed', { message: discovery.message })}</p> : null}
          {needsDiscovery ? (
            <div className="kun-onb-field" style={{ height: 40, marginTop: 10 }}>
              <input style={{ paddingLeft: 14, fontSize: 13 }} value={manualModel} placeholder={t('onboarding.model.modelManual')}
                data-onboarding-manual-model
                onChange={(event) => setManualModel(event.target.value)}
                onBlur={() => {
                  const id = manualModel.trim()
                  if (id) onDraft({ models: [id, ...discoveredModels.filter((model) => model !== id)], model: id })
                }} />
            </div>
          ) : null}
        </section>
      )}

      {connect === 'key' && !endpointHint ? (
        <section>
          <button type="button" className="kun-onb-disclosure" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
            {t('onboarding.model.advanced')}<small>{t('onboarding.model.advancedDetail')}</small>
          </button>
          {advancedOpen ? urlField(t('baseUrl'), t('onboarding.model.baseUrlHint')) : null}
        </section>
      ) : null}
    </>
  )
}
