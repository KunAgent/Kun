import type { ReactElement } from 'react'
import { SettingRow, Toggle } from './settings-controls'

/** Offered no-response windows in seconds; 0 keeps every card waiting for the user. */
export const DISPATCH_AUTO_START_CHOICES = [30, 60, 180, 300, 600, 0] as const

/** Short label for one no-response window choice ("1 min", "Never"). */
export function dispatchAutoStartLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  seconds: number
): string {
  if (seconds <= 0) return t('adeSettings.dispatchAutoStartOff')
  if (seconds % 60 === 0) return t('adeSettings.dispatchAutoStartMinutes', { n: seconds / 60 })
  return t('adeSettings.dispatchAutoStartSeconds', { n: seconds })
}

/**
 * How long a dispatch card waits for the user before starting with its
 * recommendation. Values written elsewhere (Kun config) stay selectable.
 */
export function DispatchAutoStartSettingRows({ t, seconds, whenConfirmationRequired, onSeconds, onWhenConfirmationRequired }: {
  t: (key: string, options?: Record<string, unknown>) => string
  seconds: number
  whenConfirmationRequired: boolean
  onSeconds: (seconds: number) => void
  onWhenConfirmationRequired: (value: boolean) => void
}): ReactElement {
  const choices: number[] = (DISPATCH_AUTO_START_CHOICES as readonly number[]).includes(seconds)
    ? [...DISPATCH_AUTO_START_CHOICES]
    : [...DISPATCH_AUTO_START_CHOICES.filter((value) => value > 0), seconds, 0].sort((a, b) => (a || Infinity) - (b || Infinity))
  return <>
    <SettingRow
      title={t('adeSettings.dispatchAutoStart')}
      description={t('adeSettings.dispatchAutoStartDesc')}
      control={
        <select
          data-dispatch-auto-start
          className="min-w-[9rem] rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none"
          value={String(seconds)}
          onChange={(event) => onSeconds(Number(event.target.value))}
        >
          {choices.map((value) => <option key={value} value={String(value)}>{dispatchAutoStartLabel(t, value)}</option>)}
        </select>
      }
    />
    <SettingRow
      title={t('adeSettings.dispatchAutoStartConfirm')}
      description={t('adeSettings.dispatchAutoStartConfirmDesc')}
      control={
        <Toggle checked={whenConfirmationRequired && seconds > 0} disabled={seconds <= 0}
          ariaLabel={t('adeSettings.dispatchAutoStartConfirm')} onChange={onWhenConfirmationRequired} />
      }
    />
  </>
}
