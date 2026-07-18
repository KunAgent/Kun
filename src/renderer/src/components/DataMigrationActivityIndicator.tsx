import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { AlertTriangle, PackageOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DataMigrationOperationStatus } from '@shared/data-migration'
import { useChatStore } from '../store/chat-store'

export function DataMigrationActivityIndicator(): ReactElement | null {
  const { t } = useTranslation('settings')
  const openSettings = useChatStore((state) => state.openSettings)
  const [status, setStatus] = useState<DataMigrationOperationStatus | null>(null)
  const refresh = useCallback(async () => {
    setStatus(await window.kunGui.dataMigration.getStatus())
  }, [])

  useEffect(() => {
    void refresh().catch(() => undefined)
    const unsubscribe = window.kunGui.dataMigration.onProgress(() => void refresh().catch(() => undefined))
    return unsubscribe
  }, [refresh])

  useEffect(() => {
    if (!status?.activeOperationId) return
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 2_000)
    return () => window.clearInterval(timer)
  }, [refresh, status?.activeOperationId])

  if (!status?.activeOperationId && !status?.recoverable.length) return null
  const needsRecovery = !status.activeOperationId && status.recoverable.length > 0
  const progress = status.progress
  const percent = progress?.totalBytes
    ? Math.min(100, Math.round(progress.completedBytes / progress.totalBytes * 100))
    : null
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 border-b border-ds-border bg-blue-500/5 px-4 py-2 text-left text-[12px] text-ds-ink hover:bg-blue-500/10"
      onClick={() => openSettings('dataMigration')}
    >
      {needsRecovery
        ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
        : <PackageOpen className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">
        {needsRecovery
          ? t('dataMigrationGlobalRecovery', { count: status.recoverable.length })
          : t('dataMigrationGlobalActive', { phase: progress?.phase ?? status.activeKind })}
      </span>
      {!needsRecovery && percent !== null ? <span>{percent}%</span> : null}
      <span className="font-medium text-blue-700 dark:text-blue-300">{t('dataMigrationGlobalReturn')}</span>
    </button>
  )
}
