import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Clock3,
  Logs,
  MessageSquare,
  PencilLine,
  Play,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  X
} from 'lucide-react'
import { mergeScheduleSettings, type AppSettingsV1 } from '@shared/app-settings'
import type {
  ClawImChannelV1,
  DaemonProcessState,
  DaemonRuntimeItemStatus,
  DaemonRuntimeStatus,
  ScheduleSettingsV1,
  SessionDaemonV1
} from '@shared/app-settings'
import { confirmDialog } from '../../lib/confirm-dialog'
import { compactHomePathForSettingsDisplay } from '../../lib/settings-home-paths'
import { useChatStore } from '../../store/chat-store'
import { DaemonLogDrawer } from './DaemonLogDrawer'
import { SessionDaemonDialog } from './SessionDaemonDialog'

type DaemonDialogState = {
  mode: 'create' | 'edit'
  draft: SessionDaemonV1
}

type Props = {
  schedule: ScheduleSettingsV1
  clawChannels: ClawImChannelV1[]
  defaultWorkspaceRoot: string
  onPatchSchedule: (patch: Parameters<typeof mergeScheduleSettings>[1]) => Promise<ScheduleSettingsV1>
  onOpenThread?: (threadId: string) => void
  onConnectWeixin?: () => void
}

const STATUS_POLL_MS = 2_000

function nowIso(): string {
  return new Date().toISOString()
}

export function newSessionDaemon(workspaceRoot: string, now = nowIso()): SessionDaemonV1 {
  return {
    id: crypto.randomUUID(),
    title: '',
    enabled: true,
    workspaceRoot: workspaceRoot.trim(),
    threadId: '',
    scriptPath: '',
    interpreter: 'auto',
    heartbeatIntervalSeconds: 60,
    silenceTimeoutSeconds: 180,
    restartOnFailure: true,
    push: { enabled: false, channelId: '', conversationId: '' },
    createdAt: now,
    updatedAt: now
  }
}

function daemonStateTone(state: DaemonProcessState): string {
  if (state === 'running') return 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-100'
  if (state === 'starting' || state === 'restarting') return 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
  if (state === 'error') return 'bg-red-500/15 text-red-700 dark:text-red-100'
  return 'bg-ds-subtle text-ds-muted'
}

