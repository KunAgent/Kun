import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  KeyRound,
  LoaderCircle,
  RotateCcw
} from 'lucide-react'
import type {
  RuntimeDataRecoveryCandidate,
  RuntimeDataRecoveryStatus
} from '@shared/runtime-data-recovery'

export function RuntimeMigrationRecoveryView(): React.JSX.Element {
  const [status, setStatus] = useState<RuntimeDataRecoveryStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.kunRuntimeDataRecovery.getStatus())
    } catch (cause) {
      setError(messageOf(cause))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (
    action: 'restore' | 'initialize-new-install' | 'start-over',
    candidateId?: string
  ): Promise<void> => {
    if (!status) return
    setBusy(true)
    setError('')
    try {
      if (action === 'restore') {
        if (!candidateId) return
        setStatus(await window.kunRuntimeDataRecovery.execute({
          action,
          generation: status.generation,
          candidateId
        }))
      } else if (action === 'initialize-new-install') {
        setStatus(await window.kunRuntimeDataRecovery.execute({
          action,
          generation: status.generation,
          confirmation: 'initialize-empty-new-install'
        }))
      } else {
        setStatus(await window.kunRuntimeDataRecovery.execute({
          action,
          generation: status.generation,
          confirmation: 'preserve-existing-evidence-and-start-over'
        }))
      }
    } catch (cause) {
      setError(messageOf(cause))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <RuntimeMigrationRecoveryPanel
      status={status}
      busy={busy}
      error={error}
      onRestore={(candidateId) => void run('restore', candidateId)}
      onInitialize={() => void run('initialize-new-install')}
      onStartOver={() => void run('start-over')}
    />
  )
}

export function RuntimeMigrationRecoveryPanel(props: {
  status: RuntimeDataRecoveryStatus | null
  busy: boolean
  error: string
  onRestore: (candidateId: string) => void
  onInitialize: () => void
  onStartOver: () => void
}): React.JSX.Element {
  const { status, busy, error } = props
  const [startOverConfirmed, setStartOverConfirmed] = useState(false)
  const loading = !status || status.state === 'recovering'
  const completed = status?.state === 'completed'

  return (
    <main className="flex min-h-screen items-center justify-center bg-ds-canvas p-8 text-ds-ink">
      <section className="w-full max-w-3xl rounded-3xl border border-ds-border bg-ds-surface p-8 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-amber-500/10 p-3 text-amber-600">
            <DatabaseBackup className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Kun Runtime data recovery</h1>
            <p className="mt-1 text-sm leading-6 text-ds-muted">
              Kun 在启动普通工作区前发现迁移未完成。原始目录、journal 和备份会继续保留。
              No preserved evidence is deleted by this recovery flow.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="mt-8 flex items-center gap-3 rounded-2xl border border-ds-border p-5">
            <LoaderCircle className="h-5 w-5 animate-spin text-blue-500" aria-hidden="true" />
            <span>{status ? 'Recovering data / 正在恢复数据' : 'Inspecting preserved data / 正在检查保留数据'}</span>
          </div>
        ) : null}

        {completed ? (
          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-emerald-300/60 bg-emerald-500/10 p-5">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden="true" />
            <div>
              <p className="font-medium">Recovery completed / 恢复完成</p>
              <p className="mt-1 text-sm text-ds-muted">Kun will restart using the recovered canonical data directory.</p>
            </div>
          </div>
        ) : null}

        {status && (status.state === 'candidate-ready' || status.state === 'selection-required' || status.state === 'failed') && status.candidates.length > 0 ? (
          <div className="mt-7 space-y-3">
            <div>
              <h2 className="font-medium">
                {status.candidates.length === 1
                  ? 'Validated recovery candidate / 已验证恢复候选'
                  : 'Choose preserved history / 选择要恢复的历史数据'}
              </h2>
              <p className="mt-1 text-xs text-ds-muted">Only Main-issued opaque candidate IDs are accepted; filesystem paths are never sent by this page.</p>
            </div>
            {status.candidates.map((candidate) => (
              <CandidateCard
                key={candidate.candidateId}
                candidate={candidate}
                busy={busy}
                onRestore={props.onRestore}
              />
            ))}
          </div>
        ) : null}

        {status?.state === 'new-install' ? (
          <div className="mt-8 rounded-2xl border border-ds-border p-5">
            <h2 className="font-medium">No historical data found / 未发现历史数据</h2>
            <p className="mt-2 text-sm leading-6 text-ds-muted">
              This is treated as a new installation. Kun can initialize an empty canonical Runtime directory.
            </p>
            <div className="mt-5 flex justify-end">
              <button className="primary-button" disabled={busy} onClick={props.onInitialize}>
                Initialize Kun / 初始化 Kun
              </button>
            </div>
          </div>
        ) : null}

        {status?.state === 'start-over-required' ? (
          <div className="mt-8 rounded-2xl border border-amber-300/60 bg-amber-500/10 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <h2 className="font-medium">Historical evidence needs attention / 历史数据需要处理</h2>
                <p className="mt-2 text-sm leading-6 text-ds-muted">
                  Kun found migration evidence but no candidate passed validation. Starting over creates a new empty Runtime directory while retaining every existing backup, journal, and unrecognized item.
                </p>
              </div>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={startOverConfirmed}
                onChange={(event) => setStartOverConfirmed(event.currentTarget.checked)}
              />
              <span>I understand that Kun will preserve the evidence and start with empty active data. / 我确认保留全部证据并使用空数据重新开始。</span>
            </label>
            <div className="mt-5 flex justify-end">
              <button
                className="primary-button"
                disabled={busy || !startOverConfirmed}
                onClick={props.onStartOver}
              >
                <RotateCcw className="mr-2 inline h-4 w-4" aria-hidden="true" />
                Preserve backups and start over / 保留备份并重新开始
              </button>
            </div>
          </div>
        ) : null}

        {status?.warnings.map((warning) => (
          <div key={warning} className="mt-4 rounded-xl border border-amber-300/60 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            {warning}
          </div>
        ))}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl border border-red-300/60 bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        ) : null}
      </section>
    </main>
  )
}

