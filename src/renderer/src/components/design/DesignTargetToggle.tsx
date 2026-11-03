import type { ReactElement } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { defaultFrameSizeForDesignTarget } from '../../design/design-context'

export type DesignTargetToggleValue = 'web' | 'app'

export function DesignTargetToggle({
  designTarget,
  disabled,
  disabledReason,
  hint,
  webDetail,
  appDetail,
  variant = 'pill',
  onChange
}: {
  designTarget: DesignTargetToggleValue
  disabled?: boolean
  disabledReason?: string
  hint?: string
  webDetail?: string
  appDetail?: string
  /** `segmented` fills its row like the canvas inspector's other segmented controls. */
  variant?: 'pill' | 'segmented'
  onChange: (target: DesignTargetToggleValue) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const webSize = defaultFrameSizeForDesignTarget('web')
  const appSize = defaultFrameSizeForDesignTarget('app')
  const webName = t('designTargetWeb', 'Web')
  const appName = t('designTargetApp', 'App')
  const resolvedWebDetail =
    webDetail ??
    t('designTargetContextWeb', {
      width: webSize.width,
      height: webSize.height,
      defaultValue: `Default ${webSize.width} x ${webSize.height} web frame`
    })
  const resolvedAppDetail =
    appDetail ??
    t('designTargetContextApp', {
      width: appSize.width,
      height: appSize.height,
      defaultValue: `Default ${appSize.width} x ${appSize.height} app frame`
    })
  const webLabel = `${webName}: ${resolvedWebDetail}`
  const appLabel = `${appName}: ${resolvedAppDetail}`
  const resolvedHint =
    disabled && disabledReason
      ? disabledReason
      : (hint ?? t('designTargetHint', 'Choose whether the design agent defaults to web pages or mobile app screens'))
  const webAriaLabel = disabled && disabledReason ? `${webLabel}. ${disabledReason}` : webLabel
  const appAriaLabel = disabled && disabledReason ? `${appLabel}. ${disabledReason}` : appLabel
  const webTitle = disabled && disabledReason ? `${resolvedWebDetail}. ${disabledReason}` : resolvedWebDetail
  const appTitle = disabled && disabledReason ? `${resolvedAppDetail}. ${disabledReason}` : resolvedAppDetail
  const segmented = variant === 'segmented'
  const buttonClass = (active: boolean): string => segmented
    ? `inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] transition disabled:cursor-not-allowed disabled:opacity-55 ${
        active
          ? 'bg-ds-elevated font-medium text-ds-ink shadow-[0_1px_2px_rgba(15,23,42,0.12)] dark:bg-white/[0.14]'
          : 'hover:text-ds-ink'
      }`
    : `inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 transition disabled:cursor-not-allowed disabled:opacity-60 ${
        active
          ? 'bg-white text-ds-ink shadow-sm dark:bg-[#343c4a] dark:text-white dark:ring-1 dark:ring-inset dark:ring-white/15'
          : 'hover:bg-ds-hover hover:text-ds-ink dark:hover:bg-white/10 dark:hover:text-white/90'
      }`
  return (
    <div
      className={segmented
        ? 'flex w-full items-center gap-0.5 rounded-[10px] bg-ds-hover p-[3px] text-[12px] text-ds-muted'
        : 'inline-flex shrink-0 items-center rounded-full border border-ds-border bg-ds-surface-subtle p-0.5 text-[12px] font-semibold text-ds-muted shadow-sm dark:border-white/15 dark:bg-[#171c25] dark:text-white/65'}
      title={resolvedHint}
      aria-label={resolvedHint}
    >
      <button
        type="button"
        onClick={() => onChange('web')}
        aria-pressed={designTarget === 'web'}
        aria-label={webAriaLabel}
        title={webTitle}
        disabled={disabled}
        className={buttonClass(designTarget === 'web')}
      >
        <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {webName}
      </button>
      <button
        type="button"
        onClick={() => onChange('app')}
        aria-pressed={designTarget === 'app'}
        aria-label={appAriaLabel}
        title={appTitle}
        disabled={disabled}
        className={buttonClass(designTarget === 'app')}
      >
        <Smartphone className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
        {appName}
      </button>
    </div>
  )
}
