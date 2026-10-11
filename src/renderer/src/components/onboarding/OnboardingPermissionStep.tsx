import type { MouseEvent, ReactElement } from 'react'
import { Info, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunToolPermissionMode } from '@shared/app-settings'
import { PERMISSION_OPTIONS } from '../initial-setup-dialog-support'

export function OnboardingPermissionStep({ mode, declined, onSelect }: {
  mode: KunToolPermissionMode
  /** Set after the user cancelled Main's consent prompt for this mode. */
  declined: KunToolPermissionMode | null
  /** Receives the click so the caller can gate it as a trusted activation. */
  onSelect: (event: MouseEvent<HTMLButtonElement>, mode: KunToolPermissionMode) => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const label = (value: KunToolPermissionMode): string =>
    t(PERMISSION_OPTIONS.find((option) => option.value === value)?.labelKey ?? 'toolPermissionAskForApproval')
  return (
    <>
      <div className="kun-onb-perms" role="radiogroup" aria-label={t('firstRunPermissionLabel')}>
        {PERMISSION_OPTIONS.map((option) => {
          const on = option.value === mode
          const Icon = option.Icon
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? 'kun-onb-perm is-on' : 'kun-onb-perm'}
              onClick={(event) => onSelect(event, option.value)}
              data-onboarding-permission={option.value}
            >
              <span className="kun-onb-perm-icon" data-tone={option.tone}>
                <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="kun-onb-perm-text">
                <span className="kun-onb-perm-title">
                  {t(option.labelKey)}
                  {option.value === 'full-access' ? <span className="kun-onb-tag">{t('onboarding.permission.default')}</span> : null}
                </span>
                <span className="kun-onb-perm-desc">{t(option.descriptionKey)}</span>
              </span>
              <span className="kun-onb-radio" />
            </button>
          )
        })}
      </div>
      {declined ? (
        <div className="kun-onb-callout" data-onboarding-permission-declined role="status">
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{t('onboarding.permission.declined', { picked: label(declined), kept: label(mode) })}</span>
        </div>
      ) : mode === 'full-access' ? (
        <div className="kun-onb-callout" data-tone="warning" role="note">
          <ShieldAlert size={16} strokeWidth={1.9} aria-hidden="true" />
          <span>{t('onboarding.permission.fullNote')}</span>
        </div>
      ) : (
        <div className="kun-onb-callout">
          <Info size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{t('onboarding.permission.otherNote')}</span>
        </div>
      )}
    </>
  )
}
