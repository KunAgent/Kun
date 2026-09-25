import type {
  ModelProviderFailoverV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1,
  ProviderAccountStrategy
} from '@shared/app-settings'
import {
  PROVIDER_ACCOUNT_STRATEGIES,
  modelProviderFailoverGroup,
  modelProviderIsOauthOrDelegated
} from '@shared/app-settings'
import { Plus, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { Toggle } from './settings-controls'
import {
  DetailSection,
  providerSelectControlClass,
  textInputClass
} from './settings-section-providers-controls'
import type { ProviderTaskTab } from './settings-section-providers-profile'
import { SettingsTabPanel } from './settings-controls'

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Reliability tab (plan §6.4/§6.11): account-group strategy plus an ordered
 * cross-provider fallback chain. Accounts are sibling provider profiles on the
 * same host (multiple keys for one vendor); fallback targets are concrete
 * `provider/model` pairs tried after every account is exhausted.
 */
export function ProviderReliabilityPanel({
  provider,
  providerSettings,
  t,
  activeTab,
  onFailoverChange
}: {
  provider: ModelProviderProfileV1
  providerSettings: Pick<ModelProviderSettingsV1, 'providers' | 'failover'>
  t: (key: string, options?: Record<string, unknown>) => string
  activeTab: ProviderTaskTab
  onFailoverChange: (failover: ModelProviderFailoverV1[]) => void
}): ReactElement {
  const failover = providerSettings.failover ?? []
  const group = modelProviderFailoverGroup(providerSettings, provider.id)
  const isRepresentative = group?.providerId === provider.id

  const saveGroup = (next: ModelProviderFailoverV1): void => {
    onFailoverChange(failover.map((existing) =>
      existing.providerId === next.providerId ? next : existing
    ))
  }
  const createGroup = (): void => {
    onFailoverChange([...failover, {
      providerId: provider.id,
      accounts: [],
      strategy: 'smart',
      fallbackTargets: []
    }])
  }
  const removeGroup = (): void => {
    if (!group) return
    onFailoverChange(failover.filter((existing) => existing.providerId !== group.providerId))
  }

  const host = hostOf(provider.baseUrl)
  const memberIds = new Set(group ? [group.providerId, ...group.accounts.map((a) => a.providerId)] : [])
  const providersById = new Map(providerSettings.providers.map((candidate) => [candidate.id, candidate]))
  const hasOauthMembers = [...memberIds].some((id) => modelProviderIsOauthOrDelegated(providersById.get(id)))
  const accountCandidates = providerSettings.providers.filter((candidate) =>
    !memberIds.has(candidate.id) &&
    (host ? hostOf(candidate.baseUrl) === host : candidate.id !== provider.id)
  )
  const fallbackCandidates = providerSettings.providers.filter((candidate) =>
    !memberIds.has(candidate.id)
  )
  const nameFor = (id: string): string =>
    providerSettings.providers.find((candidate) => candidate.id === id)?.name.trim() || id

  return (
    <SettingsTabPanel<ProviderTaskTab>
      baseId="provider-settings"
      tabId="reliability"
      active={activeTab === 'reliability'}
      className="grid gap-4"
    >
      <DetailSection
        title={t('modelProviderFailoverSection')}
        action={group ? undefined : (
          <button
            type="button"
            onClick={createGroup}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            {t('modelProviderFailoverEnable')}
          </button>
        )}
      >
        {!group ? (
          <p className="text-[12px] leading-5 text-ds-faint">
            {t('modelProviderFailoverDisabledHint')}
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-ds-muted">
                {t('modelProviderFailoverStrategy')}
              </span>
              <div className="inline-flex w-fit items-center rounded-lg border border-ds-border-muted bg-ds-main/70 p-0.5">
                {PROVIDER_ACCOUNT_STRATEGIES.map((strategy) => {
                  const selected = group.strategy === strategy
                  // OAuth/subscription members cannot spread requests across
                  // interactive sessions — the runtime degrades rotate and
                  // least-used to smart, so the picker disables them.
                  const oauthDisabled = hasOauthMembers
                    && (strategy === 'rotate' || strategy === 'least-used')
                  return (
                    <button
                      key={strategy}
                      type="button"
                      aria-pressed={selected}
                      disabled={oauthDisabled}
                      title={oauthDisabled ? t('modelProviderFailoverOauthStrategyHint') : undefined}
                      onClick={() => saveGroup({ ...group, strategy })}
                      className={`rounded-md px-3 py-1.5 text-[12px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                        selected
                          ? 'bg-ds-card text-ds-ink shadow-sm'
                          : oauthDisabled
                            ? 'cursor-not-allowed text-ds-faint opacity-50'
                            : 'text-ds-faint hover:text-ds-muted'
                      }`}
                    >
                      {t(`modelProviderFailoverStrategy_${strategy}`)}
                    </button>
                  )
                })}
              </div>
              <p className="text-[12px] leading-5 text-ds-faint">
                {t(`modelProviderFailoverStrategyDesc_${group.strategy}`)}
              </p>
              {hasOauthMembers ? (
                <p className="text-[11.5px] leading-4 text-amber-600 dark:text-amber-300">
                  {t('modelProviderFailoverOauthStrategyHint')}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <span className="text-[12.5px] font-medium text-ds-muted">
                {t('modelProviderFailoverAccounts')}
              </span>
              <div className="grid gap-1.5">
                {[group.providerId, ...group.accounts.map((account) => account.providerId)].map((id) => {
                  const representative = id === group.providerId
                  const account = group.accounts.find((entry) => entry.providerId === id)
                  const memberExists = providerSettings.providers.some(
                    (candidate) => candidate.id === id
                  )
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-2.5 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2"
                    >
                      {!representative ? (
                        <Toggle
                          ariaLabel={t('modelProviderFailoverAccountEnabled')}
                          checked={account?.enabled !== false}
                          onChange={(enabled) => saveGroup({
                            ...group,
                            accounts: group.accounts.map((entry) =>
                              entry.providerId === id ? { ...entry, enabled } : entry
                            )
                          })}
                        />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ds-ink">
                        {nameFor(id)}
                        <span className="ml-1.5 text-[11px] text-ds-faint">{id}</span>
                      </span>
                      {!memberExists ? (
                        <span className="text-[11px] font-medium text-red-600 dark:text-red-300">
                          {t('modelProviderFailoverInvalidMember')}
                        </span>
                      ) : null}
                      {representative ? (
                        <span className="text-[11px] font-medium text-ds-faint">
                          {t('modelProviderFailoverPrimary')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={t('modelProviderFailoverAccountRemove')}
                          onClick={() => saveGroup({
                            ...group,
                            accounts: group.accounts.filter((entry) => entry.providerId !== id)
                          })}
                          className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              {accountCandidates.length > 0 ? (
                <select
                  className={providerSelectControlClass}
                  value=""
                  onChange={(event) => {
                    const providerId = event.target.value
                    if (!providerId) return
                    saveGroup({
                      ...group,
                      accounts: [...group.accounts, { providerId, enabled: true }]
                    })
                  }}
                >
                  <option value="">{t('modelProviderFailoverAccountAdd')}</option>
                  {accountCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name.trim() || candidate.id}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div className="grid gap-2">
              <span className="text-[12.5px] font-medium text-ds-muted">
                {t('modelProviderFailoverFallbacks')}
              </span>
              <p className="text-[12px] leading-5 text-ds-faint">
                {t('modelProviderFailoverFallbacksHint')}
              </p>
              <div className="grid gap-1.5">
                {group.fallbackTargets.map((target, index) => {
                  const targetProvider = providerSettings.providers.find(
                    (candidate) => candidate.id === target.providerId
                  )
                  const targetInvalid = !targetProvider
                    || !targetProvider.models.includes(target.modelId)
                  return (
                    <div
                      key={`${target.providerId}/${target.modelId}/${index}`}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                        targetInvalid
                          ? 'border-red-300/70 bg-red-50/40 dark:border-red-500/30 dark:bg-red-500/10'
                          : 'border-ds-border-muted bg-ds-card'
                      }`}
                    >
                      <span className="text-[11px] font-medium tabular-nums text-ds-faint">
                        {index + 1}
                      </span>
                      <select
                        className={`${providerSelectControlClass} max-w-44`}
                        value={target.providerId}
                        onChange={(event) => {
                          const providerId = event.target.value
                          const modelId = providerSettings.providers
                            .find((candidate) => candidate.id === providerId)?.models[0] ?? ''
                          saveGroup({
                            ...group,
                            fallbackTargets: group.fallbackTargets.map((entry, i) =>
                              i === index ? { providerId, modelId } : entry
                            )
                          })
                        }}
                      >
                        {fallbackCandidates.concat(targetProvider ? [targetProvider] : [])
                          .filter((candidate, i, all) => all.findIndex((x) => x.id === candidate.id) === i)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.name.trim() || candidate.id}
                            </option>
                          ))}
                      </select>
                      <select
                        className={`${providerSelectControlClass} min-w-0 flex-1`}
                        value={target.modelId}
                        onChange={(event) => saveGroup({
                          ...group,
                          fallbackTargets: group.fallbackTargets.map((entry, i) =>
                            i === index ? { ...entry, modelId: event.target.value } : entry
                          )
                        })}
                      >
                        {!targetProvider?.models.includes(target.modelId) && target.modelId ? (
                          <option value={target.modelId}>{target.modelId}</option>
                        ) : null}
                        {(targetProvider?.models ?? []).map((modelId) => (
                          <option key={modelId} value={modelId}>{modelId}</option>
                        ))}
                      </select>
                      {targetInvalid ? (
                        <span className="shrink-0 text-[11px] font-medium text-red-600 dark:text-red-300">
                          {t('modelProviderFailoverInvalidFallback')}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-label={t('modelProviderFailoverFallbackRemove')}
                        onClick={() => saveGroup({
                          ...group,
                          fallbackTargets: group.fallbackTargets.filter((_, i) => i !== index)
                        })}
                        className="rounded-md p-1 text-ds-faint transition hover:bg-ds-hover hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </button>
                    </div>
                  )
                })}
              </div>
              {fallbackCandidates.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    const candidate = fallbackCandidates[0]
                    const modelId = candidate.models[0] ?? ''
                    if (!modelId) return
                    saveGroup({
                      ...group,
                      fallbackTargets: [...group.fallbackTargets, {
                        providerId: candidate.id,
                        modelId
                      }]
                    })
                  }}
                  className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-dashed border-ds-border px-3 text-[12px] font-medium text-ds-muted transition hover:border-accent/40 hover:text-ds-ink"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  {t('modelProviderFailoverFallbackAdd')}
                </button>
              ) : null}
            </div>

            {isRepresentative ? (
              <button
                type="button"
                onClick={removeGroup}
                className="w-fit text-[12px] font-medium text-red-600 underline-offset-2 transition hover:underline dark:text-red-300"
              >
                {t('modelProviderFailoverDisable')}
              </button>
            ) : (
              <p className="text-[12px] leading-5 text-ds-faint">
                {t('modelProviderFailoverMemberHint', { owner: group.providerId })}
              </p>
            )}
          </div>
        )}
      </DetailSection>
    </SettingsTabPanel>
  )
}
