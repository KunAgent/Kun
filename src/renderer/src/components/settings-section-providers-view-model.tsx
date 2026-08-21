import type {
  ModelProviderPresetMode,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  MODEL_PROVIDER_PRESETS,
  isMultiAccountProviderPreset,
  modelProviderPresetAccountCount,
  resolveModelProviderPresetSource,
  tokenPlanProviderId
} from '@shared/app-settings'
import {
  modelProviderRequiresApiKey,
  modelSupportsImageInput
} from '@shared/app-settings-provider-core'
import type {
  ModelProviderPreset,
  ModelProviderSubscriptionRegion
} from '@shared/model-provider-presets'
import {
  AlertCircle,
  Image as ImageIcon
} from 'lucide-react'
import {
  type ReactElement
} from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import {
  type InlineNotice
} from './settings-controls'
import { ProviderIcon } from './provider-icon'
import {
  ProviderBadge,
  StatusPill
} from './settings-section-providers-controls'
import {
  isAcceptableHttpUrl,
  isCursorSubscriptionProvider,
  isDelegatedEndpointProvider, isOAuthSubscriptionProvider,
  isSubscriptionProvider,
  presetSpeechCapability,
  profileForModel,
  providerConnectionFingerprint, providerModelCount,
  tokenPlanPresetForProfile
} from './settings-section-providers-profile'
import {
  sharedProviderSetupNeedsApiKey
} from './settings-section-providers-shared-api'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function buildProvidersViewModel(scope: Record<string, any>): Record<string, any> {
  const { t, showApiKey, sharedConnections, revealedCredential, credentialRevealPendingProviderId, setSelectedProviderId, addProviderQuery, subscriptionRegion, providerListQuery, probeStates, cursorAccounts, pendingImport, draftProvider, activeProvider, sharedConnectionFor, hasConfiguredCredential, activeKunProviderId, closeAddProviderDialog, addPresetModelProvider, updateProviderProxy, setGlobalNetworkOpen } = scope
  const modelProviders = scope.modelProviders as ModelProviderProfileV1[]
  const displayProviders = scope.displayProviders as ModelProviderProfileV1[]
  const activeProbe = activeProvider ? probeStates[activeProvider.id] : undefined
  const activeProbeFresh = Boolean(
    activeProvider &&
    activeProbe &&
    activeProbe.fingerprint === providerConnectionFingerprint(activeProvider)
  )
  const probeBusy = Boolean(activeProbeFresh && activeProbe?.status === 'busy')
  const probeNotice: InlineNotice | null = (() => {
    if (!activeProbeFresh || !activeProbe) return null
    if (activeProbe.status === 'busy') {
      return { tone: 'info', message: t('modelProviderTesting') }
    }
    if (activeProbe.status === 'error') {
      const technicalMessage = t('modelProviderTestFailed', { message: activeProbe.message ?? '' })
      const suggestedProxyUrl = activeProbe.suggestedProxyUrl?.trim()
      return {
        tone: 'error',
        message: suggestedProxyUrl
          ? `${technicalMessage}\n${t('modelProviderSystemProxyDetected', { proxy: suggestedProxyUrl })}`
          : technicalMessage,
        copy: {
          label: t('modelProviderCopyError'),
          copiedLabel: t('modelProviderErrorCopied'),
          text: technicalMessage
        },
        action: suggestedProxyUrl
          ? {
              label: t('modelProviderUseDetectedProxy'),
              onClick: () => {
                updateProviderProxy({ enabled: true, url: suggestedProxyUrl })
                setGlobalNetworkOpen(true)
              }
            }
          : undefined
      }
    }
    return {
      tone: 'success',
      message: activeProbe.mode === 'fetch'
        ? t('modelProviderFetchedModels', { total: activeProbe.total ?? 0 })
        : t('modelProviderTestSuccess', { latency: activeProbe.latencyMs ?? 0, total: activeProbe.total ?? 0 })
    }
  })()
  const activeBaseUrlInvalid = Boolean(activeProvider && !isAcceptableHttpUrl(activeProvider.baseUrl))
  const activeImageBaseUrlInvalid = Boolean(
    activeProvider?.image && !isAcceptableHttpUrl(activeProvider.image.baseUrl)
  )
  const activeSpeechBaseUrlInvalid = Boolean(
    activeProvider?.speech &&
    activeProvider.speech.protocol !== 'gemini-cli-audio' &&
    activeProvider.speech.protocol !== 'local-whisper' &&
    !isAcceptableHttpUrl(activeProvider.speech.baseUrl)
  )
  const activePresetSpeechCapability = activeProvider
    ? presetSpeechCapability(activeProvider)
    : null
  const activeSpeechToggleDisabled = Boolean(
    activePresetSpeechCapability ||
    (
      activeProvider &&
      !activeProvider.speech &&
      (isDelegatedEndpointProvider(activeProvider) || isOAuthSubscriptionProvider(activeProvider))
    )
  )
  const activeTextToSpeechBaseUrlInvalid = Boolean(
    activeProvider?.textToSpeech && !isAcceptableHttpUrl(activeProvider.textToSpeech.baseUrl)
  )
  const activeMusicBaseUrlInvalid = Boolean(
    activeProvider?.music && !isAcceptableHttpUrl(activeProvider.music.baseUrl)
  )
  const activeVideoBaseUrlInvalid = Boolean(
    activeProvider?.video && !isAcceptableHttpUrl(activeProvider.video.baseUrl)
  )
  const activeMissingCredential = Boolean(
    activeProvider &&
    modelProviderRequiresApiKey(activeProvider) &&
    !hasConfiguredCredential(activeProvider)
  )
  const providerSetupNeedsApiKey = sharedProviderSetupNeedsApiKey(displayProviders, sharedConnections)
  const activeProbeBlocked = activeBaseUrlInvalid || activeMissingCredential
  const activeCursorAccount = activeProvider
    ? cursorAccounts[activeProvider.id]
    : undefined
  const activeCursorAccountFresh = Boolean(
    activeProvider
    && activeCursorAccount
    && activeCursorAccount.fingerprint === providerConnectionFingerprint(activeProvider)
  )
  const activeCursorApiKeyUrl = activeProvider && isCursorSubscriptionProvider(activeProvider)
    ? resolveModelProviderPresetSource(activeProvider)?.preset.apiKeyUrl
    : undefined
  const activeSharedConnection = activeProvider
    ? sharedConnectionFor(activeProvider.id)
    : undefined
  const activeCredentialNeedsReplacement =
    activeSharedConnection?.credentialStatus === 'missing' ||
    activeSharedConnection?.credentialStatus === 'unreadable'
  const activeTokenPlan = activeProvider
    ? tokenPlanPresetForProfile(activeProvider)?.tokenPlan
    : undefined
  const activeApiKeyPlaceholder =
    !activeCredentialNeedsReplacement && (
      Boolean(activeProvider?.apiKey.trim()) ||
      sharedModelConnectionHasUsableCredential(activeSharedConnection)
    )
      ? '••••••••••••'
      : activeTokenPlan?.keyPrefix
        ? `${activeTokenPlan.keyPrefix}...`
        : t('modelProviderApiKeyPlaceholder')
  const activeApiKeyValue = showApiKey && revealedCredential?.providerId === activeProvider?.id
    ? revealedCredential.credential
    : activeProvider?.apiKey ?? ''
  const activeCredentialRevealBusy =
    credentialRevealPendingProviderId === activeProvider?.id
  const activeTokenPlanRegions = activeTokenPlan?.regions ?? []

  const normalizedProviderListQuery = providerListQuery.trim().toLowerCase()
  const filteredProviders = normalizedProviderListQuery
    ? displayProviders.filter((item) =>
        `${item.name} ${item.id}`.toLowerCase().includes(normalizedProviderListQuery)
      )
    : displayProviders
  const planProviders = filteredProviders.filter((item) => isSubscriptionProvider(item))
  const apiProviders = filteredProviders.filter((item) => !isSubscriptionProvider(item))
  // 只要存在任一套餐类供应商就分组展示;否则(通常只有默认 DeepSeek)保持单一平铺列表。
  const grouped = displayProviders.some((item) => isSubscriptionProvider(item))

  const renderProviderButton = (item: ModelProviderProfileV1): ReactElement => {
    const selected = activeProvider?.id === item.id
    const isDraft = draftProvider?.id === item.id
    const inUse = !isDraft && activeKunProviderId === item.id
    const configuredCredential = hasConfiguredCredential(item)
    const missingKey = modelProviderRequiresApiKey(item) && !configuredCredential
    return (
      <button
        key={item.id}
        type="button"
        aria-pressed={selected}
        onClick={() => setSelectedProviderId(item.id)}
        className={`group relative min-h-[58px] w-full min-w-0 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
          selected
            ? 'border-accent/20 bg-accent/[0.08]'
            : 'border-transparent hover:border-ds-border-muted hover:bg-ds-hover'
        }`}
      >
        {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
            selected
              ? 'border-accent/20 bg-ds-card text-accent'
              : 'border-ds-border-muted bg-ds-main/45 text-ds-faint group-hover:text-ds-muted'
          }`}>
            <ProviderIcon
              presetId={item.presetSource?.presetId}
              providerId={item.id}
              className="h-4 w-4"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ds-ink">
                {item.name.trim() || item.id}
              </span>
              {configuredCredential ? (
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title={t('modelProviderReady')} />
              ) : null}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11.5px] text-ds-faint">
              {inUse ? <span>{t('modelProviderInUse')}</span> : null}
              {inUse ? <span aria-hidden="true">·</span> : null}
              <span>{t('modelProviderModelCount', { total: providerModelCount(item) })}</span>
              {item.models.some((model) =>
                modelSupportsImageInput(profileForModel(item, model))
              ) ? <ImageIcon className="h-3 w-3 shrink-0" strokeWidth={1.9} /> : null}
            </span>
          </span>
          {isDraft ? <ProviderBadge tone="warning">{t('modelProviderDraftBadge')}</ProviderBadge> : null}
          {!isDraft && missingKey ? (
            <span className="inline-flex shrink-0 items-center text-amber-500" title={t('modelProviderMissingKey')}>
              <AlertCircle className="h-4 w-4" />
              <span className="sr-only">{t('modelProviderMissingKey')}</span>
            </span>
          ) : null}
        </div>
      </button>
    )
  }

  const addMenuEntries = MODEL_PROVIDER_PRESETS.flatMap((preset) => {
    const entries: {
      preset: ModelProviderPreset
      mode: ModelProviderPresetMode
      profileId: string
      label: string
      group: 'subscription' | 'api'
      region?: ModelProviderSubscriptionRegion
    }[] = [
      {
        preset,
        mode: 'api',
        profileId: preset.id,
        label: preset.name,
        group: preset.category === 'subscription' ? 'subscription' : 'api',
        region: preset.subscriptionRegion
      }
    ]
    if (preset.tokenPlan) {
      entries.push({
        preset,
        mode: 'token-plan',
        profileId: tokenPlanProviderId(preset.id),
        label: preset.tokenPlan.displayName?.trim() || `${preset.name} · Token Plan`,
        group: 'subscription',
        region: preset.subscriptionRegion
      })
    }
    return entries
  })
  const normalizedAddProviderQuery = addProviderQuery.trim().toLowerCase()
  const visibleAddEntries = normalizedAddProviderQuery
    ? addMenuEntries.filter((entry) =>
        `${entry.label} ${entry.profileId}`.toLowerCase().includes(normalizedAddProviderQuery)
      )
    : addMenuEntries
  const queriedPlanAddEntries = visibleAddEntries.filter((entry) => entry.group === 'subscription')
  const planAddEntries = subscriptionRegion === 'all'
    ? queriedPlanAddEntries
    : queriedPlanAddEntries.filter((entry) => entry.region === subscriptionRegion)
  const apiAddEntries = visibleAddEntries.filter((entry) => entry.group === 'api')
  const showPlanAddGroup = queriedPlanAddEntries.length > 0 || !normalizedAddProviderQuery
  const renderAddEntry = (entry: (typeof addMenuEntries)[number]): ReactElement => {
    const multiAccount = isMultiAccountProviderPreset(entry.preset, entry.mode)
    const accountCount = multiAccount
      ? modelProviderPresetAccountCount(entry.preset, entry.mode, modelProviders)
      : 0
    const exists = !multiAccount && modelProviders.some((item) => item.id === entry.profileId)
    return (
      <button
        key={entry.profileId}
        type="button"
        onClick={() => {
          closeAddProviderDialog()
          void addPresetModelProvider(entry.preset, entry.mode)
        }}
        className="group grid min-h-20 w-full gap-2 rounded-xl border border-ds-border bg-ds-card px-3.5 py-3 text-left transition hover:border-accent/45 hover:bg-ds-hover"
      >
        <span className="flex min-w-0 items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-main/45 text-ds-muted">
              <ProviderIcon
                presetId={entry.preset.id}
                providerId={entry.profileId}
                className="h-4 w-4"
              />
            </span>
            <span className="truncate text-[13.5px] font-semibold text-ds-ink">{entry.label}</span>
          </span>
          <StatusPill tone={exists ? 'warning' : accountCount > 0 ? 'success' : 'muted'}>
            {accountCount > 0
              ? t('modelProviderAccountCount', { count: accountCount })
              : exists
              ? t('modelProviderPresetUpdateTag')
              : entry.group === 'subscription'
                ? t('modelProviderPlanBadge')
                : t('modelProviderPresetBadge')}
          </StatusPill>
        </span>
        <span className="truncate font-mono text-[11.5px] text-ds-faint">
          {entry.profileId}{multiAccount ? ` · ${t('modelProviderAddAccountHint')}` : ''}
        </span>
      </button>
    )
  }

  const pendingImportProvider = pendingImport
    ? displayProviders.find((item) => item.id === pendingImport.providerId)
    : null
  return { activeProbe, probeBusy, probeNotice, activeBaseUrlInvalid, activeImageBaseUrlInvalid, activeSpeechBaseUrlInvalid, activeSpeechToggleDisabled, activeTextToSpeechBaseUrlInvalid, activeMusicBaseUrlInvalid, activeVideoBaseUrlInvalid, activeMissingCredential, providerSetupNeedsApiKey, activeProbeBlocked, activeCursorAccount, activeCursorAccountFresh, activeCursorApiKeyUrl, activeSharedConnection, activeCredentialNeedsReplacement, activeApiKeyPlaceholder, activeApiKeyValue, activeCredentialRevealBusy, activeTokenPlanRegions, filteredProviders, planProviders, apiProviders, grouped, renderProviderButton, planAddEntries, apiAddEntries, showPlanAddGroup, renderAddEntry, pendingImportProvider }
}