function CandidateCard(props: {
  candidate: RuntimeDataRecoveryCandidate
  busy: boolean
  onRestore: (candidateId: string) => void
}): React.JSX.Element {
  const { candidate } = props
  const inventory = candidate.inventory
  return (
    <article className="rounded-2xl border border-ds-border bg-ds-subtle/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">{candidate.label}</h3>
          <p className="mt-1 text-xs text-ds-muted">
            {new Date(candidate.modifiedAt).toLocaleString()} · {formatBytes(inventory.bytes)} · {inventory.files} files
          </p>
        </div>
        <button
          className="primary-button"
          disabled={props.busy}
          onClick={() => props.onRestore(candidate.candidateId)}
        >
          Restore / 恢复
        </button>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Threads / 会话" value={inventory.threads} />
        <Metric label="Providers" value={inventory.providers} />
        <Metric label="Graphs" value={inventory.graphs} />
        <Metric label="Copies / 副本" value={candidate.equivalentCopies} />
      </dl>
      <div className="mt-4 flex items-center gap-2 text-xs text-ds-muted">
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        Credentials: {candidate.credentialState}
        {candidate.recoveryVerified ? ' · recovery copy verified' : ''}
        {candidate.journalVerified ? ' · journal verified' : ''}
        {!candidate.journalVerified && candidate.journalReferenced ? ' · journal referenced' : ''}
      </div>
      {candidate.warnings.map((warning) => (
        <p key={warning} className="mt-2 text-xs text-amber-700 dark:text-amber-300">{warning}</p>
      ))}
    </article>
  )
}

function Metric(props: { label: string; value: number }): React.JSX.Element {
  return <div><dt className="text-xs text-ds-muted">{props.label}</dt><dd className="mt-1 font-medium">{props.value}</dd></div>
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
