import { useEffect, useState } from 'react'
import type { ControlPackageStatus } from '@shared/control-package'
import { REMOTE_BUTTON_CLASS } from './remote-panel-ui'
const labels: Record<string, [string, string]> = {
  starting: ['正在准备控制包', 'Preparing control package'], ready: ['已就绪', 'Ready'],
  not_installed: ['尚未安装，首次使用时下载', 'Not installed. Downloads on first use'],
  checking: ['正在检查更新', 'Checking for updates'], available: ['有可用更新', 'Update available'],
  downloading: ['正在下载', 'Downloading'], verifying: ['正在校验', 'Verifying'],
  waiting_for_idle: ['已下载，远控和传输结束后生效', 'Downloaded. Waiting for remote sessions and transfers to finish'],
  activating: ['正在启用新版本', 'Activating update'], rolling_back: ['正在恢复上一版', 'Restoring previous version'],
  rolled_back: ['更新失败，已恢复上一版', 'Update failed. Previous version restored'], disabled: ['控制包暂不可用', 'Control package unavailable']
}
const errors: Record<string, [string, string]> = {
  CONTROL_UPDATES_NOT_CONFIGURED: ['此安装尚未配置官方控制包下载源，请升级 Kun 后重试。', 'The official control package source is not configured. Update Kun and retry.'],
  CONTROL_NO_COMPATIBLE_RELEASE: ['暂时没有适合此客户端的更新。', 'No compatible update is available.'],
  CONTROL_HOST_UPGRADE_REQUIRED: ['请先升级 Kun 客户端。', 'Update Kun before installing this package.'],
  CONTROL_VIEWER_UPGRADE_REQUIRED: ['此包不包含兼容的电脑控制窗口，请检查控制包更新。', 'This package has no compatible desktop viewer. Check for package updates.'],
  CONTROL_VIEWER_START_TIMEOUT: ['控制窗口启动检查超时，请检查更新后重试。', 'The desktop viewer startup check timed out. Check for updates and retry.'],
  CONTROL_VIEWER_START_FAILED: ['控制窗口启动失败，请检查控制包更新。', 'The desktop viewer could not start. Check for package updates.'],
  CONTROL_VIEWER_API_MISMATCH: ['此控制窗口与客户端不兼容，请检查更新。', 'The viewer is incompatible with this client. Check for updates.'],
  CONTROL_RELEASE_REVOKED: ['此控制包已停用，请安装安全更新。', 'This release is disabled. Install a safe update.'],
  CONTROL_CLEANUP_UNCONFIRMED: ['尚未确认远控已完全结束，请结束远控后重试。', 'Remote cleanup is not confirmed. End remote control and try again.'],
  CONTROL_DISK_SPACE_REQUIRED: ['磁盘空间不足，请清理后重试。', 'Free disk space and try again.']
}
export function ControlPackageCard({ zh }: { zh: boolean }) {
  const api = window.kunGui?.mobileLink?.controlPackage
  const [status, setStatus] = useState<ControlPackageStatus>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  useEffect(() => {
    if (!api) return
    let current = true
    const refresh = () => api.status().then(value => { if (current) setStatus(value) }).catch(() => {})
    void refresh(); const timer = setInterval(() => void refresh(), 2000)
    return () => { current = false; clearInterval(timer) }
  }, [api])
  if (!api) return null
  const index = zh ? 0 : 1
  const pending = busy || ['starting', 'checking', 'downloading', 'verifying', 'activating', 'rolling_back'].includes(status?.phase ?? '')
  const needsInstall = Boolean(status && !status.version)
  async function run(operation: 'check' | 'install' | 'apply') {
    setBusy(true); setFailure('')
    try { setStatus(await api![operation]()) }
    catch { setFailure(operation === 'install'
      ? zh ? '下载或安装未完成，请检查网络后重试；其他功能可继续使用。' : 'Download or installation did not finish. Check your connection and retry. Other features remain available.'
      : zh ? '操作未完成，请查看状态后重试。' : 'The operation did not finish. Check the status and retry.'); setStatus(await api!.status().catch(() => status)) }
    finally { setBusy(false) }
  }
  const message = status?.error && (errors[status.error]?.[index] ?? (needsInstall
    ? zh ? '控制包下载或校验未完成，请检查网络后重试。' : 'The package download or verification did not finish. Check your connection and retry.'
    : undefined))
  return <div className="rounded-xl border border-ds-border-muted px-3 py-3" aria-label={zh ? '远程控制包' : 'Remote control package'}>
    <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-ds-ink">
      <span>{zh ? '远程控制包' : 'Remote control package'}</span><span>{status?.version ?? '—'}</span>
    </div>
    <p role="status" className="mt-1 text-[12px] text-ds-muted">{labels[status?.phase ?? 'starting']?.[index]}
      {status?.candidateVersion ? ` · ${status.candidateVersion}` : ''}</p>
    {message || failure ? <p role="alert" className="mt-1 text-[12px] text-ds-muted">{message || failure}</p> : null}
    {needsInstall ? <p className="mt-1 text-[12px] text-ds-muted">{zh ? '联网下载后即可使用远控，后续可单独更新控制包。' : 'Download once while online to use remote control, then update this package independently.'}</p> : null}
    {status?.candidateVersion ? <p className="mt-1 text-[12px] text-ds-muted">{zh ? '安装生效时远程连接会短暂重连，已提交的任务继续运行。' : 'Connections briefly reconnect when the update activates. Accepted tasks keep running.'}</p> : null}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={REMOTE_BUTTON_CLASS} disabled={pending} onClick={() => void run('check')}>{zh ? '检查更新' : 'Check for updates'}</button>
      {(needsInstall || status?.candidateVersion) && status?.phase !== 'waiting_for_idle' ? <button type="button" className={REMOTE_BUTTON_CLASS} disabled={pending} onClick={() => void run('install')}>{needsInstall ? zh ? '下载控制包' : 'Download package' : zh ? '更新控制包' : 'Update package'}</button> : null}
      {status?.phase === 'waiting_for_idle' ? <button type="button" className={REMOTE_BUTTON_CLASS} disabled={pending} onClick={() => void run('apply')}>{zh ? '重试生效' : 'Retry activation'}</button> : null}
    </div>
  </div>
}
