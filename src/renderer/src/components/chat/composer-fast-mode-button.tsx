import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import type { ComposerFastModeState } from './composer-fast-mode'

type ComposerFastModeButtonProps = {
  state: Exclude<ComposerFastModeState, 'hidden'>
  enabled: boolean
  locked: boolean
  onToggle: () => void
}

/**
 * Codex Fast entry. It stays focusable when the provider has not confirmed the
 * priority tier so keyboard users can read why it cannot be switched on.
 */
export function ComposerFastModeButton({
  state,
  enabled,
  locked,
  onToggle
}: ComposerFastModeButtonProps): ReactElement {
  const { t } = useTranslation('common')
  const supported = state === 'supported'
  const active = supported && enabled
  const unavailableLabel = supported
    ? undefined
    : t(state === 'unsupported' ? 'composerFastModeUnsupported' : 'composerFastModeUnverified')
  const label = unavailableLabel ?? (active ? t('composerFastModeOn') : t('composerFastModeOff'))
  const disabled = !supported || locked
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onToggle()
      }}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-accent/25 ${
        active
          ? 'bg-amber-400/15 text-amber-600 hover:bg-amber-400/25 dark:text-amber-300'
          : disabled
            ? 'cursor-not-allowed text-ds-faint'
            : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
      }`}
      aria-pressed={active}
      aria-label={label}
      title={supported ? `${label} — ${t('composerFastModeHint')}` : label}
    >
      <Zap className={`h-4 w-4 ${active ? 'fill-current' : ''}`} strokeWidth={2} />
    </button>
  )
}
