import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, MessageSquare } from 'lucide-react'

function WorkPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--work" aria-hidden="true">
      <div className="kun-wn-preview-window">
        <div className="kun-wn-preview-tabs"><span><MessageSquare size={10} /></span><FileText size={10} /></div>
        <div className="kun-wn-preview-document">
          <div className="kun-wn-preview-copy"><b /><i /><i /><em /><i /><i /></div>
          <div className="kun-wn-preview-assistant"><span /><i /><i /></div>
        </div>
      </div>
    </div>
  )
}

function DesignPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--design" aria-hidden="true">
      <div className="kun-wn-preview-boards">
        <div className="kun-wn-preview-board"><i /><b /><em /><span /></div>
        <div className="kun-wn-preview-board"><i /><em /><em /><span /></div>
      </div>
    </div>
  )
}

function ReportPreview(): ReactElement {
  return (
    <div className="kun-wn-preview kun-wn-preview--report" aria-hidden="true">
      <div className="kun-wn-preview-report">
        <b /><div className="kun-wn-preview-bars"><i /><i /><i /><i /><i /></div><span />
      </div>
    </div>
  )
}

const FEATURES = [
  { id: 'work', title: 'whatsNewWorkbenchWorkTitle', body: 'whatsNewWorkbenchWorkBody', Preview: WorkPreview },
  { id: 'design', title: 'whatsNewWorkbenchDesignTitle', body: 'whatsNewWorkbenchDesignBody', Preview: DesignPreview },
  { id: 'report', title: 'whatsNewWorkbenchReportTitle', body: 'whatsNewWorkbenchReportBody', Preview: ReportPreview }
] as const

/** Decorative product sketches, not live reports or fabricated user statistics. */
export function WhatsNewWorkbenchHighlights(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kun-wn-workbench-highlights" data-whats-new-workbench>
      <div className="kun-wn-workbench-label">
        <span>{t('whatsNewWorkbenchHighlights')}</span>
        <span>{t('whatsNewWorkbenchPreview')}</span>
      </div>
      <ul className="kun-wn-workbench-features">
        {FEATURES.map(({ id, title, body, Preview }) => (
          <li key={id} data-whats-new-feature={id}>
            <Preview />
            <h3>{t(title)}</h3>
            <p>{t(body)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
