import {
  DEFAULT_MODEL_PROVIDER_ID,
  isLocalModelProxyPort,
  localModelProxyPort,
  localModelProxyUrl,
  type ModelProviderProfileV1
} from '@shared/app-settings'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FilePenLine,
  ChevronDown,
  Loader2,
  PlugZap,
  Plus,
  Route,
  Search,
  ServerCog,
  Trash2,
  X
} from 'lucide-react'
import {
  type ReactElement
} from 'react'
import {
  InlineNoticeView,
  SettingsSubTabs,
  SettingsTabPanel,
  SettingsTabs,
  Toggle
} from './settings-controls'
import {
  DetailSection,
  ProviderListGroup,
  StatusPill,
  providerSelectControlClass,
  textInputClass
} from './settings-section-providers-controls'
import {
  MODEL_ENDPOINT_FORMAT_LABEL_KEYS, PROVIDER_TASK_TABS, SUBSCRIPTION_REGION_TABS,
  providerModelCount,
  type ProviderTaskTab, type ProviderWorkspaceMode
} from './settings-section-providers-profile'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'






import { ProviderModelImportDialog } from './provider-model-import-dialog'
import { ProviderIcon } from './provider-icon'
import { ModelRoutesSettings } from './settings-section-model-routes'
import { ProviderConnectionAdvancedPanels } from './settings-section-providers-connection-panels'
import { ProviderModelsCapabilitiesPanels } from './settings-section-providers-model-panels'

