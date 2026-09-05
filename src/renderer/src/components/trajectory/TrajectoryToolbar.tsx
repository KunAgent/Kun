import { Clock3, Search } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './TrajectoryToolbar.module.css'

export function TrajectoryToolbar({
  actualDuration,
  allTurnsCollapsed,
  allCallsCollapsed,
  searchQuery,
  onActualDurationChange,
  onToggleTurns,
  onToggleCalls,
  onSearchQueryChange
}: {
  actualDuration: boolean
  allTurnsCollapsed: boolean
  allCallsCollapsed: boolean
  searchQuery: string
  onActualDurationChange: (value: boolean) => void
  onToggleTurns: () => void
  onToggleCalls: () => void
  onSearchQueryChange: (value: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className={styles.root} role="toolbar" aria-label={t('trajectoryToolbarAria')}>
      <div className={styles.inner}>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.toggle}
            aria-pressed={actualDuration}
            aria-label={actualDuration ? t('trajectoryUseEqualWidth') : t('trajectoryUseActualDuration')}
            onClick={() => onActualDurationChange(!actualDuration)}
          >
            <Clock3 className={styles.toggleIcon} />
            {t('trajectoryDuration')}
          </button>
          <button type="button" className={styles.action} aria-pressed={allTurnsCollapsed} onClick={onToggleTurns}>
            <span className={styles.actionIcon}>{allTurnsCollapsed ? '⊞' : '⊟'}</span>
            {t('trajectoryTurns')}
          </button>
          <button type="button" className={styles.action} aria-pressed={allCallsCollapsed} onClick={onToggleCalls}>
            <span className={styles.actionIcon}>{allCallsCollapsed ? '⊞' : '⊟'}</span>
            {t('trajectoryCalls')}
          </button>
        </div>
        <label className={styles.search}>
          <Search className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            aria-label={t('trajectorySearch')}
            placeholder={t('trajectorySearch')}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
          />
        </label>
      </div>
    </div>
  )
}
