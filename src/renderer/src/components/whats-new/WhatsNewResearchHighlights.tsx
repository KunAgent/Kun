import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, Cloud, FileText, Gauge } from 'lucide-react'
import './whats-new-research-previews.css'

export type WhatsNewResearchDestination = 'notebook' | 'latex' | 'agents'

function NotebookPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--notebook" aria-hidden="true">
      <div className="kun-wn-nb-window">
        <div className="kun-wn-nb-bar">
          <span className="kun-wn-nb-file">
            <Cloud size={10} strokeWidth={2} />
            <i />
          </span>
          <span className="kun-wn-nb-gpu">
            <b />
            <span>GPU</span>
          </span>
        </div>
        <div className="kun-wn-nb-body">
          <div className="kun-wn-nb-cell">
            <span className="kun-wn-nb-tick"><Check size={9} strokeWidth={2.6} /></span>
            <div className="kun-wn-nb-code">
              <span><b /><i /></span>
              <em />
            </div>
          </div>
          <div className="kun-wn-nb-output">
            <svg viewBox="0 0 108 34" className="kun-wn-nb-chart" preserveAspectRatio="none">
              <path
                className="kun-wn-nb-area"
                d="M2,6 C22,8 34,20 54,23 C74,26 88,28 106,30 L106,34 L2,34 Z"
              />
              <path
                className="kun-wn-nb-line"
                d="M2,6 C22,8 34,20 54,23 C74,26 88,28 106,30"
              />
            </svg>
            <div className="kun-wn-nb-meters">
              <span data-tone="0"><i /></span>
              <span data-tone="1"><i /></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LatexPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--latex" aria-hidden="true">
      <div className="kun-wn-lx-window">
        <div className="kun-wn-lx-bar">
          <div className="kun-wn-lx-modes">
            <i />
            <span><FileText size={9} strokeWidth={2} /></span>
            <i />
          </div>
          <b className="kun-wn-lx-synced" />
        </div>
        <div className="kun-wn-lx-split">
          <div className="kun-wn-lx-source">
            <b />
            <i />
            <i data-short="true" />
            <em />
            <i />
          </div>
          <div className="kun-wn-lx-paper">
            <b />
            <span className="kun-wn-lx-authors" />
            <div className="kun-wn-lx-columns">
              <div><i /><i /><i /></div>
              <div><i /><em /><i /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuotaPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--quota" aria-hidden="true">
      <div className="kun-wn-qt-window">
        <div className="kun-wn-qt-bar">
          <Gauge size={10} strokeWidth={2} />
          <div className="kun-wn-qt-tabs"><i /><span /></div>
        </div>
        <div className="kun-wn-qt-pools">
          <div className="kun-wn-qt-row" data-tone="0">
            <b />
            <span className="kun-wn-qt-track"><i /></span>
            <em />
          </div>
          <div className="kun-wn-qt-row" data-tone="1">
            <b />
            <span className="kun-wn-qt-track"><i /></span>
            <em />
          </div>
        </div>
        <div className="kun-wn-qt-agents">
          <span data-tone="0" />
          <span data-tone="1" />
          <span data-tone="2" />
        </div>
      </div>
    </div>
  )
}

const FEATURES: ReadonlyArray<{
  id: WhatsNewResearchDestination
  title: string
  body: string
  action: string
  Preview: () => ReactElement
}> = [
  {
    id: 'notebook',
    title: 'whatsNewResearchNotebookTitle',
    body: 'whatsNewResearchNotebookBody',
    action: 'whatsNewResearchNotebookAction',
    Preview: NotebookPreview
  },
  {
    id: 'latex',
    title: 'whatsNewResearchLatexTitle',
    body: 'whatsNewResearchLatexBody',
    action: 'whatsNewResearchLatexAction',
    Preview: LatexPreview
  },
  {
    id: 'agents',
    title: 'whatsNewResearchQuotaTitle',
    body: 'whatsNewResearchQuotaBody',
    action: 'whatsNewResearchQuotaAction',
    Preview: QuotaPreview
  }
]

/** Decorative product sketches for the 0.4.6 release card, with direct jump actions. */
export function WhatsNewResearchHighlights({
  onSelect
}: {
  onSelect: (destination: WhatsNewResearchDestination) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kun-wn-research-highlights" data-whats-new-research>
      <div className="kun-wn-workbench-label">
        <span>{t('whatsNewWorkbenchHighlights')}</span>
        <span>{t('whatsNewWorkbenchPreview')}</span>
      </div>
      <ul className="kun-wn-research-features">
        {FEATURES.map(({ id, title, body, action, Preview }) => (
          <li key={id} className="kun-wn-research-card" data-whats-new-feature={id}>
            <Preview />
            <div className="kun-wn-research-copy">
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
              <button
                type="button"
                className="kun-wn-research-action"
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
