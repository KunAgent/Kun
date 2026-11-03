import type { ReactElement } from 'react'
import { LibraryBig } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { usePaperSpaceStore } from '../../paper/paper-space-store'
import { openPaperSpace } from '../../paper/paper-space'
import { SidebarTreeRow } from '../sidebar/SidebarPrimitives'
import '../chat/sidebar-code-nav.css'

/** The global paper library entry; it never selects or mounts a Work space. */
export function WorkPapersSection(): ReactElement {
  const { t } = useTranslation('common')
  const active = useChatStore((state) => state.route === 'papers')
  const count = usePaperSpaceStore((state) => state.items.length)

  return (
    <div data-work-section="papers" className="work-sidebar-nav">
      <SidebarTreeRow
        title={t('workSidebarPapersNav')}
        ariaLabel={t('workSidebarPapersNav')}
        active={active}
        onClick={() => { void openPaperSpace('library') }}
        className="min-h-[34px]"
        buttonStyle={{ paddingLeft: 10 }}
        actionsVisibility="hidden"
        actionsLayout="overlay"
        trailing={count > 0 ? (
          <span className="text-[11px] tabular-nums text-ds-faint">{count}</span>
        ) : null}
      >
        <LibraryBig className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{t('workSidebarPapersNav')}</span>
      </SidebarTreeRow>
    </div>
  )
}
