import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Database, LoaderCircle, RotateCcw } from 'lucide-react'
import type {
  StorageRelocationProgress,
  StorageRelocationStatus
} from '@shared/storage-relocation'

const phaseLabels: Record<StorageRelocationProgress['phase'], string> = {
  prepared: 'Preparing / 准备迁移',
  draining: 'Stopping writers / 正在停止写入',
  copying: 'Copying data / 正在复制数据',
  verifying: 'Verifying data / 正在校验数据',
  cutover: 'Switching location / 正在切换位置',
  'health-check': 'Checking Kun / 正在检查 Kun',
  'rolling-back': 'Rolling back / 正在回滚',
  'cleanup-pending': 'Cleanup pending / 等待清理旧数据',
  completed: 'Completed / 迁移完成',
  failed: 'Needs attention / 需要处理',
  cancelled: 'Cancelled / 已取消'
}

export function StorageRelocationBootView(): React.JSX.Element {
  const [status, setStatus] = useState<StorageRelocationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      setStatus(await window.kunStorageRelocationRecovery.getStatus())
      setError('')
    } catch (cause) {
      setError(messageOf(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3_000)
    const unsubscribe = window.kunStorageRelocationRecovery.onProgress((progress) => {
      setStatus((current) => current ? { ...current, pending: progress, state: 'pending' } : current)
    })
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [refresh])

  const progress = status?.pending
  const percent = progress?.totalBytes
    ? Math.min(100, Math.round(progress.completedBytes / progress.totalBytes * 100))
    : 0
  const act = async (action: 'retry' | 'rollback' | 'cancel'): Promise<void> => {
    const operationId = progress?.operationId ?? status?.recentReport?.operationId
    if (!operationId) return
    setBusy(true)
    setError('')
    try {
      setStatus(await window.kunStorageRelocationRecovery[action](operationId))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ds-canvas p-8 text-ds-ink">
      <section className="w-full max-w-2xl rounded-3xl border border-ds-border bg-ds-surface p-8 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-blue-500/10 p-3 text-blue-600"><Database className="h-7 w-7" /></div>
          <div>
            <h1 className="text-xl font-semibold">Kun storage migration</h1>
            <p className="mt-1 text-sm text-ds-muted">正在安全迁移用户数据，请勿关闭电脑或断开目标磁盘。</p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-ds-border bg-ds-subtle/50 p-5">
          <div className="flex items-center gap-3">
            {progress?.phase === 'completed'
              ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              : progress?.phase === 'failed' || status?.state === 'broken'
                ? <AlertTriangle className="h-5 w-5 text-amber-500" />
                : <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" />}
            <span className="font-medium">{progress ? phaseLabels[progress.phase] : 'Loading / 正在读取状态'}</span>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-ds-border">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-ds-muted">
            <span>{progress?.currentItem || progress?.message || 'Kun data'}</span>
            <span>{formatBytes(progress?.completedBytes ?? 0)} / {formatBytes(progress?.totalBytes ?? 0)}</span>
          </div>
        </div>

        {error || progress?.message || status?.disabledReason ? (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            {error || progress?.message || status?.disabledReason}
          </div>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-ds-muted">
          The original C-drive paths remain as compatibility junctions. Kun only removes a verified old backup after the new location passes its health check.
          <br />C 盘原路径会保留兼容 junction；新位置通过完整性和健康检查后，旧备份才会删除。
        </p>

        {(progress && (progress.phase === 'failed' || progress.phase === 'cleanup-pending')) || status?.state === 'broken' ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {progress ? <button className="secondary-button" disabled={busy} onClick={() => void act('rollback')}>
              <RotateCcw className="mr-2 inline h-4 w-4" />Rollback / 回滚
            </button> : null}
            <button className="primary-button" disabled={busy} onClick={() => void act('retry')}>Retry / 重试</button>
          </div>
        ) : progress?.cancellable ? (
          <div className="mt-6 flex justify-end">
            <button className="secondary-button" disabled={busy} onClick={() => void act('cancel')}>Cancel / 取消</button>
          </div>
        ) : null}
      </section>
    </main>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
