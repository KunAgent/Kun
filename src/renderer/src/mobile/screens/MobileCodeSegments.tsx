import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import './mobile-home.css'

export type MobileCodeSegment = 'tasks' | 'chats'

/** Code home switch between project tasks and Agent conversations. */
export function MobileCodeSegments({ active, chatsBadge = 0, onSelect }: {
  active: MobileCodeSegment
  chatsBadge?: number
  onSelect: (segment: MobileCodeSegment) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const segments: Array<{ id: MobileCodeSegment; label: string; badge: number }> = [
    { id: 'tasks', label: t('mobileCodeSegmentTasks'), badge: 0 },
    { id: 'chats', label: t('mobileCodeSegmentChats'), badge: chatsBadge }
  ]
  return <div className="kun-mobile-code-segments" role="tablist" aria-label="Code">
    {segments.map((segment) => <button key={segment.id} type="button" role="tab"
      aria-selected={active === segment.id} data-code-segment={segment.id}
      onClick={() => { if (active !== segment.id) onSelect(segment.id) }}>
      <span>{segment.label}</span>
      {segment.badge > 0 ? <span className="kun-mobile-code-segment-badge"
        aria-label={`${segment.badge} ${segment.label}`}>{Math.min(segment.badge, 99)}</span> : null}
    </button>)}
  </div>
}
