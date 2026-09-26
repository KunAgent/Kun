import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { WriteSaveStatus } from '../../write/write-workspace-store'

type Props = {
  documentStatsLabel: string | null
  saveLabel: string
  saveStatus: WriteSaveStatus
  readOnly: boolean
  reviewActive: boolean
  onSave: () => void
}

function statusTone(props: Props): string {
  if (props.reviewActive) return 'is-review'
  if (props.readOnly) return 'is-readonly'
  if (props.saveStatus === 'error') return 'is-error'
  if (props.saveStatus === 'dirty') return 'is-dirty'
  if (props.saveStatus === 'saving') return 'is-saving'
  return 'is-saved'
}

/**
 * Slim footer under the document (Agentero-style): save state on the left
 * of the word count, both muted so the page stays the focus. Clicking the
 * save state flushes a dirty/errored document immediately.
 */
export function WriteDocumentStatusBar(props: Props): ReactElement {
  const { t } = useTranslation('common')
  const { documentStatsLabel, saveLabel, saveStatus, readOnly, reviewActive, onSave } = props
  const canSave = !readOnly && !reviewActive && (saveStatus === 'dirty' || saveStatus === 'error')
  const label = reviewActive ? t('writeReviewPending') : saveLabel
  return (
    <footer className="write-status-bar">
      <button
        type="button"
        className={`write-status-bar-save ${statusTone(props)}`}
        disabled={!canSave}
        onClick={onSave}
        title={canSave ? t('writeSaveFile') : label}
      >
        <span className="write-status-bar-dot" aria-hidden="true" />
        {label}
      </button>
      {documentStatsLabel ? (
        <>
          <span className="write-status-bar-divider" aria-hidden="true" />
          <span className="truncate">{documentStatsLabel}</span>
        </>
      ) : null}
    </footer>
  )
}
