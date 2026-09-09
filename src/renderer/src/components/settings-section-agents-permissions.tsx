import type {
  KunToolPermissionMode,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  kunToolPermissionModeSettings
} from '@shared/app-settings'
import type {
  ApprovalReviewModelSelection
} from '../../../../kun/src/contracts/approval-review-config.js'
import {
  Bot,
  Check,
  Hand,
  LockKeyholeOpen,
  Palette,
  ShieldCheck
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { runTrustedUserActivation } from '../extensions/protected-user-activation'
import {
  InlineNoticeView,
  SettingRow,
  SettingsCard,
  SettingsSubTabs,
  SettingsTabPanel,
  Toggle,
  ModelSelect
} from './settings-controls'
import {
  DesignQualitySettingsPanel
} from './settings-section-agent-panels'
import type {
  SharedModelConnection
} from './settings-section-providers-shared-api'
import { requestSharedModelConnections } from './settings-section-providers-shared-api'
type PermissionsSettingsPanel = 'policy' | 'quality'

const TOOL_PERMISSION_OPTIONS: Array<{ value: KunToolPermissionMode; labelKey: string; descriptionKey: string; Icon: typeof Hand; iconClass: string }> = [
  { value: 'ask-for-approval', labelKey: 'toolPermissionAskForApproval', descriptionKey: 'toolPermissionAskForApprovalDesc', Icon: Hand, iconClass: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-200' },
  { value: 'approve-for-me', labelKey: 'toolPermissionApproveForMe', descriptionKey: 'toolPermissionApproveForMeDesc', Icon: Bot, iconClass: 'border-teal-400/30 bg-teal-500/10 text-teal-700 dark:text-teal-200' },
  { value: 'full-access', labelKey: 'toolPermissionFullAccess', descriptionKey: 'toolPermissionFullAccessDesc', Icon: LockKeyholeOpen, iconClass: 'border-orange-400/35 bg-orange-500/10 text-orange-700 dark:text-orange-200' }
]

const REVIEW_SUPPORTED_KINDS = new Set<SharedModelConnection['kind']>(['http', 'agent-sdk'])

function normalizeSelection(value: unknown): ApprovalReviewModelSelection {
  return value && typeof value === 'object' && (value as { mode?: unknown }).mode === 'fixed'
    ? {
        mode: 'fixed',
        providerId: String((value as { providerId?: unknown }).providerId ?? ''),
        model: String((value as { model?: unknown }).model ?? ''),
        ...((value as { accountId?: unknown }).accountId
          ? { accountId: String((value as { accountId?: unknown }).accountId) }
          : {})
      }
    : { mode: 'inherit' }
}

export function AgentsPermissionsSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const {
    t,
    updateKun,
    selectControlClass,
    permissionsSectionRef,
    activePanel,
    activePermissionsPanel,
    setActivePermissionsPanel,
    quality,
    updateQuality,
    toolPermissionMode,
    approvalReview,
    modelProviders
  } = view
  const [connections, setConnections] = useState<SharedModelConnection[]>([])
  useEffect(() => {
    let cancelled = false
    void requestSharedModelConnections('/v1/model-connections')
      .then((snapshot) => {
        if (!cancelled) setConnections(snapshot.providers)
      })
      .catch(() => {
        if (!cancelled) setConnections([])
      })
    return () => {
      cancelled = true
    }
  }, [])
  const selection = normalizeSelection(approvalReview)
  const [draft, setDraft] = useState<ApprovalReviewModelSelection | null>(null)
  const activeSelection = draft ?? selection
  const configuredConnections = useMemo(
    () => connections.filter((connection) =>
      REVIEW_SUPPORTED_KINDS.has(connection.kind) && connection.configured !== false
    ),
    [connections]
  )
  const fallbackConnections = useMemo(() => (
    modelProviders as ModelProviderProfileV1[]
  ).map((provider) => ({
    id: provider.id,
    accountId: '',
    name: provider.name,
    kind: provider.kind ?? 'http',
    authType: provider.apiKey.trim() ? 'api-key' : 'subscription',
    endpointFormat: provider.endpointFormat,
    useProxy: provider.useProxy,
    configured: Boolean(provider.apiKey.trim()),
    credentialStatus: provider.apiKey.trim() ? 'ready' : 'missing',
    models: provider.models ?? []
  })).filter((connection) => REVIEW_SUPPORTED_KINDS.has(connection.kind)), [modelProviders])
  const providers = configuredConnections.length > 0 ? configuredConnections : fallbackConnections
  const fixed = activeSelection.mode === 'fixed'
  const provider = fixed
    ? providers.find((connection) => connection.id === activeSelection.providerId)
    : undefined
  const providerMissing = fixed && !provider
  const model = fixed ? activeSelection.model : ''
  const modelOptions = provider?.models ?? []
  const canApply = activeSelection.mode === 'inherit'
    ? selection.mode !== 'inherit'
    : Boolean(
        activeSelection.providerId.trim() &&
        activeSelection.model.trim() &&
        provider &&
        !providerMissing &&
        (
          selection.mode !== 'fixed' ||
          selection.providerId !== activeSelection.providerId ||
          selection.model !== activeSelection.model ||
          (selection.accountId ?? '') !== (activeSelection.accountId ?? '')
        )
      )
  const applySelection = (): void => {
    updateKun({ approvalReview: activeSelection })
    setDraft(null)
  }

  return (
    <>
      <div
        id="agents-settings-panel-permissions"
        role="tabpanel"
        aria-labelledby="agents-settings-tab-permissions"
        className={activePanel === 'permissions' ? 'grid gap-4' : 'hidden'}
      >
        <div ref={permissionsSectionRef} className="grid gap-4">
          <SettingsSubTabs<PermissionsSettingsPanel>
            baseId="agents-permissions"
            ariaLabel={t('permissions')}
            items={[
              { id: 'policy', label: t('toolPermissionMode'), icon: ShieldCheck },
              { id: 'quality', label: t('designQualityTitle'), icon: Palette }
            ]}
            value={activePermissionsPanel}
            onChange={setActivePermissionsPanel}
          />

          <SettingsTabPanel<PermissionsSettingsPanel>
            baseId="agents-permissions"
            tabId="policy"
            active={activePermissionsPanel === 'policy'}
          >
            <SettingsCard title={t('permissions')}>
              <div className="px-3 py-4">
                <InlineNoticeView notice={{ tone: 'info', message: t('permissionsBehaviorHint') }} />
              </div>
              <SettingRow
                title={t('toolPermissionMode')}
                description={t('toolPermissionModeDesc')}
                wideControl
                control={
                  <div
                    role="radiogroup"
                    aria-label={t('toolPermissionMode')}
                    className="grid gap-2 lg:grid-cols-3"
                  >
                    {TOOL_PERMISSION_OPTIONS.map((option) => {
                      const selected = toolPermissionMode === option.value
                      const PermissionIcon = option.Icon
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={(event) => runTrustedUserActivation(
                            event,
                            () => updateKun(kunToolPermissionModeSettings(option.value))
                          )}
                          className={`min-h-[72px] rounded-lg border px-3 py-2.5 text-left transition ${
                            selected
                              ? 'border-accent/55 bg-accent/10 text-ds-ink'
                              : 'border-ds-border-muted bg-ds-card/70 text-ds-ink hover:bg-ds-hover/70'
                          }`}
                        >
                          <span className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${option.iconClass}`}
                            >
                              <PermissionIcon className="h-4 w-4" strokeWidth={1.9} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13px] font-semibold">{t(option.labelKey)}</span>
                              <span className="mt-1 block text-[12px] leading-snug text-ds-muted">
                                {t(option.descriptionKey)}
                              </span>
                            </span>
                            {selected ? (
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                            ) : null}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                }
              />
              <SettingRow
                title={t('approvalReviewModelTitle')}
                description={t('approvalReviewModelDesc')}
                wideControl
                control={
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Toggle
                        checked={activeSelection.mode === 'fixed'}
                        onChange={(enabled) => {
                          if (!enabled) {
                            setDraft({ mode: 'inherit' })
                            return
                          }
                          setDraft({
                            mode: 'fixed',
                            providerId: selection.mode === 'fixed' ? selection.providerId : '',
                            model: selection.mode === 'fixed' ? selection.model : '',
                            ...(selection.mode === 'fixed' && selection.accountId
                              ? { accountId: selection.accountId }
                              : {})
                          })
                        }}
                      />
                      <span className="text-[12.5px] text-ds-muted">
                        {activeSelection.mode === 'fixed'
                          ? t('approvalReviewFixed')
                          : t('approvalReviewInherit')}
                      </span>
                    </div>
                    {activeSelection.mode === 'fixed' ? (
                      <>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <select
                            aria-label={t('approvalReviewProvider')}
                            className={selectControlClass}
                            value={activeSelection.providerId}
                            onChange={(event) => {
                              const providerId = event.target.value
                              const connection = providers.find((item) => item.id === providerId)
                              setDraft({
                                mode: 'fixed',
                                providerId,
                                model: connection?.models?.[0] ?? '',
                                ...(connection?.accountId ? { accountId: connection.accountId } : {})
                              })
                            }}
                          >
                            <option value="">{t('approvalReviewProvider')}</option>
                            {providers.map((connection) => (
                              <option key={connection.id} value={connection.id}>{connection.name}</option>
                            ))}
                          </select>
                          <ModelSelect
                            value={model}
                            options={modelOptions}
                            allowCustom
                            customLabel={t('modelSelectCustomOption')}
                            customPlaceholder={t('modelSelectCustomPlaceholder')}
                            selectClassName={selectControlClass}
                            onChange={(nextModel: string) => {
                              setDraft({
                                mode: 'fixed',
                                providerId: activeSelection.providerId,
                                model: nextModel.trim(),
                                ...(activeSelection.accountId
                                  ? { accountId: activeSelection.accountId }
                                  : {})
                              })
                            }}
                          />
                        </div>
                        {providerMissing ? (
                          <InlineNoticeView
                            notice={{ tone: 'info', message: t('approvalReviewModelUnavailable') }}
                          />
                        ) : null}
                      </>
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] leading-5 text-ds-muted">
                        {toolPermissionMode === 'approve-for-me'
                          ? t('approvalReviewDataNotice')
                          : t('approvalReviewInactiveNotice')}
                      </span>
                      <button
                        type="button"
                        disabled={!canApply}
                        onClick={(event) => runTrustedUserActivation(event, applySelection)}
                        className="rounded-md border border-accent/45 px-3 py-1.5 text-[12.5px] font-medium text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:border-ds-border-muted disabled:text-ds-muted"
                      >
                        {t('approvalReviewApply')}
                      </button>
                    </div>
                  </div>
                }
              />
            </SettingsCard>
          </SettingsTabPanel>

          <SettingsTabPanel<PermissionsSettingsPanel>
            baseId="agents-permissions"
            tabId="quality"
            active={activePermissionsPanel === 'quality'}
            className="[&>div]:mt-0"
          >
            <DesignQualitySettingsPanel
              t={t}
              value={quality}
              selectControlClass={selectControlClass}
              onChange={updateQuality}
            />
          </SettingsTabPanel>
        </div>
      </div>
    </>
  )
}
