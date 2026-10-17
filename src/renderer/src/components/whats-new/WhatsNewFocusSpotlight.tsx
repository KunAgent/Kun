import { useId, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Focus } from 'lucide-react'
import kunLogoUrl from '../../../../asset/img/kun_bird.png'
import { useFocusModeStore } from '../../store/focus-mode-store'
import './whats-new-spotlight.css'

/**
 * A small drawing of the workbench. The parts Focus mode hides carry a dashed
 * outline and a label while it is off, and fold away once it is on.
 */
function FocusPreview(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kun-wn-fp" aria-hidden="true">
      <div className="kun-wn-fp-side">
        <span className="kun-wn-fp-row">
          <span className="kun-wn-fp-avatar" data-tone="0" />
          <span className="kun-wn-fp-line" />
        </span>
        <span className="kun-wn-fp-row">
          <span className="kun-wn-fp-avatar" data-tone="1" />
          <span className="kun-wn-fp-line" />
        </span>
        <span className="kun-wn-fp-line" data-w="80" />
        <span className="kun-wn-fp-line" data-w="64" />
        <span className="kun-wn-fp-fill" />
        <span className="kun-wn-fp-account kun-wn-fp-hides">
          <span className="kun-wn-fp-tag">{t('whatsNewFocusPreviewAccount')}</span>
          <span className="kun-wn-fp-account-card">
            <span className="kun-wn-fp-account-face" />
            <span className="kun-wn-fp-account-lines">
              <span />
              <span />
            </span>
          </span>
        </span>
        <span className="kun-wn-fp-pill">
          {t('focusMode')}
          <span className="kun-wn-fp-pill-track"><span /></span>
        </span>
      </div>
      <div className="kun-wn-fp-main">
        <span className="kun-wn-fp-bubble" />
        <span className="kun-wn-fp-logo kun-wn-fp-hides">
          <span className="kun-wn-fp-logo-mark">
            <img src={kunLogoUrl} alt="" draggable={false} />
          </span>
          <span className="kun-wn-fp-tag">{t('whatsNewFocusPreviewLogo')}</span>
        </span>
        <span className="kun-wn-fp-line" data-w="92" />
        <span className="kun-wn-fp-line" data-w="80" />
        <span className="kun-wn-fp-line" data-w="66" />
      </div>
      <span className="kun-wn-fp-calm">{t('whatsNewFocusPreviewCalm')}</span>
    </div>
  )
}

/**
 * 0.4.1's card: Focus mode hides the Kun logo and the account card. The switch
 * flips the real preference, so the sidebar behind the dialog changes with it.
 */
export function WhatsNewFocusSpotlight(): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  const enabled = useFocusModeStore((state) => state.enabled)
  const setEnabled = useFocusModeStore((state) => state.setEnabled)
  return (
    <section
      className="kun-wn-spotlight"
      aria-labelledby={titleId}
      data-whats-new-spotlight="focus-mode"
      data-on={enabled ? 'true' : 'false'}
    >
      <FocusPreview />
      <div className="kun-wn-spotlight-text">
        <span className="kun-wn-spotlight-tag">
          <Focus className="h-3 w-3" strokeWidth={2} aria-hidden />
          {t('whatsNewFocusTag')}
        </span>
        <h3 id={titleId} className="kun-wn-spotlight-title">{t('whatsNewFocusTitle')}</h3>
        <p className="kun-wn-spotlight-body">{t('whatsNewFocusBody')}</p>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('whatsNewFocusTag')}
          className="kun-wn-spotlight-switch"
          data-whats-new-focus-switch
          onClick={() => setEnabled(!enabled)}
        >
          <span>{t(enabled ? 'whatsNewFocusOn' : 'whatsNewFocusTry')}</span>
          <span className="kun-wn-spotlight-track" aria-hidden="true">
            <span className="kun-wn-spotlight-thumb" />
          </span>
        </button>
        <span className="kun-wn-spotlight-where">{t('whatsNewFocusWhere')}</span>
      </div>
    </section>
  )
}
