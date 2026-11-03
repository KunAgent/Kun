import { settingsButtonClass } from './settings-button'
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
  TriangleAlert
} from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { runTrustedUserActivation } from '../extensions/protected-user-activation'
import {
  InlineNoticeView,
  SettingsCard,
  SettingsReveal,
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
const TOOL_PERMISSION_OPTIONS: Array<{ value: KunToolPermissionMode; labelKey: string; descriptionKey: string; Icon: typeof Hand; tone: string }> = [
  { value: 'ask-for-approval', labelKey: 'toolPermissionAskForApproval', descriptionKey: 'toolPermissionAskForApprovalDesc', Icon: Hand, tone: 'var(--ds-accent)' },
  { value: 'approve-for-me', labelKey: 'toolPermissionApproveForMe', descriptionKey: 'toolPermissionApproveForMeDesc', Icon: Bot, tone: 'color-mix(in srgb, var(--ds-accent) 45%, var(--ds-success))' },
  { value: 'full-access', labelKey: 'toolPermissionFullAccess', descriptionKey: 'toolPermissionFullAccessDesc', Icon: LockKeyholeOpen, tone: 'color-mix(in srgb, var(--ds-warning) 62%, var(--ds-danger))' }
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
    <div id="agents-settings-panel-permissions" ref={permissionsSectionRef} className="ds-settings-panel-stack">
      <SettingsCard title={t('toolPermissionMode')} description={t('toolPermissionModeDesc')}>
        <div role="radiogroup" aria-label={t('toolPermissionMode')} className="ds-settings-option-grid">
          {TOOL_PERMISSION_OPTIONS.map((option) => {
            const selected = toolPermissionMode === option.value
            const PermissionIcon = option.Icon
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-permission-mode={option.value}
                className="ds-settings-option"
                style={{ '--option-tone': option.tone } as CSSProperties}
                onClick={(event) => runTrustedUserActivation(
                  event,
                  () => updateKun(kunToolPermissionModeSettings(option.value))
                )}
              >
                <span className="ds-settings-option-icon" aria-hidden="true">
                  <PermissionIcon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <span className="ds-settings-option-title">{t(option.labelKey)}</span>
                <span className="ds-settings-option-description">{t(option.descriptionKey)}</span>
                <span className="ds-settings-option-check" aria-hidden="true">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            )
          })}
        </div>
        <SettingsReveal open={toolPermissionMode === 'full-access'}>
          <p className="ds-settings-consequence">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
            <span>{t('settingsIaFullAccessConsequence')}</span>
          </p>
        </SettingsReveal>
        <div className="px-3 pb-4 pt-1">
          <InlineNoticeView notice={{ tone: 'info', message: t('permissionsBehaviorHint') }} />
        </div>
      </SettingsCard>

      <SettingsCard title={t('approvalReviewModelTitle')} description={t('approvalReviewModelDesc')}>
        <div className="px-3 py-3.5">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <Toggle
                ariaLabel={t('approvalReviewModelTitle')}
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
              <button className={settingsButtonClass()}
                type="button"
                disabled={!canApply}
                onClick={(event) => runTrustedUserActivation(event, applySelection)}
              >
                {t('approvalReviewApply')}
              </button>
            </div>
          </div>
        </div>
      </SettingsCard>

      <DesignQualitySettingsPanel
        t={t}
        value={quality}
        selectControlClass={selectControlClass}
        onChange={updateQuality}
      />
    </div>
  )
}
