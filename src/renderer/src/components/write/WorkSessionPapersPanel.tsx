import { useMemo, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { buildResearchPool } from '../../paper/paper-research-pool'
import { PaperResearchPool } from '../paper/research/PaperResearchPool'

/** Scroll the conversation to the tool block where a paper first appeared. */
function focusBlock(blockId: string): void {
  document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * 论文 rail panel: every paper this session's searches surfaced, deduplicated,
 * with the same selection, library state and import as a research run. Built
 * from the open thread's blocks, so it follows the session.
 */
export function WorkSessionPapersPanel({ onCollapse }: { onCollapse: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const { blocks, busy, activeThreadId, title } = useChatStore(useShallow((state) => ({
    blocks: state.blocks,
    busy: state.busy,
    activeThreadId: state.activeThreadId,
    title: state.threads.find((thread) => thread.id === state.activeThreadId)?.title ?? ''
  })))
  const pool = useMemo(() => buildResearchPool(blocks), [blocks])
  return (
    <div className="work-session-papers flex h-full min-h-0 flex-col" data-work-session-papers>
      {pool.entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12.5px] leading-6 text-ds-faint">
          {t('workSessionPapersEmpty')}
        </div>
      ) : (
        <PaperResearchPool
          pool={pool}
          scope={activeThreadId ?? 'work-session'}
          topic={title || t('workSessionNew')}
          running={busy}
          onFocusBlock={focusBlock}
          onClose={onCollapse}
        />
      )}
    </div>
  )
}
