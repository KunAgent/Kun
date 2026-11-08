import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import type { ControlPackageStatus } from '@shared/control-package'
import { REMOTE_FOCUS } from './remote-compact-ui'
import { REMOTE_BUTTON_CLASS } from './remote-panel-ui'

const labels: Record<string, [string, string]> = {
  starting: ['正在准备控制包', 'Preparing control package'], ready: ['已就绪', 'Ready'],
  not_installed: ['尚未安装', 'Not installed'], checking: ['正在检查更新', 'Checking for updates'],
  available: ['新版本已准备好下载', 'An update is ready to download'],
  downloading: ['正在后台下载', 'Downloading in the background'], verifying: ['正在校验控制包', 'Verifying control package'],
  waiting_for_idle: ['已下载，等待空闲', 'Downloaded. Waiting for idle'],
  activating: ['正在启用新版本', 'Activating update'], rolling_back: ['正在恢复上一版', 'Restoring previous version'],
  rolled_back: ['已恢复上一版本', 'Previous version restored'], disabled: ['控制包暂不可用', 'Control package unavailable']
}
const errors: Record<string, [string, string]> = {
  CONTROL_UPDATES_NOT_CONFIGURED: ['此安装尚未配置官方控制包下载源，请升级 Kun 后重试。', 'The official control package source is not configured. Update Kun and retry.'],
  CONTROL_NO_COMPATIBLE_RELEASE: ['暂时没有适合此客户端的更新。', 'No compatible update is available.'],
  CONTROL_HOST_UPGRADE_REQUIRED: ['请先升级 Kun 客户端。', 'Update Kun before installing this package.'],
  CONTROL_VIEWER_UPGRADE_REQUIRED: ['此包不包含兼容的电脑控制窗口，请检查控制包更新。', 'This package has no compatible desktop viewer. Check for package updates.'],
  CONTROL_VIEWER_START_TIMEOUT: ['控制窗口启动检查超时，请检查更新后重试。', 'The desktop viewer startup check timed out. Check for updates and retry.'],
  CONTROL_VIEWER_START_FAILED: ['控制窗口启动失败，请检查更新后重试。', 'The desktop viewer could not start. Check for package updates and retry.'],
  CONTROL_VIEWER_API_MISMATCH: ['此控制窗口与客户端不兼容，请检查更新。', 'The viewer is incompatible with this client. Check for updates.'],
  CONTROL_RELEASE_REVOKED: ['此控制包已停用，请安装安全更新。', 'This release is disabled. Install a safe update.'],
  CONTROL_CLEANUP_UNCONFIRMED: ['远控或传输尚未完全结束，请等待后重试。', 'Remote control or transfers have not fully finished. Wait and try again.'],
  CONTROL_DISK_SPACE_REQUIRED: ['磁盘空间不足，请清理后重试。', 'Free disk space and try again.'],
  CONTROL_ROLLBACK_UNAVAILABLE: ['未能恢复可用版本，请重新检查更新。', 'A working version could not be restored. Check for updates again.']
}
const workingPhases = ['starting', 'checking', 'downloading', 'verifying', 'activating', 'rolling_back']
const updatePhases = ['downloading', 'verifying', 'waiting_for_idle', 'activating']
type Operation = 'check' | 'install' | 'apply'

