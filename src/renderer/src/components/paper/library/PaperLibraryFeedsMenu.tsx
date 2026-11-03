import type { ReactElement } from 'react'
import { ChevronDown, Compass, Newspaper, Rss, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WritePaperViewId } from '../../../write/write-workspace-store-types'
import { openPaperView, startWorkPaperSearch } from '../../../write/work-session-actions'
import { RoomPopover } from '../../rooms/RoomPopover'

const FEEDS: Array<{ id: WritePaperViewId; labelKey: string; Icon: typeof Rss }> = [
  { id: 'discover:arxiv', labelKey: 'writePaperDiscoverNav_arxiv', Icon: Newspaper },
  { id: 'discover:venue', labelKey: 'writePaperDiscoverNav_venue', Icon: Trophy },
  { id: 'discover:feeds', labelKey: 'writePaperDiscoverNav_feeds', Icon: Rss }
]

/**
 * Library header entry points for new papers: 找论文 starts a search in a
 * session, and the arXiv / venue / subscription feeds open as tabs.
 */
export function PaperLibraryFeedsMenu(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" data-testid="paper-library-find" onClick={() => void startWorkPaperSearch()}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-accent/10 px-3.5 text-[12.5px] font-semibold text-accent transition hover:bg-accent/15">
        <Compass className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
        {t('workPaperSearchChip')}
      </button>
      <RoomPopover label={t('paperLibraryFeeds')} align="end" width={200}
        className="inline-flex h-[34px] items-center gap-1 rounded-full bg-ds-hover px-3 text-[12.5px] text-ds-ink transition hover:brightness-[0.97]"
        trigger={<><Rss className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />{t('paperLibraryFeeds')}<ChevronDown className="h-3 w-3 text-ds-faint" strokeWidth={2} aria-hidden="true" /></>}>
        {(close) => (
          <div className="rooms-menu-list">
            {FEEDS.map(({ id, labelKey, Icon }) => (
              <button key={id} type="button" data-paper-feed={id} onClick={() => { close(); void openPaperView(id) }}>
                <Icon size={15} aria-hidden="true" /><span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        )}
      </RoomPopover>
    </div>
  )
}
