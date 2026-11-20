import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatColabBytes } from './colab-store'
import { useRuntimeUploads } from './runtime-upload-store'

export function RuntimeUploadStatus({ sessionId }: { sessionId: string }): ReactElement | null {
  const { t } = useTranslation('common')
  const state = useRuntimeUploads((s) => s.sessions[sessionId])
  const cancel = useRuntimeUploads((s) => s.cancel)
  if (!state) return null
  if (state.busy) {
    const p = state.progress
    return (
      <div className="space-y-1 px-3 py-2 text-[11.5px] text-ds-muted">
        {p ? <>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-ds-ink" title={p.fileName}>{p.fileIndex}/{p.fileCount} · {p.fileName}</span>
            <button type="button" className="ml-auto shrink-0 text-accent" onClick={() => void cancel(sessionId)}>{t('cancel')}</button>
          </div>
          <progress className="block h-1.5 w-full accent-accent" aria-label={p.fileName}
            value={p.transferredBytes} max={p.totalBytes || 1} />
          <div className="font-mono">{formatColabBytes(p.transferredBytes)} / {formatColabBytes(p.totalBytes)}</div>
        </> : <span role="status">{t('colabNb.uploadPreparing')}</span>}
      </div>
    )
  }
  const { result } = state
  if (result.ok && !result.uploadedCount) return null
  return (
    <p className={`break-words px-3 py-2 text-[11.5px] ${!result.ok && !result.canceled ? 'text-red-600 dark:text-red-300' : 'text-ds-muted'}`}
      role={!result.ok && !result.canceled ? 'alert' : 'status'}>
      {result.ok ? t('colabNb.uploadComplete', { total: result.uploadedCount })
        : result.canceled ? t('colabNb.uploadCanceled', { total: result.uploadedCount })
        : t('colabNb.uploadFailed', { total: result.uploadedCount, message: result.message })}
    </p>
  )
}
