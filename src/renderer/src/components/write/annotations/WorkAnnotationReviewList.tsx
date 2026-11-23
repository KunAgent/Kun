import { Check, Crosshair, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { WorkAnnotationView } from './work-annotation-view'
import { WriteRightPanelEmpty } from '../WriteRightPanelHeader'

export function WorkAnnotationReviewList({ annotations, onOpen }: {
  annotations: WorkAnnotationView[]
  onOpen: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const saved = annotations.filter((note) => note.messages.length > 0)
  if (!saved.length) return <WriteRightPanelEmpty>{t('writeAnnotationEmpty')}</WriteRightPanelEmpty>
  return <div className="work-annotation-index">
    {[false, true].map((resolved) => {
      const notes = saved.filter((item) => item.resolved === resolved)
      if (!notes.length) return null
      return <section key={String(resolved)}>
        <h3>{t(resolved ? 'writeAnnotationResolved' : 'writeAnnotationUnresolved')} <span>{notes.length}</span></h3>
        <ul>{notes.map((item) => {
          const latest = item.messages.at(-1)
          return <li key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)}>
              {item.detached ? <Crosshair /> : resolved ? <Check /> : <MessageSquare />}
              <span>
                <strong>{item.quote}</strong>
                <small>{item.detached ? t('writeAnnotationDetached') : latest?.text || latest?.suggestion?.text}</small>
              </span>
            </button>
          </li>
        })}</ul>
      </section>
    })}
  </div>
}
