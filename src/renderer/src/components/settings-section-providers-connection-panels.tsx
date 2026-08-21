import type {
  ModelEndpointFormat,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS,
  MODEL_ENDPOINT_FORMATS
} from '@shared/app-settings'
import type {
  ModelProviderTokenPlanRegion
} from '@shared/model-provider-presets'
import {
  ExternalLink,
  Lock
} from 'lucide-react'
import {
  type ReactElement
} from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import { ClaudeSubscriptionSection } from './claude-subscription-section'
import {
  SecretInput,
  SettingsTabPanel,
  Toggle
} from './settings-controls'
import { CodexLoginSection } from './settings-section-providers-codex-login'
import {
  DetailSection,
  fieldLabelClass, parseRetryStatusCodes,
  providerSelectControlClass, retryStatusCodesText, textInputClass
} from './settings-section-providers-controls'
import { GeminiCliApiSubscriptionSection, GeminiSubscriptionSection } from './settings-section-providers-gemini'
import { GrokLoginSection } from './settings-section-providers-grok-login'
import {
  MODEL_ENDPOINT_FORMAT_LABEL_KEYS,
  antigravityProviderCatalogPatch,
  geminiCliApiCatalogPatch,
  isAgentSdkProvider, isCodexProvider, isCursorSubscriptionProvider,
  isDelegatedEndpointProvider,
  isGeminiCliApiSubscriptionProvider, isGeminiSubscriptionProvider, isGrokSubscriptionProvider,
  isOAuthSubscriptionProvider,
  type ProviderTaskTab
} from './settings-section-providers-profile'
import {
  SharedDefaultModelPicker,
  type SharedModelConnection, type SharedModelConnectionsSnapshot
} from './settings-section-providers-shared-api'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function ProviderConnectionAdvancedPanels({ view }: { view: Record<string, any> }): ReactElement {
  const { t, showApiKey, selectControlClass, zh, sharedConnectionsError, credentialRevealError, activeTab, expandedCapabilities, activeProvider, activeRetry, isDraftActive, canEditActiveProviderId, patchProviderProfile, updateModelProvider, updateActiveProviderCredential, toggleActiveProviderCredentialVisibility, updateModelProviderImage, removeModelProviderImage, updateModelProviderId, activeProbe, probeNotice, activeBaseUrlInvalid, activeImageBaseUrlInvalid, activeMissingCredential, activeCursorAccount, activeCursorAccountFresh, activeCursorApiKeyUrl, activeSharedConnection, activeCredentialNeedsReplacement, activeApiKeyPlaceholder, activeApiKeyValue, activeCredentialRevealBusy } = view
  const activeTokenPlanRegions = view.activeTokenPlanRegions as ModelProviderTokenPlanRegion[]
  const sharedConnections = view.sharedConnections as SharedModelConnectionsSnapshot | null
  const selectSharedModel = view.selectSharedModel as (
    connection: SharedModelConnection,
    model: string
  ) => Promise<void>
  return (
    <>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="connection"
                  active={activeTab === 'connection'}
                  className="grid gap-4"
                >
                <DetailSection title={t('modelProviderSectionBasics')}>
                  <div className="grid gap-3">
                    <label className={fieldLabelClass}>
                      {t('modelProviderName')}
                      <input
                        className={textInputClass}
                        value={activeProvider.name}
                        onChange={(e) => updateModelProvider(activeProvider.id, { name: e.target.value })}
                      />
                    </label>
                  </div>
                </DetailSection>
                <DetailSection title={t('modelProviderSectionConnection')}>
                  {isCodexProvider(activeProvider) ? (
                    <CodexLoginSection
                      provider={activeProvider}
                      configured={sharedModelConnectionHasUsableCredential(activeSharedConnection)}
                      onCredentialChange={(apiKey) => updateModelProvider(activeProvider.id, { apiKey })}
                      t={t}
                    />
                  ) : isGeminiSubscriptionProvider(activeProvider) ? (
                    <GeminiSubscriptionSection
                      onModelsChange={(catalog) => updateModelProvider(
                        activeProvider.id,
                        antigravityProviderCatalogPatch(catalog, activeProvider.modelProfiles)
                      )}
                      t={t}
                    />
                  ) : isGeminiCliApiSubscriptionProvider(activeProvider) ? (
                    <GeminiCliApiSubscriptionSection
                      onModelsChange={(models) => updateModelProvider(
                        activeProvider.id,
                        geminiCliApiCatalogPatch(models, activeProvider.models, activeProvider.modelProfiles)
                      )}
                      t={t}
                    />
                  ) : isCursorSubscriptionProvider(activeProvider) ? (
                    <div className="grid gap-3">
                      <div className="grid gap-2 rounded-lg border border-ds-border bg-ds-main/30 px-3 py-2 text-[12px] leading-5 text-ds-muted sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <p>{t('cursorSubscriptionNote')}</p>
                        {activeCursorApiKeyUrl ? (
                          <button
                            type="button"
                            className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5 font-medium text-accent transition hover:bg-accent/10"
                            onClick={() => {
                              if (typeof window.kunGui?.openExternal !== 'function') return
                              void window.kunGui.openExternal(activeCursorApiKeyUrl).catch(() => undefined)
                            }}
                          >
                            {t('cursorSubscriptionGetApiKey')}
                            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
                          </button>
                        ) : null}
                      </div>
                      <label className={fieldLabelClass}>
                        {t('modelProviderApiKey')}
                        <SecretInput
                          className="min-h-11 !rounded-lg"
                          value={activeApiKeyValue}
                          onChange={updateActiveProviderCredential}
                          visible={showApiKey}
                          onToggleVisibility={() => { void toggleActiveProviderCredentialVisibility() }}
                          toggleBusy={activeCredentialRevealBusy}
                          placeholder={activeApiKeyPlaceholder}
                          autoComplete="off"
                          showLabel={t('showSecret')}
                          hideLabel={t('hideSecret')}
                        />
                        {credentialRevealError ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {credentialRevealError}
                          </span>
                        ) : !activeProvider.apiKey.trim() && activeCredentialNeedsReplacement ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {activeSharedConnection?.credentialStatus === 'unreadable'
                              ? zh
                                ? '现有凭据无法读取。请输入新值以安全替换它。'
                                : 'The existing credential cannot be read. Enter a new value to replace it safely.'
                              : zh
                                ? '未找到可用凭据。请输入新值以继续。'
                                : 'No usable credential is stored. Enter a new value to continue.'}
                          </span>
                        ) : !activeProvider.apiKey.trim() &&
                          sharedModelConnectionHasUsableCredential(activeSharedConnection) ? (
                            <span className="text-[12px] font-normal text-ds-muted">
                              {zh
                                ? '凭据已安全保存在共享连接中。输入新值可替换现有凭据。'
                                : 'The credential is stored securely in the shared connection. Enter a new value to replace it.'}
                            </span>
                          ) : null}
                      </label>
                      {activeCursorAccountFresh && activeCursorAccount ? (
                        <p className="text-[12px] leading-5 text-ds-muted">
                          {t('cursorSubscriptionAccount', {
                            account: activeCursorAccount.label,
                            keyName: activeCursorAccount.apiKeyName
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : isGrokSubscriptionProvider(activeProvider) ? (
                    <GrokLoginSection
                      provider={activeProvider}
                      configured={sharedModelConnectionHasUsableCredential(activeSharedConnection)}
                      onCredentialChange={(apiKey) => updateModelProvider(activeProvider.id, { apiKey })}
                      t={t}
                    />
                  ) : isAgentSdkProvider(activeProvider) ? (
                    <ClaudeSubscriptionSection
                      provider={activeProvider}
                      configured={sharedModelConnectionHasUsableCredential(activeSharedConnection)}
                      onTokenChange={(token) => updateModelProvider(activeProvider.id, { apiKey: token })}
                      onModelsChange={(models) => updateModelProvider(activeProvider.id, { models })}
                      t={t}
                    />
                  ) : (
                    <>
                      <label className={fieldLabelClass}>
                        {t('modelProviderApiKey')}
                        <SecretInput
                          className="min-h-11 !rounded-lg"
                          value={activeApiKeyValue}
                          onChange={updateActiveProviderCredential}
                          visible={showApiKey}
                          onToggleVisibility={() => { void toggleActiveProviderCredentialVisibility() }}
                          toggleBusy={activeCredentialRevealBusy}
                          placeholder={activeApiKeyPlaceholder}
                          autoComplete="off"
                          showLabel={t('showSecret')}
                          hideLabel={t('hideSecret')}
                        />
                        {credentialRevealError ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {credentialRevealError}
                          </span>
                        ) : !activeProvider.apiKey.trim() && activeCredentialNeedsReplacement ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {activeSharedConnection?.credentialStatus === 'unreadable'
                              ? zh
                                ? '现有凭据无法读取。请输入新值以安全替换它。'
                                : 'The existing credential cannot be read. Enter a new value to replace it safely.'
                              : zh
                                ? '未找到可用凭据。请输入新值以继续。'
                                : 'No usable credential is stored. Enter a new value to continue.'}
                          </span>
                        ) : !activeProvider.apiKey.trim() &&
                          sharedModelConnectionHasUsableCredential(activeSharedConnection) ? (
                            <span className="text-[12px] font-normal text-ds-muted">
                              {zh
                                ? '凭据已安全保存在共享连接中。输入新值可替换现有凭据。'
                                : 'The credential is stored securely in the shared connection. Enter a new value to replace it.'}
                            </span>
                          ) : null}
                      </label>
                      <label className={fieldLabelClass}>
                        {t('modelProviderBaseUrl')}
                        <input
                          className={textInputClass}
                          value={activeProvider.baseUrl}
                          placeholder={t('baseUrlPlaceholder')}
                          spellCheck={false}
                          onChange={(e) => updateModelProvider(activeProvider.id, { baseUrl: e.target.value })}
                        />
                        {activeBaseUrlInvalid ? (
                          <span className="text-[12px] font-normal text-amber-600 dark:text-amber-300">
                            {t('modelProviderInvalidUrl')}
                          </span>
                        ) : null}
                      </label>
                    </>
                  )}
                  {activeTokenPlanRegions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-ds-muted">
                        {t('modelProviderTokenPlanRegion')}
                      </span>
                      {activeTokenPlanRegions.map((region) => {
                        const active = activeProvider.baseUrl.trim() === region.baseUrl
                        return (
                          <button
                            key={region.id}
                            type="button"
                            onClick={() => {
                              const patch: Partial<ModelProviderProfileV1> = { baseUrl: region.baseUrl }
                              const speech = activeProvider.speech
                              if (speech && activeTokenPlanRegions.some((item) => item.baseUrl === speech.baseUrl.trim())) {
                                patch.speech = { ...speech, baseUrl: region.baseUrl }
                              }
                              const textToSpeech = activeProvider.textToSpeech
                              if (
                                textToSpeech &&
                                activeTokenPlanRegions.some((item) => item.baseUrl === textToSpeech.baseUrl.trim())
                              ) {
                                patch.textToSpeech = { ...textToSpeech, baseUrl: region.baseUrl }
                              }
                              updateModelProvider(activeProvider.id, patch)
                            }}
                            className={`inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] font-medium transition ${
                              active
                                ? 'border-accent/60 bg-ds-main/45 text-ds-ink ring-1 ring-accent/30'
                                : 'border-ds-border bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                            }`}
                          >
                            {t(`firstRunRegion_${region.id}`)}
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                  <label className={fieldLabelClass}>
                    {t('modelProviderEndpointFormat')}
                    <select
                      className={providerSelectControlClass}
                      value={activeProvider.endpointFormat}
                      disabled={isOAuthSubscriptionProvider(activeProvider) || isDelegatedEndpointProvider(activeProvider)}
                      onChange={(e) => updateModelProvider(activeProvider.id, {
                        endpointFormat: e.target.value as ModelEndpointFormat
                      })}
                    >
                      {MODEL_ENDPOINT_FORMATS.map((format) => (
                        <option key={format} value={format}>
                          {t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[format])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {isCodexProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('codexEndpointLocked')}
                    </p>
                  ) : isGeminiSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('geminiEndpointLocked')}
                    </p>
                  ) : isGeminiCliApiSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('geminiCliApiEndpointLocked')}
                    </p>
                  ) : isCursorSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('cursorEndpointLocked')}
                    </p>
                  ) : isGrokSubscriptionProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('grokEndpointLocked')}
                    </p>
                  ) : isAgentSdkProvider(activeProvider) ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('claudeEndpointLocked')}
                    </p>
                  ) : activeProvider.endpointFormat === 'custom_endpoint' ? (
                    <p className="text-[12px] leading-5 text-ds-muted">
                      {t('modelEndpointCustomEndpointDesc')}
                    </p>
                  ) : null}
                </DetailSection>
                <SharedDefaultModelPicker
                  snapshot={sharedConnections}
                  error={sharedConnectionsError}
                  zh={zh}
                  onSelect={(connection, model) => void selectSharedModel(connection, model)}
                />
                </SettingsTabPanel>
                <SettingsTabPanel<ProviderTaskTab>
                  baseId="provider-settings"
                  tabId="advanced"
                  active={activeTab === 'advanced'}
                  className="grid gap-4"
                >
                    <DetailSection title={t('modelProviderIdentitySection')}>
                      <label className={fieldLabelClass}>
                        {t('modelProviderId')}
                        <span className="relative block">
                          <input
                            className={`w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] font-normal shadow-sm ${
                              canEditActiveProviderId
                                ? 'text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
                                : 'pr-9 text-ds-faint'
                            }`}
                            value={activeProvider.id}
                            readOnly={!canEditActiveProviderId}
                            spellCheck={false}
                            onChange={(e) => updateModelProviderId(activeProvider.id, e.target.value)}
                          />
                          {!canEditActiveProviderId ? (
                            <span
                              title={t('modelProviderIdLocked')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-ds-faint"
                            >
                              <Lock className="h-3.5 w-3.5" strokeWidth={1.9} />
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[12px] font-normal leading-5 text-ds-faint">
                          {t('modelProviderIdentityHint')}
                        </span>
                      </label>
                    </DetailSection>
                <DetailSection
                  title={t('modelProviderRetrySection')}
                  action={
                    <Toggle
                      ariaLabel={t('modelProviderRetrySection')}
                      checked={activeRetry.maxAttempts > 0}
                      onChange={(enabled) => updateModelProvider(activeProvider.id, {
                        retry: {
                          ...activeRetry,
                          maxAttempts: enabled ? DEFAULT_MODEL_REQUEST_RETRY_MAX_ATTEMPTS : 0
                        }
                      })}
                    />
                  }
                >
                  {activeRetry.maxAttempts > 0 ? (
                    <div className="grid gap-3">
                      <p className="text-[12px] leading-5 text-ds-faint">
                        {t('modelProviderRetryStatusCodesHint')}
                      </p>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className={fieldLabelClass}>
                          {t('modelProviderRetryMaxAttempts')}
                          <input
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            className={textInputClass}
                            value={activeRetry.maxAttempts}
                            onChange={(e) => updateModelProvider(activeProvider.id, {
                              retry: {
                                ...activeRetry,
                                maxAttempts: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1)))
                              }
                            })}
                          />
                          <span className="text-[11px] font-normal leading-4 text-ds-faint">
                            {t('modelProviderRetryMaxAttemptsHint')}
                          </span>
                        </label>
                        <label className={fieldLabelClass}>
                          {t('modelProviderRetryInitialDelayMs')}
                          <input
                            type="number"
                            min={0}
                            max={600000}
                            step={100}
                            className={textInputClass}
                            value={activeRetry.initialDelayMs}
                            onChange={(e) => updateModelProvider(activeProvider.id, {
                              retry: {
                                ...activeRetry,
                                initialDelayMs: Math.min(600_000, Math.max(0, Math.round(Number(e.target.value) || 0)))
                              }
                            })}
                          />
                        </label>
                        <label className={fieldLabelClass}>
                          {t('modelProviderRetryStatusCodes')}
                          <input
                            className={textInputClass}
                            value={retryStatusCodesText(activeRetry.httpStatusCodes)}
                            onChange={(e) => updateModelProvider(activeProvider.id, {
                              retry: {
                                ...activeRetry,
                                httpStatusCodes: parseRetryStatusCodes(e.target.value)
                              }
                            })}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </DetailSection>
                </SettingsTabPanel>
    </>
  )
}
