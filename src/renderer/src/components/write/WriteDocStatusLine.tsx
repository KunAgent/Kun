import { useMemo, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { splitFrontmatter } from '@shared/markdown/frontmatter'

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/g

/**
 * Reading length of a markdown body: CJK characters count one each, other
 * scripts count whitespace-separated words. Markup, links and code fences
 * are dropped first so the number matches what a reader sees.
 */
export function countDocumentWords(markdown: string): number {
  const text = splitFrontmatter(markdown).body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|-]+/g, ' ')
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.replace(CJK, ' ').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length
  return cjk + latin
}

/**
 * Quiet line under the document title: save state, length, and pending
 * Kun changes (click to open the review panel).
 */
export function WriteDocStatusLine({ filePath, value, reviewTotal }: {
  filePath: string
  value: string
  reviewTotal: number
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const { saveStatus, activeFilePath } = useWriteWorkspaceStore(useShallow((state) => ({
    saveStatus: state.saveStatus,
    activeFilePath: state.activeFilePath
  })))
  const words = useMemo(() => countDocumentWords(value), [value])
  // Save state belongs to the focused document; a background group shows length only.
  const status = activeFilePath === filePath ? saveStatus : null
  const statusLabel = status === 'saving' ? t('writeSaving')
    : status === 'dirty' ? t('writeDocUnsaved')
      : status === 'error' ? t('writeDocSaveFailed')
        : status === 'saved' ? t('writeSaved') : null
  return (
    <div className="write-doc-status" data-write-doc-status={status ?? 'background'}>
      {statusLabel ? <span className={`write-doc-status-save is-${status}`}>{statusLabel}</span> : null}
      <span>{t('writeDocWordCount', { count: words, formatted: words.toLocaleString(i18n.language) })}</span>
      {reviewTotal > 0 ? (
        <button type="button" className="write-doc-status-review"
          onClick={() => useWriteWorkspaceStore.getState().openWriteRightPanel('review')}>
          {t('writeDocReviewCount', { count: reviewTotal })}
        </button>
      ) : null}
    </div>
  )
}
