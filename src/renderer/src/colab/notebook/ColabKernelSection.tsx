import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2
} from 'lucide-react'
import {
  COLAB_ACCELERATORS,
  COLAB_ACCELERATOR_SPECS,
  type ColabAccelerator,
  type ColabConnectionView
} from '@shared/colab/colab-types'
import { useChatStore } from '../../store/chat-store'
import { ColabConnectionsAddFlow } from '../ColabConnectionsAddFlow'
import { ColabRuntimeSetup } from '../ColabRuntimeSetup'
import { formatColabDuration, selectWorkspaceActiveConnection, useColabStore } from '../colab-store'
import {
  KernelLaunchGuardControls,
  KernelUntrackedRuntimesSection
} from './KernelPickerGuardControls'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const BALANCE_STALE_MS = 5 * 60 * 1000

export function ColabKernelSection({
  runtime,
  busy,
  onClose
}: {
  runtime: ColabNotebookRuntime
  busy: boolean
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const accelerator = useColabNotebookStore((s) => s.accelerator)
  const setAccelerator = useColabNotebookStore((s) => s.setAccelerator)
  const kunBusy = useColabNotebookStore((s) => s.kunBusy)

  const snapshot = useColabStore((s) => s.snapshot)
  const addAccountOpen = useColabStore((s) => s.addAccountOpen)
  const reauthConnectionId = useColabStore((s) => s.reauthConnectionId)
  const openAddAccount = useColabStore((s) => s.openAddAccount)
  const closeAddAccount = useColabStore((s) => s.closeAddAccount)
  const showToast = useColabStore((s) => s.showToast)

  const connections = snapshot.connections
  const untracked = snapshot.untrackedSessions
  const activeConn = selectWorkspaceActiveConnection(snapshot, runtime.wsKey)
  const colabLive = runtime.session ?? runtime.pending

  const [selectedConnId, setSelectedConnId] = useState<string | null>(null)
  const [menuConnId, setMenuConnId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [signOutTarget, setSignOutTarget] = useState<ColabConnectionView | null>(null)
  const [stopBeforeSignOut, setStopBeforeSignOut] = useState(true)

  const effectiveConnId =
    selectedConnId && connections.some((c) => c.id === selectedConnId)
      ? selectedConnId
      : (colabLive?.connectionId ??
          activeConn?.id ??
          connections.find((c) => c.status === 'connected')?.id ??
          connections[0]?.id ??
          null)

  const outcome = snapshot.lastLoginOutcome
  useEffect(() => {
    if (!outcome || !outcome.ok) return
    showToast(
      outcome.kind === 'refreshed_existing'
        ? t('colab.refreshedToast', { name: outcome.connection.name })
        : t('colab.createdToast', { email: outcome.connection.email })
    )
    setSelectedConnId(outcome.connection.id)
    void window.kunGui.colabClearLastLoginOutcome()
  }, [outcome, showToast, t])

  const hasLoginFailure = Boolean(outcome && !outcome.ok)
  const addFlowVisible = addAccountOpen || Boolean(snapshot.oauthPending) || hasLoginFailure
  const cliState = snapshot.cli.state
  const kernelBusy = busy || kunBusy

  const commitRename = (conn: ColabConnectionView, save: boolean): void => {
    const trimmed = renameDraft.trim()
    if (save && trimmed && trimmed !== conn.name) {
      void window.kunGui.colabRenameConnection({ connectionId: conn.id, name: trimmed })
    }
    setRenamingId(null)
  }

  return (
    <div data-colab-kernel-section="colab">
      <section className="px-1.5 py-1" aria-label="Google Colab">
        <KernelUntrackedRuntimesSection untracked={untracked} workspaceRoot={runtime.wsKey} />

        {connections.length === 0 && !addFlowVisible ? (
          <div className="mx-1.5 mt-1 rounded-[10px] border border-ds-border/80 bg-ds-main/50 p-3 text-[12px] text-ds-muted">
            <p>{t('colabNb.noAccount')}</p>
          </div>
        ) : null}

        <div className="mt-1 space-y-1">
          {connections.map((conn) => {
            const isSelected = conn.id === effectiveConnId
            const expired = conn.status === 'expired'
            const ownedSession = runtime.session?.connectionId === conn.id ? runtime.session : null
            const ownedPending = runtime.pending?.connectionId === conn.id ? runtime.pending : null
            const ownedFailed = runtime.failed?.connectionId === conn.id ? runtime.failed : null
            const ownedLive = ownedSession ?? ownedPending
            const pickedGpu: ColabAccelerator = ownedLive?.accelerator ?? accelerator
            const spec = COLAB_ACCELERATOR_SPECS[pickedGpu]
            const estHours =
              conn.balanceCu != null && spec.estimatedCuPerHour > 0
                ? Math.max(0, Math.floor(conn.balanceCu / spec.estimatedCuPerHour))
                : null
            const connectingThis =
              Boolean(ownedPending) || (runtime.connecting && isSelected && !colabLive)
            const errorMsg =
              (isSelected ? runtime.error : null) ?? ownedFailed?.errorMessage ?? null

            return (
              <div
                key={conn.id}
                className={`rounded-[10px] transition ${
                  isSelected ? 'bg-accent/[0.06]' : 'hover:bg-ds-hover/70'
                }`}
              >
                <div
                  onClick={() => {
                    setSelectedConnId(conn.id)
                    setMenuConnId(null)
                    if (!colabLive && conn.status === 'connected' && runtime.wsKey) {
                      void window.kunGui.colabSelectWorkspaceConnection?.({
                        workspaceRoot: runtime.wsKey,
                        connectionId: conn.id
                      })
                    }
                  }}
                  className="flex cursor-pointer items-center gap-2.5 px-2.5 py-2"
                >
                  <span
                    className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                      expired ? 'opacity-50' : ''
                    }`}
                    style={{ backgroundColor: conn.avatarColor }}
                  >
                    {conn.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    {renamingId === conn.id ? (
                      <input
                        type="text"
                        value={renameDraft}
                        autoFocus
                        maxLength={48}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => commitRename(conn, true)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commitRename(conn, true)
                          else if (e.key === 'Escape') commitRename(conn, false)
                        }}
                        className="w-full rounded border border-accent bg-ds-main px-1.5 py-0.5 text-[12px] text-ds-ink outline-none"
                      />
                    ) : (
                      <div className="truncate text-[12.5px] font-semibold text-ds-ink">
                        {conn.name}
                      </div>
                    )}
                    <div className="truncate text-[11px] text-ds-faint">{conn.email}</div>
                  </div>
                  {expired ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openAddAccount(conn.id)
                      }}
                      className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
                    >
                      {t('colab.reauthorize')}
                    </button>
                  ) : conn.balanceCu != null ? (
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] text-ds-muted">
                      <span>{conn.balanceCu} CU</span>
                      {Date.now() - Date.parse(conn.updatedAt) > BALANCE_STALE_MS ? (
                        <span className="rounded bg-amber-500/15 px-1 py-0.5 font-sans text-[9.5px] text-amber-700 dark:text-amber-300">
                          {t('colabNb.balanceStaleTag')}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-ds-faint">
                      {t('colabNb.balanceUnknown')}
                    </span>
                  )}
                  <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={conn.name}
                      aria-expanded={menuConnId === conn.id}
                      onClick={() => setMenuConnId(menuConnId === conn.id ? null : conn.id)}
                      className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {menuConnId === conn.id ? (
                      <div
                        role="menu"
                        className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-ds-border bg-ds-card py-1 text-[11.5px] shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuConnId(null)
                            setRenameDraft(conn.name)
                            setRenamingId(conn.id)
                          }}
                          className="flex w-full items-center px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                        >
                          {t('colab.menuRename')}
                        </button>
                        {!expired ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuConnId(null)
                              void window.kunGui.colabRefreshBalances({ connectionId: conn.id })
                            }}
                            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                          >
                            <RefreshCw className="h-3 w-3" />
                            <span>{t('colab.menuRefreshBalance')}</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuConnId(null)
                            openAddAccount(conn.id)
                          }}
                          className="flex w-full items-center px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                        >
                          {t('colab.reauthorize')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuConnId(null)
                            void window.kunGui.colabOpenBrowser({ connectionId: conn.id })
                          }}
                          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>{t('colab.menuOpenColab')}</span>
                        </button>
                        <div className="my-1 border-t border-ds-border/70" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuConnId(null)
                            setStopBeforeSignOut(true)
                            setSignOutTarget(conn)
                          }}
                          className="flex w-full items-center px-3 py-1.5 text-left text-red-600 hover:bg-red-500/10"
                        >
                          {t('colab.menuSignOut')}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                {isSelected && !expired ? (
                  <div className="px-3 pb-2.5 pl-10 pt-0.5">
                    <div
                      className="grid grid-cols-4 gap-1.5"
                      role="radiogroup"
                      aria-label={t('colabNb.runtime')}
                    >
                      {COLAB_ACCELERATORS.map((id) => {
                        const itemSpec = COLAB_ACCELERATOR_SPECS[id]
                        const on = pickedGpu === id
                        return (
                          <button
                            key={id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={Boolean(colabLive)}
                            onClick={() => setAccelerator(id)}
                            className={`rounded-[8px] border bg-ds-card py-1.5 text-center text-[11.5px] font-semibold transition disabled:cursor-default ${
                              on
                                ? 'border-accent bg-accent/[0.08] text-accent'
                                : 'border-ds-border text-ds-ink hover:bg-ds-hover'
                            } ${ownedLive && !on ? 'opacity-45' : ''}`}
                          >
                            {itemSpec.label}
                            <span className="block text-[10px] font-normal text-ds-faint">
                              {t('colabNb.perHour', { cu: itemSpec.estimatedCuPerHour })}
                            </span>
                          </button>
                        )
                      })}
                    </div>

                    <KernelLaunchGuardControls accelerator={pickedGpu} disabled={Boolean(colabLive)} />

                    {cliState !== 'ready' && !colabLive ? (
                      <div className="mt-2">
                        <ColabRuntimeSetup inPanel />
                      </div>
                    ) : null}
                    {colabLive && !ownedLive ? (
                      <p className="mt-2 text-[11px] text-ds-muted">
                        {t('colabNb.stopOtherColab', { name: colabLive.connectionName })}
                      </p>
                    ) : null}
                    {errorMsg ? (
                      <p className="mt-1.5 line-clamp-3 text-[11px] text-red-500">
                        {t('colabNb.connectFailed', { message: errorMsg })}
                      </p>
                    ) : null}

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] text-ds-faint">
                        {estHours != null
                          ? t('colabNb.estimateHours', {
                              cu: spec.estimatedCuPerHour,
                              hours: estHours
                            })
                          : t('colabNb.estimateRateOnly', { cu: spec.estimatedCuPerHour })}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {ownedSession && runtime.activeSessionId !== ownedSession.id ? (
                          <button
                            type="button"
                            disabled={kernelBusy}
                            onClick={() => {
                              runtime.setBackend('colab')
                              onClose()
                            }}
                            className="rounded-[8px] bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-45"
                          >
                            {t('colabNb.useExecutionKernel')}
                          </button>
                        ) : ownedSession ? (
                          <span className="rounded-[8px] bg-emerald-500/12 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {t('colabNb.connected', {
                              elapsed: formatColabDuration(ownedSession.elapsedSeconds)
                            })}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={
                              connectingThis ||
                              kernelBusy ||
                              Boolean(colabLive) ||
                              !runtime.wsKey ||
                              cliState !== 'ready'
                            }
                            onClick={() => void runtime.connect(pickedGpu, conn)}
                            className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {connectingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            <span>
                              {connectingThis
                                ? ownedPending?.provisioningMaxAttempts &&
                                  ownedPending.provisioningMaxAttempts > 1
                                  ? t('colabNb.provisioningAttempt', {
                                      attempt: ownedPending.provisioningAttempt ?? 1,
                                      total: ownedPending.provisioningMaxAttempts
                                    })
                                  : t('colabNb.connecting')
                                : t('colabNb.launchGpu', { gpu: pickedGpu })}
                            </span>
                          </button>
                        )}
                        {ownedLive ? (
                          <button
                            type="button"
                            onClick={() => void runtime.disconnect()}
                            className="rounded-[8px] border border-ds-border bg-ds-card px-2.5 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
                          >
                            {t('colabNb.disconnect')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {signOutTarget ? (
          <div
            role="alertdialog"
            className="mx-1.5 mt-2 rounded-xl border border-red-500/35 bg-ds-main p-3 text-[12px]"
          >
            <div className="font-semibold text-ds-ink">
              {t('colab.signOutTitle', {
                name: signOutTarget.name,
                email: signOutTarget.email
              })}
            </div>
            {signOutTarget.activeSessions.length > 0 ? (
              <label className="mt-1.5 flex items-center gap-2 text-[11.5px] text-ds-ink">
                <input
                  type="checkbox"
                  checked={stopBeforeSignOut}
                  onChange={(e) => setStopBeforeSignOut(e.target.checked)}
                />
                <span>{t('colab.signOutStopFirst')}</span>
              </label>
            ) : null}
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setSignOutTarget(null)}
                className="rounded-lg px-2.5 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover"
              >
                {t('colab.cancelBtn')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = signOutTarget
                  setSignOutTarget(null)
                  await window.kunGui.colabSignOutConnection({
                    connectionId: target.id,
                    stopRunningSessions:
                      target.activeSessions.length > 0 ? stopBeforeSignOut : false
                  })
                }}
                className="rounded-lg bg-red-600 px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-red-700"
              >
                {t('colab.signOutConfirm')}
              </button>
            </div>
          </div>
        ) : null}

        {addFlowVisible ? (
          <div className="px-1.5 pb-1 pt-1">
            <ColabConnectionsAddFlow
              workspaceRoot={runtime.wsKey}
              oauthPending={snapshot.oauthPending}
              lastOutcome={outcome}
              reauthConnectionId={reauthConnectionId}
              reauthName={
                reauthConnectionId
                  ? connections.find((c) => c.id === reauthConnectionId)?.name
                  : undefined
              }
              onCancelForm={closeAddAccount}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => openAddAccount()}
            className="mt-1 flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('colabNb.addColabAccount')}</span>
          </button>
        )}
      </section>

      <div className="my-1 border-t border-ds-border/80" />

      <div className="px-1.5">
        <button
          type="button"
          onClick={() => {
            onClose()
            useChatStore.getState().openSettings('cloudCompute')
          }}
          className="flex w-full items-center justify-between gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <span className="inline-flex items-center gap-2">
            <Settings2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('colabNb.accountComputeSettings')}</span>
          </span>
          <span className="text-[11px] text-ds-faint">{t('colabNb.settingsBadge')}</span>
        </button>
      </div>
    </div>
  )
}