export function ControlPackageCard({ zh }: { zh: boolean }) {
  const api = window.kunGui?.mobileLink?.controlPackage
  const [status, setStatus] = useState<ControlPackageStatus>()
  const [busy, setBusy] = useState<Operation | null>(null)
  const [failure, setFailure] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [checked, setChecked] = useState(false)
  const [completed, setCompleted] = useState<{ version: string; from?: string }>()
  const previous = useRef<ControlPackageStatus | undefined>(undefined)
  const updateOrigin = useRef<{ version?: string } | undefined>(undefined)
  const lifecycle = useRef({ active: false }), reads = useRef(0), running = useRef(false)
  const receive = useCallback((next: ControlPackageStatus) => {
    if (updatePhases.includes(next.phase)) updateOrigin.current ??= { version: previous.current?.version ?? next.version }
    if (next.phase === 'ready') {
      const origin = updateOrigin.current
      if (origin && next.version && !next.error && origin.version !== next.version) {
        setCompleted({ version: next.version, from: origin.version })
      }
      updateOrigin.current = undefined
    } else {
      setCompleted(undefined)
      if (['rolled_back', 'rolling_back', 'disabled', 'not_installed'].includes(next.phase)) updateOrigin.current = undefined
    }
    previous.current = next
    setStatus(next)
    setLoadFailed(false)
  }, [])
  useEffect(() => {
    if (!api) return
    const current = { active: true }
    lifecycle.current = current
    async function refresh() {
      const read = ++reads.current
      try {
        const next = await api!.status()
        if (current.active && read === reads.current) receive(next)
      } catch {
        if (current.active && read === reads.current) setLoadFailed(true)
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => { current.active = false; clearInterval(timer) }
  }, [api, receive])
  if (!api) return null
  const text = (cn: string, en: string) => zh ? cn : en
  const index = zh ? 0 : 1
  const serverPhase = status?.phase ?? (loadFailed ? 'disabled' : 'starting')
  const phase = busy === 'check' && !workingPhases.includes(serverPhase) ? 'checking'
    : busy === 'install' && !workingPhases.includes(serverPhase) && serverPhase !== 'waiting_for_idle' ? 'downloading' : serverPhase
  const pending = Boolean(busy) || workingPhases.includes(phase)
  const needsInstall = Boolean(status && !status.version)
  const rolledBack = phase === 'rolled_back' && Boolean(status?.version)
  const done = phase === 'ready' && !status?.error ? completed : undefined
  const compact = phase === 'ready' && !status?.error && !failure && !loadFailed && !done && !status?.candidateVersion
  const canInstall = !pending && (phase === 'not_installed' || phase === 'available' || (phase === 'ready' && Boolean(status?.candidateVersion)))
  const message = (status?.error && (errors[status.error]?.[index] ?? (!rolledBack && phase !== 'rolling_back'
    ? needsInstall ? text('控制包下载或校验未完成，请检查网络后重试。', 'The package download or verification did not finish. Check your connection and retry.')
      : text('更新未完成，请重新检查更新后重试。', 'The update did not finish. Check for updates and retry.') : ''))) || failure
    || (loadFailed ? text('无法获取控制包状态，请重试。', 'Could not read the control package status. Try again.') : '')
  const reconnect = text('生效时远程连接会短暂重连，已提交的任务继续运行。', 'Connections briefly reconnect when the update activates. Accepted tasks keep running.')
  async function run(operation: Operation) {
    const current = lifecycle.current
    if (running.current || pending || !current.active) return
    running.current = true
    ++reads.current
    setBusy(operation); setFailure(''); setChecked(false); setCompleted(undefined)
    if (operation !== 'check') updateOrigin.current = { version: status?.version }
    try {
      const next = await api![operation]()
      if (!current.active) return
      ++reads.current
      receive(next)
      if (operation === 'check') setChecked(next.phase === 'ready' && !next.error && !next.candidateVersion)
    } catch {
      if (!current.active) return
      setFailure(operation === 'install'
        ? text('下载或安装未完成，请检查网络后重试；其他功能可继续使用。', 'Download or installation did not finish. Check your connection and retry. Other features remain available.')
        : text('操作未完成，请查看状态后重试。', 'The operation did not finish. Check the status and retry.'))
      const read = ++reads.current
      try {
        const next = await api!.status()
        if (current.active && read === reads.current) receive(next)
      } catch { /* The operation error stays visible if the status refresh also fails. */ }
    } finally {
      if (current.active) { running.current = false; setBusy(null) }
    }
  }
  const buttonClass = `${REMOTE_BUTTON_CLASS} ${REMOTE_FOCUS}`
  const primaryClass = `inline-flex min-h-8 shrink-0 items-center justify-center rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-ds-ink hover:brightness-110 dark:text-ds-main ${REMOTE_FOCUS}`
  const badge = done ? text('更新完成', 'Updated') : rolledBack || phase === 'disabled' ? text('更新未完成', 'Update incomplete')
    : phase === 'waiting_for_idle' ? text('等待生效', 'Waiting to activate')
      : phase === 'available' ? text('有可用更新', 'Update available') : pending ? text('处理中', 'In progress') : ''
  const step = phase === 'downloading' ? 0 : phase === 'verifying' ? 1 : 2
  return <section className="rounded-xl border border-ds-border-muted bg-ds-subtle p-4" aria-label={text('远程控制包', 'Remote control package')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-[14px] font-semibold text-ds-ink">{text('远程控制包', 'Remote control package')}</h3>
      {badge ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${done ? 'bg-ds-success-soft text-ds-success' : rolledBack || phase === 'disabled' ? 'bg-ds-danger-soft text-ds-ink' : phase === 'available' ? 'bg-accent-soft text-accent' : 'bg-ds-hover text-ds-muted'}`}>
        {done ? <Check size={12} aria-hidden /> : rolledBack || phase === 'disabled' ? <CircleAlert size={12} aria-hidden /> : null}{badge}
      </span> : <span className="text-[12px] text-ds-muted">{status?.version ? `v${status.version}` : '—'}</span>}
    </div>
    {compact ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p role="status" className="flex items-center gap-2 text-[12px] text-ds-muted"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ds-success" />
        {checked ? text('已是最新版本', 'Up to date') : labels.ready[index]}</p>
      <button type="button" className={buttonClass} onClick={() => void run('check')}>{text('检查更新', 'Check for updates')}</button>
    </div> : <>
      <p role="status" className="mt-4 text-[16px] font-semibold leading-6 text-ds-ink">{done ? text(`已启用 v${done.version}`, `v${done.version} is active`) : labels[phase]?.[index] ?? labels.disabled[index]}</p>
      {status?.version || status?.candidateVersion ? <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ds-muted">
        {done?.from ? <><span>v{done.from}</span><span aria-hidden>→</span><span>v{done.version}</span></> : status.version ? <span>{text('当前', 'Current')} v{status.version}</span> : null}
        {status.candidateVersion && phase !== 'rolled_back' && phase !== 'rolling_back' ? <><span aria-hidden>→</span><span>v{status.candidateVersion}</span></> : null}
        {rolledBack ? <span>· {text('可继续使用', 'Ready to use')}</span> : null}
      </p> : null}
      {phase === 'available' ? <p className="mt-4 border-l-2 border-accent pl-3 text-[12px] leading-[18px] text-ds-muted">{text('可在后台下载。', 'Downloads in the background. ')}{reconnect}</p> : null}
      {phase === 'not_installed' ? <p className="mt-3 text-[12px] leading-[18px] text-ds-muted">{text('联网下载后即可使用远控，后续可单独更新控制包。', 'Download once while online to use remote control, then update this package independently.')}</p> : null}
      {updatePhases.includes(phase) ? <>
        {phase !== 'waiting_for_idle' ? <div role="progressbar" aria-label={labels[phase][index]} className="mt-4 h-1 overflow-hidden rounded-full bg-ds-hover">
          <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-pulse" />
        </div> : null}
        <p className="mt-3 text-[12px] leading-[18px] text-ds-muted">{phase === 'downloading' ? text('当前远程连接可继续使用。', 'Your current remote connection can stay in use.')
          : phase === 'verifying' ? text('校验完成后，在空闲时启用新版本。', 'The update will activate when idle after verification.')
            : phase === 'waiting_for_idle' ? text('远控和文件传输结束后，将启用新版本。', 'The update will activate after remote sessions and file transfers finish.') : reconnect}</p>
        {phase === 'waiting_for_idle' ? <p className="mt-1 text-[12px] leading-[18px] text-ds-muted">{reconnect}</p> : null}
        <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ds-muted" aria-label={text('更新步骤', 'Update steps')}>
          {[text('下载', 'Download'), text('校验', 'Verify'), text(phase === 'waiting_for_idle' ? '等待生效' : '生效', phase === 'waiting_for_idle' ? 'Waiting to activate' : 'Activate')].map((label, position) => <li key={position} aria-current={position === step ? 'step' : undefined} className={`flex items-center gap-1 ${position === step ? 'text-accent' : ''}`}>
            {position < step ? <Check size={12} aria-hidden /> : <span aria-hidden>{position + 1}.</span>}{label}
          </li>)}
        </ol>
      </> : null}
      {phase === 'rolling_back' ? <p className="mt-3 flex items-center gap-2 text-[12px] text-ds-muted"><LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden />{text('恢复期间请稍候，完成后会显示结果。', 'Please wait while the previous version is restored.')}</p> : null}
      {rolledBack ? <p className="mt-3 text-[12px] leading-[18px] text-ds-muted">{text('新版本未能启用，已回退至上一版控制包。你可以重新检查更新后重试。', 'The new version could not be activated. The previous package was restored. Check for updates to retry.')}</p> : null}
      {done ? <p className="mt-3 text-[12px] text-ds-muted">{text('控制包已就绪，可继续使用远程访问。', 'The control package is ready for remote access.')}</p> : null}
      {message ? <p role="alert" className="mt-3 text-[12px] leading-[18px] text-ds-danger">{message}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {done ? <button type="button" className={buttonClass} onClick={() => setCompleted(undefined)}>{text('完成', 'Done')}</button>
          : phase === 'waiting_for_idle' ? <button type="button" className={buttonClass} disabled={pending} onClick={() => void run('apply')}>{busy === 'apply' ? text('正在重新检查…', 'Rechecking…') : text('重新检查空闲状态', 'Recheck idle state')}</button>
            : canInstall ? <button type="button" className={primaryClass} onClick={() => void run('install')}>{needsInstall ? text('下载控制包', 'Download package') : text('下载并更新', 'Download and update')}</button>
              : !updatePhases.includes(phase) && phase !== 'rolling_back' ? <button type="button" className={buttonClass} disabled={pending} onClick={() => void run('check')}>{phase === 'checking' ? text('检查中…', 'Checking…') : text(rolledBack || message ? '重新检查更新' : '检查更新', rolledBack || message ? 'Check for updates again' : 'Check for updates')}</button> : null}
      </div>
      {phase === 'available' ? <details className="mt-3 text-[12px] leading-[18px] text-ds-muted">
        <summary className={`cursor-pointer rounded-md py-1 ${REMOTE_FOCUS}`}>{text('更新如何生效？', 'How does the update activate?')}</summary>
        <p className="mt-2">{text('下载后自动校验；若正在远控或传输，等待结束后再启用新版本。无需退出当前会话。', 'The download is verified automatically. Active remote sessions and transfers finish before activation. You do not need to exit this conversation.')}</p>
      </details> : null}
    </>}
  </section>
}