function formatRelative(iso: string | undefined, fallback: string): string {
  if (!iso) return fallback
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return fallback
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d`
}

export function SessionDaemonsView({
  schedule,
  clawChannels,
  defaultWorkspaceRoot,
  onPatchSchedule,
  onOpenThread,
  onConnectWeixin
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const threads = useChatStore((state) => state.threads)
  const [status, setStatus] = useState<DaemonRuntimeStatus | null>(null)
  const [masterPending, setMasterPending] = useState(false)
  const [masterError, setMasterError] = useState<string | null>(null)
  const [runtimeReachable, setRuntimeReachable] = useState(false)
  const [dialog, setDialog] = useState<DaemonDialogState | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [logDrawer, setLogDrawer] = useState<{ id: string; name: string; logPath: string } | null>(null)

  const weixinChannels = useMemo(
    () => clawChannels.filter((channel) => channel.enabled && channel.provider === 'weixin'),
    [clawChannels]
  )

  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      if (typeof window.kunGui?.getDaemonStatus !== 'function') return
      try {
        const next = await window.kunGui.getDaemonStatus()
        if (!cancelled) {
          setStatus(next)
          setRuntimeReachable(true)
        }
      } catch {
        if (!cancelled) setRuntimeReachable(false)
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), STATUS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const daemons = schedule.daemons.items
  const globalEnabled = schedule.daemons.enabled
  const statusByDaemonId = useMemo(() => {
    const map = new Map<string, DaemonRuntimeItemStatus>()
    for (const item of status?.items ?? []) map.set(item.id, item)
    return map
  }, [status])

  const runningCount = daemons.filter((daemon) => {
    if (!globalEnabled || !daemon.enabled) return false
    const item = statusByDaemonId.get(daemon.id)
    return item?.state === 'running' || item?.state === 'starting' || item?.state === 'restarting'
  }).length
  const pausedCount = daemons.length - runningCount

  const threadTitle = (threadId: string): string =>
    threads.find((thread) => thread.id === threadId)?.title || threadId

  const persistDaemons = async (items: SessionDaemonV1[]): Promise<void> => {
    await onPatchSchedule({ daemons: { ...schedule.daemons, items } })
  }

  const toggleMaster = async (): Promise<void> => {
    if (masterPending) return
    setMasterPending(true)
    setMasterError(null)
    try {
      const saved = await onPatchSchedule({
        daemons: { ...schedule.daemons, enabled: !globalEnabled }
      })
      if (saved.daemons.enabled === globalEnabled) {
        throw new Error(t('daemonMasterSaveMismatch'))
      }
    } catch (error) {
      setMasterError(error instanceof Error ? error.message : String(error))
    } finally {
      setMasterPending(false)
    }
  }

  const toggleDaemon = async (daemon: SessionDaemonV1): Promise<void> => {
    await persistDaemons(
      daemons.map((item) => item.id === daemon.id
        ? { ...item, enabled: !item.enabled, updatedAt: nowIso() }
        : item)
    )
  }

  const toggleKeepAwake = async (): Promise<void> => {
    await onPatchSchedule({ keepAwake: !schedule.keepAwake })
  }

  const restartDaemon = async (daemonId: string): Promise<void> => {
    await window.kunGui?.restartDaemon?.(daemonId)
  }

  const deleteDaemon = async (daemon: SessionDaemonV1): Promise<void> => {
    if (!(await confirmDialog(t('daemonDeleteConfirm')))) return
    await persistDaemons(daemons.filter((item) => item.id !== daemon.id))
    setDialog(null)
  }

  const openCreateDialog = (): void => {
    setDialogError(null)
    setDialog({ mode: 'create', draft: newSessionDaemon(defaultWorkspaceRoot) })
  }

  const openEditDialog = (daemon: SessionDaemonV1): void => {
    setDialogError(null)
    setDialog({ mode: 'edit', draft: { ...daemon, push: { ...daemon.push } } })
  }

  const saveDialog = async (): Promise<void> => {
    if (!dialog) return
    const draft = dialog.draft
    if (!draft.title.trim()) {
      setDialogError(t('daemonNameRequired'))
      return
    }
    if (!draft.threadId.trim()) {
      setDialogError(t('daemonBindThreadRequired'))
      return
    }
    if (!draft.scriptPath.trim()) {
      setDialogError(t('daemonScriptPathRequired'))
      return
    }
    if (draft.push.enabled && (!draft.push.channelId.trim() || !draft.push.conversationId.trim())) {
      setDialogError(t('daemonPushTargetRequired'))
      return
    }
    const now = nowIso()
    const saved: SessionDaemonV1 = { ...draft, updatedAt: now, createdAt: dialog.mode === 'create' ? now : draft.createdAt }
    await persistDaemons(
      dialog.mode === 'create'
        ? [...daemons, saved]
        : daemons.map((item) => item.id === saved.id ? saved : item)
    )
    setDialog(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-ds-border bg-ds-card shadow-sm">
        <button
          type="button"
          onClick={() => void toggleMaster()}
          disabled={masterPending}
          className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-ds-hover disabled:cursor-wait disabled:opacity-70"
          role="switch"
          aria-checked={globalEnabled}
          aria-busy={masterPending}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${globalEnabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200' : 'bg-ds-subtle text-ds-muted'}`}>
              <Power className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-ds-ink">{t('daemonMasterTitle')}</span>
              <span className="block truncate text-[12px] text-ds-faint">
                {masterPending
                  ? t('daemonMasterSaving')
                  : globalEnabled
                    ? (runtimeReachable ? t('daemonMasterSub') : t('daemonMasterRuntimeOffline'))
                    : t('daemonMasterDisabled')}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-[12px] font-semibold text-ds-muted">
              {globalEnabled ? t('daemonMasterOn') : t('daemonMasterOff')}
            </span>
            <span className={`relative h-5 w-9 rounded-full transition ${globalEnabled ? 'bg-ds-ink' : 'bg-ds-border-strong'}`} aria-hidden>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${globalEnabled ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted px-4 py-2.5">
          <span className="text-[12px] text-ds-muted">
            {globalEnabled
              ? t('daemonSummary', { running: runningCount, paused: pausedCount })
              : t('daemonMasterAllPaused')}
          </span>
          <label className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ds-muted">
            <span>
              {t('scheduleKeepAwake')}
              <span className="ml-1 text-[11px] font-normal text-ds-faint">{t('daemonKeepAwakeHint')}</span>
            </span>
            <input
              type="checkbox"
              checked={Boolean(schedule.keepAwake)}
              onChange={() => void toggleKeepAwake()}
              className="sr-only"
            />
            <span className={`relative h-5 w-9 rounded-full transition ${schedule.keepAwake ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${schedule.keepAwake ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
          </label>
        </div>
        {masterError ? (
          <div role="alert" className="flex items-center justify-between gap-3 border-t border-red-500/20 bg-red-500/8 px-4 py-2.5 text-[12px] text-red-700 dark:text-red-200">
            <span>{t('daemonMasterSaveFailed', { error: masterError })}</span>
            <button type="button" onClick={() => void toggleMaster()} className="shrink-0 font-semibold underline underline-offset-2">
              {t('retry')}
            </button>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] leading-6 text-ds-faint">{t('daemonSubtitle')}</p>
        <button
          type="button"
          onClick={openCreateDialog}
          className="inline-flex items-center gap-2 rounded-xl bg-ds-userbubble px-4 py-2 text-[13px] font-semibold text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          {t('daemonNew')}
        </button>
      </div>

      {daemons.length === 0 ? (
        <div className="flex min-h-[240px] items-center justify-center text-[13px] text-ds-faint">
          {t('daemonEmpty')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {daemons.map((daemon) => {
            const item = statusByDaemonId.get(daemon.id)
            const effectiveState: DaemonProcessState =
              !globalEnabled || !daemon.enabled ? 'paused' : item?.state ?? 'paused'
            const pushChannel = daemon.push.enabled
              ? weixinChannels.find((channel) => channel.id === daemon.push.channelId)
              : undefined
            return (
              <div key={daemon.id} className="rounded-xl border border-ds-border bg-ds-card px-4 py-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-[15px] font-semibold text-ds-ink">
                        {daemon.title || t('scheduleUntitled')}
                      </h2>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${daemonStateTone(effectiveState)}`}>
                        {t(`daemonState_${effectiveState}`)}
                      </span>
                      {pushChannel ? (
                        <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-800 dark:text-sky-100">
                          {t('daemonPushEnabled')}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ds-faint">
                      <span>{t('daemonSession')}: {threadTitle(daemon.threadId)}</span>
                      <span>{t('daemonScript')}: <code className="text-ds-muted">{daemon.scriptPath}</code></span>
                      {item?.pid ? (
                        <span>PID {item.pid}{item.startedAt ? ` · ${t('daemonUptime', { duration: formatRelative(item.startedAt, '') })}` : ''}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {onOpenThread && daemon.threadId ? (
                      <button
                        type="button"
                        onClick={() => onOpenThread(daemon.threadId)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                        title={t('daemonOpenThread')}
                        aria-label={t('daemonOpenThread')}
                      >
                        <MessageSquare className="h-4 w-4" strokeWidth={1.8} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void restartDaemon(daemon.id)}
                      disabled={!globalEnabled || !daemon.enabled || effectiveState === 'restarting'}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                      title={t('daemonRestart')}
                      aria-label={t('daemonRestart')}
                    >
                      <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditDialog(daemon)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                      title={t('daemonEdit')}
                      aria-label={t('daemonEdit')}
                    >
                      <PencilLine className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteDaemon(daemon)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                      title={t('daemonDelete')}
                      aria-label={t('daemonDelete')}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    <label className="ml-1 inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={daemon.enabled}
                        onChange={() => void toggleDaemon(daemon)}
                        className="sr-only"
                        aria-label={daemon.enabled ? t('daemonPauseLabel', { name: daemon.title }) : t('daemonEnableLabel', { name: daemon.title })}
                      />
                      <span className={`relative h-5 w-9 rounded-full transition ${daemon.enabled ? 'bg-ds-ink' : 'bg-ds-border-strong'}`}>
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${daemon.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                      </span>
                    </label>
                  </div>
                </div>
                {!globalEnabled && daemon.enabled ? (
                  <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-900 dark:text-amber-100">
                    {t('daemonPausedNotice')}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ds-border-muted pt-2.5">
                  <div className="flex min-w-0 items-center gap-2 text-[12px] text-ds-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${effectiveState === 'running' ? 'bg-emerald-500' : 'bg-ds-faint'}`} />
                      {t('daemonLastHeartbeat', { ago: formatRelative(item?.lastHeartbeatAt, t('daemonNever')) })}
                    </span>
                    {item?.lastPush ? (
                      <span className="truncate">
                        · {t('daemonLastPush', { time: formatRelative(item.lastPush.at, ''), status: item.lastPush.status === 'sent' ? t('daemonPushSent') : t('daemonPushFailed') })}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setLogDrawer({ id: daemon.id, name: daemon.title || t('scheduleUntitled'), logPath: item?.logPath ?? '' })}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-ds-accent transition hover:bg-ds-accent-soft"
                  >
                    <Logs className="h-3.5 w-3.5" strokeWidth={1.8} />
                    {t('daemonViewLogs')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialog ? (
        <SessionDaemonDialog
          mode={dialog.mode}
          draft={dialog.draft}
          error={dialogError}
          threads={threads}
          weixinChannels={weixinChannels}
          onConnectWeixin={onConnectWeixin}
          onDraftChange={(draft) => setDialog({ mode: dialog.mode, draft })}
          onSubmit={() => void saveDialog()}
          onClose={() => setDialog(null)}
          onPickWorkspace={async () => {
            const picked = await window.kunGui?.pickWorkspaceDirectory(dialog.draft.workspaceRoot)
            if (picked && !picked.canceled && picked.path) {
              setDialog((current) => current
                ? { ...current, draft: { ...current.draft, workspaceRoot: picked.path ?? current.draft.workspaceRoot } }
                : current)
            }
          }}
          t={t}
        />
      ) : null}

      {logDrawer ? (
        <DaemonLogDrawer
          daemonName={logDrawer.name}
          daemonId={logDrawer.id}
          logPath={logDrawer.logPath}
          onClose={() => setLogDrawer(null)}
        />
      ) : null}
    </div>
  )
}
