import { useEffect, useRef, type ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { Compass, X } from 'lucide-react'
import { useWorkPaperSearchMode } from '../../write/work-paper-search-mode'

/**
 * 找论文 above the Work composer. Off, it is one quiet chip; on, it turns
 * accent with a remove button and offers 深度调研 for the full research
 * method. Results land in the conversation and the rail's 论文 panel.
 */
export function WorkPaperSearchChip(): ReactElement {
  const { t } = useTranslation('common')
  const { enabled, depth, focusRequest, setEnabled, setDepth } = useWorkPaperSearchMode(useShallow((state) => ({
    enabled: state.enabled,
    depth: state.depth,
    focusRequest: state.focusRequest,
    setEnabled: state.setEnabled,
    setDepth: state.setDepth
  })))
  const rowRef = useRef<HTMLDivElement | null>(null)

  // The home quick action turns the chip on; the composer then takes focus.
  useEffect(() => {
    if (focusRequest === 0) return
    const footer = rowRef.current?.closest('.write-assistant-footer')
    footer?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  }, [focusRequest])

  return (
    <div ref={rowRef} className="work-paper-search-row" data-work-paper-search={enabled ? depth : 'off'}>
      {enabled ? (
        <>
          <span className="work-paper-search-chip is-on">
            <Compass className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {t('workPaperSearchChip')}
            <button type="button" className="work-paper-search-remove" onClick={() => setEnabled(false)}
              aria-label={t('workPaperSearchOff')} title={t('workPaperSearchOff')}>
              <X className="h-3 w-3" strokeWidth={2.4} />
            </button>
          </span>
          <button type="button" className={`work-paper-search-chip${depth === 'deep' ? ' is-selected' : ''}`}
            aria-pressed={depth === 'deep'} title={t('workPaperSearchDeepHint')}
            onClick={() => setDepth(depth === 'deep' ? 'quick' : 'deep')}>
            {t('workPaperSearchDeep')}
          </button>
        </>
      ) : (
        <button type="button" className="work-paper-search-chip" onClick={() => setEnabled(true)}
          title={t('workPaperSearchHint')}>
          <Compass className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden="true" />
          {t('workPaperSearchChip')}
        </button>
      )}
    </div>
  )
}