export function ProvidersSettingsView({ view }: { view: Record<string, any> }): ReactElement {
  const { t, kun, update, showApiKey, selectControlClass, saveStatus, saveError, retrySave, zh, provider, sharedConnections, sharedConnectionsError, settingsConfigOpenError, openSettingsConfigFile, credentialRevealError, setSelectedProviderId, addMenuOpen, addProviderQuery, setAddProviderQuery, subscriptionRegion, setSubscriptionRegion, providerListQuery, setProviderListQuery, activeTab, setActiveTab, workspaceMode, setWorkspaceMode, globalNetworkOpen, setGlobalNetworkOpen, expandedCapabilities, addProviderButtonRef, addProviderDialogRef, pendingImport, setPendingImport, displayProviders, activeRetry, isDraftActive, canEditActiveProviderId, activeKunProviderId, providerProxy, selectSharedModel, updateProviderProxy, setCapabilityExpanded, openAddProviderDialog, closeAddProviderDialog, handleAddProviderDialogKeyDown, handleSubscriptionRegionTabKeyDown, patchProviderProfile, updateModelProvider, updateActiveProviderCredential, toggleActiveProviderCredentialVisibility, updateModelProviderImage, removeModelProviderImage, updateModelProviderSpeech, removeModelProviderSpeech, updateModelProviderTextToSpeech, removeModelProviderTextToSpeech, updateModelProviderMusic, removeModelProviderMusic, updateModelProviderVideo, removeModelProviderVideo, updateModelProviderId, commitProviderDraft, cancelProviderDraft, addModelProvider, removeModelProvider, runProbe, importPickedModels, activeProbe, probeBusy, probeNotice, activeBaseUrlInvalid, activeImageBaseUrlInvalid, activeSpeechBaseUrlInvalid, activeSpeechToggleDisabled, activeTextToSpeechBaseUrlInvalid, activeMusicBaseUrlInvalid, activeVideoBaseUrlInvalid, activeMissingCredential, providerSetupNeedsApiKey, activeProbeBlocked, activeCursorAccount, activeCursorAccountFresh, activeCursorApiKeyUrl, activeSharedConnection, activeCredentialNeedsReplacement, activeApiKeyPlaceholder, activeApiKeyValue, activeCredentialRevealBusy, activeTokenPlanRegions, filteredProviders, grouped, renderProviderButton, planAddEntries, apiAddEntries, showPlanAddGroup, renderAddEntry, pendingImportProvider } = view
  const activeProvider = view.activeProvider as ModelProviderProfileV1 | undefined
  const planProviders = view.planProviders as ModelProviderProfileV1[]
  const apiProviders = view.apiProviders as ModelProviderProfileV1[]
  const providerProxyPort = localModelProxyPort(providerProxy.url)
  const providerProxyInvalid = providerProxy.enabled === true && !isLocalModelProxyPort(providerProxyPort)
  return (
    <>
      {providerSetupNeedsApiKey ? (
        <div className="mb-6 rounded-2xl border border-amber-300/80 bg-amber-50/95 px-5 py-4 text-amber-950 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
          <div className="text-[15px] font-semibold">{t('apiKeyRequiredTitle')}</div>
          <p className="mt-1 text-[13px] leading-6 text-amber-900/90 dark:text-amber-100/90">
            {t('apiKeyRequiredBody')}
          </p>
        </div>
      ) : null}
      <section className="ds-provider-workspace overflow-hidden rounded-xl border border-ds-border bg-ds-card">
        <header className="grid min-h-[76px] border-b border-ds-border-muted lg:grid-cols-[268px_minmax(0,1fr)]">
          <div
            className="grid min-w-0 content-start gap-3 border-b border-ds-border-muted px-4 py-3 lg:border-b-0 lg:border-r"
            data-testid="provider-workspace-meta"
          >
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-ds-ink">{t('providers')}</h2>
              <p className="mt-0.5 truncate text-[11.5px] text-ds-faint">
                {zh
                  ? `${displayProviders.length} 个已配置`
                  : `${displayProviders.length} configured`}
              </p>
              <p className="mt-2 text-[11.5px] leading-5 text-ds-faint">{t('modelProviderConfigFileHint')}</p>
            </div>
            <div
              className="flex min-w-0 flex-wrap items-center gap-2"
              data-testid="provider-workspace-actions"
            >
              <button
                type="button"
                onClick={() => void openSettingsConfigFile()}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-ink transition hover:border-accent/35 hover:bg-ds-hover"
              >
                <FilePenLine className="h-3.5 w-3.5" strokeWidth={2} />
                {t('modelProviderOpenConfigFile')}
              </button>
              {workspaceMode === 'providers' ? (
                <button
                  ref={addProviderButtonRef}
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={addMenuOpen}
                  onClick={openAddProviderDialog}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] font-medium text-ds-ink transition hover:border-accent/35 hover:bg-ds-hover"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('modelProviderAdd')}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 items-start px-4 py-3 sm:px-6">
            <SettingsTabs<ProviderWorkspaceMode>
              baseId="provider-workspace"
              ariaLabel={t('providers')}
              items={[
                { id: 'providers', label: t('modelProviderModeProviders'), icon: ServerCog },
                { id: 'routes', label: t('modelProviderModeRoutes'), icon: Route }
              ]}
              value={workspaceMode}
              onChange={setWorkspaceMode}
            />
          </div>
        </header>
        <SettingsTabPanel<ProviderWorkspaceMode>
          baseId="provider-workspace"
          tabId="providers"
          active={workspaceMode === 'providers'}
        >
          <div className="grid min-w-0">
            <label className="grid gap-1.5 px-4 py-4 lg:hidden">
            <span className="flex items-center gap-2 text-[12px] font-semibold text-ds-muted">
              <ProviderIcon
                presetId={activeProvider?.presetSource?.presetId}
                providerId={activeProvider?.id}
                className="h-4 w-4"
              />
              {t('modelProviderCompactSelect')}
            </span>
            <select
              className={providerSelectControlClass}
              value={activeProvider?.id ?? ''}
              onChange={(event) => setSelectedProviderId(event.target.value)}
            >
              {displayProviders.map((item: ModelProviderProfileV1) => (
                <option key={item.id} value={item.id}>{item.name.trim() || item.id}</option>
              ))}
            </select>
          </label>
          <div className="grid min-w-0 lg:grid-cols-[268px_minmax(0,1fr)]">
            <aside className="hidden min-w-0 content-start gap-4 border-r border-ds-border-muted bg-ds-sidebar/45 p-4 lg:grid">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                  strokeWidth={1.9}
                />
                <input
                  value={providerListQuery}
                  onChange={(event) => setProviderListQuery(event.target.value)}
                  placeholder={t('modelProviderSearchPlaceholder')}
                  aria-label={t('modelProviderSearchPlaceholder')}
                  className="h-10 w-full rounded-lg border border-ds-border bg-ds-card pl-9 pr-3 text-[12.5px] text-ds-ink transition placeholder:text-ds-faint focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/15"
                />
              </label>
              {grouped ? (
                <>
                  {planProviders.length > 0 ? (
                    <ProviderListGroup label={t('modelProviderGroupPlans')} count={planProviders.length}>
                      {planProviders.map(renderProviderButton)}
                    </ProviderListGroup>
                  ) : null}
                  {apiProviders.length > 0 ? (
                    <ProviderListGroup label={t('modelProviderGroupApi')} count={apiProviders.length}>
                      {apiProviders.map(renderProviderButton)}
                    </ProviderListGroup>
                  ) : null}
                </>
              ) : (
                <div className="grid gap-2">{apiProviders.map(renderProviderButton)}</div>
              )}
              {filteredProviders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ds-border-muted px-3 py-6 text-center text-[12px] text-ds-faint">
                  {t('modelProviderSearchEmpty', { query: providerListQuery.trim() })}
                </p>
              ) : null}
            </aside>
            {activeProvider ? (
              <div className="grid min-w-0 content-start gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ds-border-muted pb-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-ds-border-muted bg-ds-main/45 text-ds-muted">
                      <ProviderIcon
                        presetId={activeProvider.presetSource?.presetId}
                        providerId={activeProvider.id}
                        className="h-6 w-6"
                      />
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ds-faint">
                        <span>{t('providers')}</span>
                        <span aria-hidden="true">/</span>
                        <span className="truncate">{activeProvider.id}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2.5">
                        <h2 className="min-w-0 truncate text-[28px] font-semibold leading-none tracking-[-0.025em] text-ds-ink">
                          {activeProvider.name.trim() || activeProvider.id}
                        </h2>
                        {isDraftActive ? (
                          <StatusPill tone="warning">{t('modelProviderDraftBadge')}</StatusPill>
                        ) : (
                          <StatusPill
                            tone={activeProbeBlocked ? 'warning' : 'success'}
                            icon={activeProbeBlocked
                              ? <AlertCircle className="h-3 w-3" />
                              : <CheckCircle2 className="h-3 w-3" strokeWidth={2} />}
                          >
                            {activeProbeBlocked ? t('modelProviderNeedsConfiguration') : t('modelProviderReady')}
                          </StatusPill>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ds-muted">
                        <span>{t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[activeProvider.endpointFormat])}</span>
                        <span aria-hidden="true">·</span>
                        <span>{t('modelProviderModelCount', { total: providerModelCount(activeProvider) })}</span>
                        {activeKunProviderId === activeProvider.id ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{t('modelProviderInUse')}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {!isDraftActive ? (
                      <StatusPill
                        tone={saveStatus === 'error' ? 'error' : saveStatus === 'saved' ? 'success' : 'muted'}
                        icon={saveStatus === 'saved' ? <Check className="h-3 w-3" strokeWidth={2.2} /> : undefined}
                        title={saveStatus === 'error' ? saveError : undefined}
                      >
                        {saveStatus === 'saving'
                          ? t('applying')
                          : saveStatus === 'error'
                            ? t('applyFailed')
                            : saveStatus === 'saved'
                              ? t('applied')
                              : t('autoApplyHint')}
                      </StatusPill>
                    ) : null}
                    <button
                      type="button"
                      disabled={probeBusy || activeProbeBlocked}
                      title={activeMissingCredential
                        ? t('modelProviderPresetMissingKeyForProbe')
                        : activeBaseUrlInvalid
                          ? t('modelProviderInvalidUrl')
                          : undefined}
                      onClick={() => void runProbe(activeProvider, 'test')}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-ink transition hover:border-accent/35 hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {probeBusy && activeProbe?.mode === 'test'
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
                        : <PlugZap className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      {t('modelProviderTestConnection')}
                    </button>
                  </div>
                </div>
                <SettingsSubTabs<ProviderTaskTab>
                  baseId="provider-settings"
                  ariaLabel={t('modelProviderWorkspaceTabs')}
                  items={PROVIDER_TASK_TABS.map((tab) => ({
                    id: tab.id,
                    label: t(tab.labelKey)
                  }))}
                  value={activeTab}
                  onChange={setActiveTab}
                />
                {settingsConfigOpenError ? <InlineNoticeView notice={{ tone: 'error', message: settingsConfigOpenError }} /> : null}
                {sharedConnectionsError ? (
                  <InlineNoticeView notice={{ tone: 'error', message: sharedConnectionsError }} />
                ) : null}
                {probeNotice ? <InlineNoticeView notice={probeNotice} /> : null}
                <ProviderConnectionAdvancedPanels view={view} />
                <ProviderModelsCapabilitiesPanels view={view} />
                {!isDraftActive &&
                activeTab === 'advanced' &&
                activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID ? (
                  <DetailSection title={t('modelProviderSectionDanger')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void removeModelProvider(activeProvider.id)}
                        className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-red-200/70 bg-red-50 px-3 text-[12.5px] font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-200 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        {t('modelProviderRemove')}
                      </button>
                      <span className="text-[12px] text-ds-faint">{t('modelProviderDangerHint')}</span>
                    </div>
                  </DetailSection>
                ) : null}
                {isDraftActive ? (
                  <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-ds-card/95 px-4 py-3 shadow-lg backdrop-blur">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-ds-ink">{t('modelProviderDraftSection')}</div>
                      <p className="mt-0.5 text-[12px] text-ds-faint">
                        {activeProvider.apiKey.trim()
                          ? t('modelProviderDraftHintReady')
                          : t('modelProviderDraftHintNoKey')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={cancelProviderDraft}
                        className="inline-flex h-9 items-center rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        {t('modelProviderDraftDiscard')}
                      </button>
                      <button
                        type="button"
                        onClick={commitProviderDraft}
                        className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:opacity-90"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                        {t('modelProviderDraftConfirm')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
        </SettingsTabPanel>
        <SettingsTabPanel<ProviderWorkspaceMode>
          baseId="provider-workspace"
          tabId="routes"
          active={workspaceMode === 'routes'}
          className="p-4 sm:p-6"
        >
          <ModelRoutesSettings
            settings={provider}
            onChange={(next) => update({ provider: { routePools: next.routePools, localGateway: next.localGateway } })}
            translation={t}
            saveStatus={saveStatus}
            saveError={saveError}
            onRetrySave={retrySave}
            active={workspaceMode === 'routes'}
            publicBaseUrl={`http://127.0.0.1:${kun.port}`}
          />
        </SettingsTabPanel>
      </section>
      <details
        className="group rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm"
        open={globalNetworkOpen === true}
        onToggle={(event) => setGlobalNetworkOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold text-ds-ink">{t('modelProviderGlobalNetwork')}</h2>
              <StatusPill tone={providerProxy.enabled ? 'success' : 'muted'}>
                {providerProxy.enabled ? t('proxyEnabled') : t('modelProviderCapabilityDisabled')}
              </StatusPill>
            </div>
            <p className="mt-1 text-[12.5px] leading-5 text-ds-muted">{t('proxyUrlDesc')}</p>
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180" strokeWidth={1.9} />
        </summary>
        <div className="grid gap-3 border-t border-ds-border-muted px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)]">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
              <span>{t('proxyEnabled')}</span>
              <Toggle
                ariaLabel={t('proxyEnabled')}
                checked={providerProxy.enabled === true}
                onChange={(enabled) => updateProviderProxy({ enabled })}
              />
            </label>
            <input
              className={`${textInputClass} ${providerProxyInvalid ? 'border-red-400/70 focus:border-red-500/70 focus:ring-red-500/15' : ''}`}
              placeholder={t('proxyUrlPlaceholder')}
              value={providerProxyPort}
              inputMode="numeric"
              pattern="[0-9]*"
              spellCheck={false}
              aria-label={t('proxyUrl')}
              aria-invalid={providerProxyInvalid}
              aria-describedby={providerProxyInvalid ? 'provider-proxy-url-error' : undefined}
              onChange={(e) => updateProviderProxy({ url: localModelProxyUrl(e.target.value) })}
            />
            {providerProxyInvalid ? (
              <div className="md:col-start-2" id="provider-proxy-url-error">
                <InlineNoticeView notice={{ tone: 'error', message: t('proxyUrlInvalid') }} />
              </div>
            ) : null}
        </div>
      </details>
      {addMenuOpen ? (
        <div
          className="ds-no-drag fixed inset-0 z-50 grid place-items-center overscroll-none bg-slate-950/40 p-4 backdrop-blur-md dark:bg-black/65"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-provider-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAddProviderDialog()
          }}
        >
          <section
            ref={addProviderDialogRef}
            onKeyDown={handleAddProviderDialogKeyDown}
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
                onClick={closeAddProviderDialog}
                className="rounded-full p-1.5 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.9} />
              </button>
            </header>
            <div className="shrink-0 border-b border-ds-border px-5 py-3">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-faint"
                  strokeWidth={1.9}
                />
                <input
                  autoFocus
                  value={addProviderQuery}
                  onChange={(event) => setAddProviderQuery(event.target.value)}
                  placeholder={t('modelProviderAddDialogSearch')}
                  aria-label={t('modelProviderAddDialogSearch')}
                  className="w-full rounded-xl border border-ds-border bg-ds-card py-2 pl-9 pr-3 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                />
              </label>
            </div>
            <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  closeAddProviderDialog()
                  addModelProvider()
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
                            onKeyDown={(event) => handleSubscriptionRegionTabKeyDown(event, tab.id)}
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
              {planAddEntries.length === 0 && apiAddEntries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-ds-border-muted px-4 py-8 text-center text-[12.5px] text-ds-faint">
                  {t('modelProviderAddDialogEmpty', { query: addProviderQuery.trim() })}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      {pendingImport && pendingImportProvider ? (
      <ProviderModelImportDialog
        provider={pendingImportProvider}
        providerModelIds={pendingImport.providerModelIds}
        catalogResult={pendingImport.catalogResult}
        providerError={pendingImport.providerError}
        authoritative={pendingImport.authoritative}
        t={t}
        onCancel={() => setPendingImport(null)}
        onConfirm={async (picked) => {
          await importPickedModels(
            pendingImportProvider,
            picked,
            pendingImport.authoritative,
            pendingImport.modelAliases,
            pendingImport.discoveredModelProfiles
          )
          setPendingImport(null)
        }}
      />
    ) : null}
    </>
  )
}
