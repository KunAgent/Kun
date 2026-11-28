import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Link2, Pin, Sparkles } from 'lucide-react'
import './whats-new-everyday-previews.css'

export type WhatsNewEverydayDestination = 'daily-notes' | 'widget-apps' | 'phone-link'

function DailyNotesPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--daily" aria-hidden="true">
      <div className="kun-wn-dn-window">
        <div className="kun-wn-dn-bar">
          <span className="kun-wn-dn-day"><b /><i /></span>
          <span className="kun-wn-dn-pin"><Pin size={9} strokeWidth={2.2} /></span>
        </div>
        <div className="kun-wn-dn-body">
          <div className="kun-wn-dn-task" data-done="true">
            <span className="kun-wn-dn-check"><Check size={8} strokeWidth={3} /></span>
            <div className="kun-wn-dn-lines"><i data-tone="done" /><em /></div>
          </div>
          <div className="kun-wn-dn-task">
            <span className="kun-wn-dn-check" />
            <div className="kun-wn-dn-lines"><i /><em data-short="true" /></div>
            <span className="kun-wn-dn-kun"><Sparkles size={8} strokeWidth={2.2} /></span>
          </div>
          <div className="kun-wn-dn-task">
            <span className="kun-wn-dn-check" />
            <div className="kun-wn-dn-lines"><i data-short="true" /></div>
            <span className="kun-wn-dn-dots"><b /><b /><b /><b /></span>
          </div>
          <div className="kun-wn-dn-subnote"><i /><i data-short="true" /></div>
        </div>
      </div>
    </div>
  )
}

function WidgetAppsPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--widgets" aria-hidden="true">
      <div className="kun-wn-wa-window">
        <div className="kun-wn-wa-bar"><i /><i /><i /><span /></div>
        <div className="kun-wn-wa-body">
          <div className="kun-wn-wa-chart">
            <svg viewBox="0 0 96 40" preserveAspectRatio="none">
              <path className="kun-wn-wa-area" d="M4,30 C20,28 26,14 42,16 C58,18 64,8 92,6 L92,40 L4,40 Z" />
              <path className="kun-wn-wa-line" d="M4,30 C20,28 26,14 42,16 C58,18 64,8 92,6" />
            </svg>
          </div>
          <div className="kun-wn-wa-controls"><span /><span data-tone="1" /><i /></div>
        </div>
      </div>
      <div className="kun-wn-wa-dock">
        <span className="kun-wn-wa-icon" data-tone="0"><b /></span>
        <span className="kun-wn-wa-icon" data-tone="1"><b /></span>
        <span className="kun-wn-wa-icon kun-wn-wa-icon--new" data-tone="2"><b /><em /></span>
      </div>
    </div>
  )
}

function PhoneLinkPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--phone" aria-hidden="true">
      <div className="kun-wn-pl-desktop">
        <div className="kun-wn-pl-screen"><i /><i data-short="true" /><em /></div>
      </div>
      <div className="kun-wn-pl-waves">
        <span /><span /><span />
        <b className="kun-wn-pl-lock"><Link2 size={9} strokeWidth={2.4} /></b>
      </div>
      <div className="kun-wn-pl-phone">
        <div className="kun-wn-pl-notch" />
        <div className="kun-wn-pl-messages"><i /><i data-tone="1" /><i data-short="true" /></div>
      </div>
    </div>
  )
}

const FEATURES: ReadonlyArray<{
  id: WhatsNewEverydayDestination
  title: string
  body: string
  action: string
  Preview: () => ReactElement
}> = [
  {
    id: 'daily-notes',
    title: 'whatsNewEverydayDailyTitle',
    body: 'whatsNewEverydayDailyBody',
    action: 'whatsNewEverydayDailyAction',
    Preview: DailyNotesPreview
  },
  {
    id: 'widget-apps',
    title: 'whatsNewEverydayWidgetsTitle',
    body: 'whatsNewEverydayWidgetsBody',
    action: 'whatsNewEverydayWidgetsAction',
    Preview: WidgetAppsPreview
  },
  {
    id: 'phone-link',
    title: 'whatsNewEverydayPhoneTitle',
    body: 'whatsNewEverydayPhoneBody',
    action: 'whatsNewEverydayPhoneAction',
    Preview: PhoneLinkPreview
  }
]

/** Decorative product sketches for the 0.4.7 release card, with direct jump actions. */
export function WhatsNewEverydayHighlights({
  onSelect
}: {
  onSelect: (destination: WhatsNewEverydayDestination) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kun-wn-everyday-highlights" data-whats-new-everyday>
      <div className="kun-wn-workbench-label">
        <span>{t('whatsNewWorkbenchHighlights')}</span>
        <span>{t('whatsNewWorkbenchPreview')}</span>
      </div>
      <ul className="kun-wn-everyday-features">
        {FEATURES.map(({ id, title, body, action, Preview }) => (
          <li key={id} className="kun-wn-everyday-card" data-whats-new-feature={id}>
            <Preview />
            <div className="kun-wn-everyday-copy">
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
              <button
                type="button"
                className="kun-wn-everyday-action"
                data-whats-new-action={id}
                onClick={() => onSelect(id)}
              >
                <span>{t(action)}</span>
                <ArrowRight size={13} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
