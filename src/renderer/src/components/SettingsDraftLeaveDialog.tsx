import { settingsButtonClass } from './settings-button'
import type { ReactElement } from 'react'

export function SettingsDraftLeaveDialog({
  t,
  busy,
  saveFailed,
  onChoice
}: {
  t: (key: string) => string
  busy: boolean
  saveFailed: boolean
  onChoice: (choice: 'save' | 'discard' | 'keep') => void
}): ReactElement {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 ds-no-drag">
      <div role="dialog" aria-modal="true" aria-label={t('adeSettings.collaborationLeaveTitle')}
        onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onChoice('keep') }}
        className="w-full max-w-md rounded-2xl border border-ds-border bg-ds-card p-5 shadow-2xl">
        <h2 className="text-[16px] font-semibold text-ds-ink">{t('adeSettings.collaborationLeaveTitle')}</h2>
        <p className="mt-2 text-[13px] text-ds-muted">{t('adeSettings.collaborationLeaveDesc')}</p>
        {saveFailed ? <p role="alert" className="mt-2 text-[12px] text-rose-600 dark:text-rose-300">
          {t('adeSettings.collaborationLeaveSaveFailed')}
        </p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className={settingsButtonClass()} type="button" autoFocus disabled={busy} onClick={() => onChoice('keep')}
            >
            {t('adeSettings.collaborationKeepEditing')}
          </button>
          <button className={settingsButtonClass()} type="button" disabled={busy} onClick={() => onChoice('discard')}
            >
            {t('adeSettings.collaborationDiscard')}
          </button>
          <button type="button" disabled={busy} onClick={() => onChoice('save')}
            className={settingsButtonClass({ variant: 'primary' })}>
            {t('adeSettings.collaborationSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
