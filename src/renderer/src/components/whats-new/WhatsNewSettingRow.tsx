import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { settingsButtonClass } from '../settings-button'
import { SettingRow } from '../settings-controls'
import { openCurrentWhatsNew } from './whats-new-store'

/** Settings › Updates: reopen the running version's "what's new" dialog. */
export function WhatsNewSettingRow(): ReactElement | null {
  const { t } = useTranslation('common')
  const [opening, setOpening] = useState(false)
  if (typeof window === 'undefined' || typeof window.kunGui?.getReleaseNotice !== 'function') return null
  return (
    <SettingRow
      title={t('whatsNewSettingTitle')}
      description={t('whatsNewSettingDesc')}
      control={
        <button
          type="button"
          className={settingsButtonClass()}
          aria-busy={opening}
          disabled={opening}
          onClick={() => {
            setOpening(true)
            void openCurrentWhatsNew().finally(() => setOpening(false))
          }}
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
          {t('whatsNewSettingOpen')}
        </button>
      }
    />
  )
}
