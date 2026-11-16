import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ColabConnectionView } from '@shared/colab/colab-types'
import { ColabConnectionsAddFlow } from './ColabConnectionsAddFlow'
import {
  isColabSessionRunning,
  normalizeColabWorkspaceKey,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore
} from './colab-store'

type Props = {
  workspaceRoot: string
}

export function ColabConnectionsSection({ workspaceRoot }: Props): ReactElement {
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const expanded = useColabStore((s) => s.connectionsExpanded)
  const setExpanded = useColabStore((s) => s.setConnectionsExpanded)
  const addAccountOpen = useColabStore((s) => s.addAccountOpen)
  const reauthConnectionId = useColabStore((s) => s.reauthConnectionId)
  const openAddAccount = useColabStore((s) => s.openAddAccount)
  const closeAddAccount = useColabStore((s) => s.closeAddAccount)
  const newlyCreatedId = useColabStore((s) => s.newlyCreatedConnectionId)
  const showToast = useColabStore((s) => s.showToast)

  const [menuConnId, setMenuConnId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<ColabConnectionView | null>(null)
  const [signOutTarget, setSignOutTarget] = useState<ColabConnectionView | null>(null)
  const [stopBeforeSignOut, setStopBeforeSignOut] = useState(true)

  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const activeConnection = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const workspaceRunning = selectWorkspaceSessions(snapshot, workspaceRoot).filter(
    isColabSessionRunning
  )
  const connections = snapshot.connections
  const hasMismatch =
    snapshot.lastLoginOutcome &&
    !snapshot.lastLoginOutcome.ok &&
    snapshot.lastLoginOutcome.kind === 'email_mismatch'

  useEffect(() => {
    const outcome = snapshot.lastLoginOutcome
    if (!outcome || !outcome.ok) return
    showToast(
      outcome.kind === 'refreshed_existing'
        ? t('colab.refreshedToast', { name: outcome.connection.name })
        : t('colab.createdToast', { email: outcome.connection.email })
    )
    void window.kunGui.colabClearLastLoginOutcome()
  }, [snapshot.lastLoginOutcome, showToast, t])

  const performSwitch = async (target: ColabConnectionView): Promise<void> => {
    const previousId = activeConnection?.id ?? null
    if (previousId === target.id) return
    const res = await window.kunGui.colabSelectWorkspaceConnection({
      workspaceRoot,
      connectionId: target.id
    })
    if (res.ok) {
      showToast(
        t('colab.switchedToast', { name: target.name }),
        previousId
          ? () => {
              void window.kunGui.colabSelectWorkspaceConnection({
                workspaceRoot,
                connectionId: previousId
              })
            }
          : undefined
      )
    }
  }

  const requestSelectConnection = (target: ColabConnectionView): void => {
    if (target.status === 'expired') {
      openAddAccount(target.id)
      return
    }
    if (activeConnection?.id === target.id) return
    if (workspaceRunning.length > 0 && activeConnection) {
      setPendingSwitchTarget(target)
      return
    }
    void performSwitch(target)
  }

  const handleRadioKeyDown = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    index: number
  ): void => {
    if (connections.length === 0) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const next = connections[(index + delta + connections.length) % connections.length]
      if (next) requestSelectConnection(next)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const item = connections[index]
      if (item) requestSelectConnection(item)
    }
  }

  if (connections.length === 0) {
    return (
      <section
        data-testid="colab-connections-empty"
        className="border-t border-ds-border bg-ds-sidebar p-3.5"
      >
        <div className="rounded-xl border border-ds-border bg-ds-card p-4 text-center">
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Cloud className="h-4 w-4" />
          </div>
          <h3 className="mt-2.5 text-[13px] font-semibold text-ds-ink">{t('colab.emptyTitle')}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ds-muted">{t('colab.emptyDesc')}</p>
          {!addAccountOpen && !snapshot.oauthPending ? (
            <button
              type="button"
              onClick={() => openAddAccount()}
              className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm hover:opacity-95"
            >
              <span>{t('colab.signInWithGoogle')}</span>
            </button>
          ) : null}
        </div>
        {addAccountOpen || snapshot.oauthPending || hasMismatch ? (
          <ColabConnectionsAddFlow
            workspaceRoot={workspaceRoot}
            existingCount={0}
            oauthPending={snapshot.oauthPending}
            lastOutcome={snapshot.lastLoginOutcome}
            reauthConnectionId={null}
            onCancelForm={closeAddAccount}
          />
        ) : null}
      </section>
    )
  }

  const isExpanded = Boolean(expanded || addAccountOpen || snapshot.oauthPending || hasMismatch)

  if (!isExpanded && activeConnection) {
    return (
      <section
        data-testid="colab-connections-collapsed"
        className="shrink-0 border-t border-ds-border bg-ds-sidebar px-3 py-2.5"
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition hover:bg-ds-hover"
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" />
          <span className="shrink-0 font-medium text-ds-muted">{t('colab.connectionsLabel')}</span>
          <span
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ backgroundColor: activeConnection.avatarColor }}
          >
            {activeConnection.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">
            {activeConnection.name} · {activeConnection.email}
          </span>
          {activeConnection.status === 'expired' ? (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
              {t('colab.expiredBadge')}
            </span>
          ) : activeConnection.balanceCu !== null ? (
            <span className="shrink-0 font-mono text-[11px] text-ds-muted">
              {activeConnection.balanceCu} CU
            </span>
          ) : null}
          <span className="shrink-0 rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ds-faint">
            {connections.length}
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      data-testid="colab-connections-expanded"
      className="max-h-[56%] shrink-0 overflow-y-auto border-t border-ds-border bg-ds-sidebar p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            closeAddAccount()
            setExpanded(false)
          }}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ds-ink hover:text-accent"
        >
          <ChevronDown className="h-3.5 w-3.5 text-ds-faint" />
          <span>{t('colab.connectionsLabel')}</span>
          <span className="rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10px] font-medium text-ds-faint">
            {connections.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => openAddAccount()}
          className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2 py-1 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
        >
          <Plus className="h-3 w-3" />
          <span>{t('colab.addAccountBtn').replace(/^\+\s*/, '')}</span>
        </button>
      </div>
      <p className="mt-1 text-[11px] text-ds-faint">{t('colab.connectionsSubtitle')}</p>

      <div role="radiogroup" aria-label={t('colab.connectionsLabel')} className="mt-2 space-y-1.5">
        {connections.map((conn, idx) => {
          const selected = activeConnection?.id === conn.id
          const localOcc = conn.activeSessions.filter(
            (o) => normalizeColabWorkspaceKey(o.workspaceRoot) === wsKey
          )
          const remoteOcc = conn.activeSessions.find(
            (o) => normalizeColabWorkspaceKey(o.workspaceRoot) !== wsKey
          )
          const isRenaming = renamingId === conn.id

          return (
            <div
              key={conn.id}
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onKeyDown={(e) => handleRadioKeyDown(e, idx)}
              onClick={() => {
                if (!isRenaming) requestSelectConnection(conn)
              }}
              className={`relative cursor-pointer rounded-xl border p-2.5 text-[12px] transition ${
                selected
                  ? 'border-accent/55 bg-accent/[0.06]'
                  : 'border-ds-border-muted bg-ds-card hover:border-ds-border'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-accent' : 'border-ds-faint'
                  }`}
                >
                  {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                </span>
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white"
                  style={{ backgroundColor: conn.avatarColor }}
                >
                  {conn.name.slice(0, 1).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <input
                      type="text"
                      value={renameDraft}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={async () => {
                        if (renameDraft.trim()) {
                          await window.kunGui.colabRenameConnection({
                            connectionId: conn.id,
                            name: renameDraft.trim()
                          })
                        }
                        setRenamingId(null)
                      }}
                      onKeyDown={async (e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') {
                          if (renameDraft.trim()) {
                            await window.kunGui.colabRenameConnection({
                              connectionId: conn.id,
                              name: renameDraft.trim()
                            })
                          }
                          setRenamingId(null)
                        } else if (e.key === 'Escape') {
                          setRenamingId(null)
                        }
                      }}
                      className="w-full rounded border border-accent bg-ds-subtle px-1.5 py-0.5 text-[12px] text-ds-ink focus:outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-ds-ink">{conn.name}</span>
                      {newlyCreatedId === conn.id ? (
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                          {t('colab.newBadge')}
                        </span>
                      ) : null}
                    </div>
                  )}
                  <div className="truncate text-[11px] text-ds-faint">
                    {conn.email} · {conn.planLabel}
                  </div>
                </div>

                {conn.status === 'expired' ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openAddAccount(conn.id)
                    }}
                    className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 hover:bg-amber-500/25 dark:text-amber-300"
                  >
                    {t('colab.reauthorize')}
                  </button>
                ) : conn.balanceCu !== null ? (
                  <span className="shrink-0 font-mono text-[11.5px] font-medium text-ds-ink">
                    {conn.balanceCu} CU
                  </span>
                ) : null}

                <button
                  type="button"
                  aria-label={conn.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuConnId((cur) => (cur === conn.id ? null : conn.id))
                  }}
                  className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </div>

              {localOcc.length > 0 || remoteOcc ? (
                <div className="mt-1.5 flex items-center justify-between pl-6 text-[10.5px] text-ds-muted">
                  <span>
                    {localOcc.length > 0
                      ? t('colab.thisWorkspaceSessions', { total: localOcc.length })
                      : remoteOcc
                        ? t('colab.otherWorkspaceUsing', { workspace: remoteOcc.workspaceLabel })
                        : ''}
                  </span>
                  <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                    {t('colab.phaseRunning')}
                  </span>
                </div>
              ) : null}

              {menuConnId === conn.id ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="mt-2 rounded-lg border border-ds-border bg-ds-elevated py-1 text-[11.5px] shadow-lg"
                >
                  {!selected && conn.status === 'connected' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuConnId(null)
                        requestSelectConnection(conn)
                      }}
                      className="flex w-full items-center px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                    >
                      {t('colab.menuSetCurrent')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuConnId(null)
                      setRenameDraft(conn.name)
                      setRenamingId(conn.id)
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    {t('colab.menuRename')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuConnId(null)
                      void window.kunGui.colabRefreshBalances({ connectionId: conn.id })
                    }}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>{t('colab.menuRefreshBalance')}</span>
                  </button>
                  <button
                    type="button"
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
                    onClick={() => {
                      setMenuConnId(null)
                      void window.kunGui.colabOpenBrowser({ connectionId: conn.id })
                    }}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ds-ink hover:bg-ds-hover"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>{t('colab.menuOpenColab')}</span>
                  </button>
                  <div className="my-1 border-t border-ds-border-muted" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuConnId(null)
                      setStopBeforeSignOut(true)
                      setSignOutTarget(conn)
                    }}
                    className="flex w-full items-center px-3 py-1.5 text-left text-red-500 hover:bg-red-500/10"
                  >
                    {t('colab.menuSignOut')}
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {pendingSwitchTarget && activeConnection ? (
        <div className="mt-2 rounded-xl border border-amber-500/35 bg-ds-card p-3 text-[12px] shadow-md">
          <div className="font-semibold text-ds-ink">{t('colab.switchConfirmTitle')}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ds-muted">
            {t('colab.switchConfirmBody', {
              session: workspaceRunning[0]?.sessionName ?? '',
              from: activeConnection.name,
              to: pendingSwitchTarget.name
            })}
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingSwitchTarget(null)}
              className="rounded-lg px-2.5 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover"
            >
              {t('colab.cancelBtn')}
            </button>
            <button
              type="button"
              onClick={() => {
                const target = pendingSwitchTarget
                setPendingSwitchTarget(null)
                void performSwitch(target)
              }}
              className="rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white"
            >
              {t('colab.switchConfirmAction')}
            </button>
          </div>
        </div>
      ) : null}

      {signOutTarget ? (
        <div className="mt-2 rounded-xl border border-red-500/35 bg-ds-card p-3 text-[12px] shadow-md">
          <div className="font-semibold text-ds-ink">
            {t('colab.signOutTitle', { name: signOutTarget.name, email: signOutTarget.email })}
          </div>
          {signOutTarget.activeSessions.length > 0 ? (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-[11.5px] text-amber-600 dark:text-amber-300">
                {t('colab.signOutActiveWarning', { total: signOutTarget.activeSessions.length })}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ds-ink">
                <input
                  type="radio"
                  checked={stopBeforeSignOut}
                  onChange={() => setStopBeforeSignOut(true)}
                />
                <span>{t('colab.signOutStopFirst')}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-ds-muted">
                <input
                  type="radio"
                  checked={!stopBeforeSignOut}
                  onChange={() => setStopBeforeSignOut(false)}
                />
                <span>{t('colab.signOutKeepRunning')}</span>
              </label>
            </div>
          ) : null}
          <div className="mt-2.5 flex justify-end gap-2">
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
                  stopRunningSessions: stopBeforeSignOut
                })
              }}
              className="rounded-lg bg-red-600 px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-red-700"
            >
              {t('colab.signOutConfirm')}
            </button>
          </div>
        </div>
      ) : null}

      {addAccountOpen || snapshot.oauthPending || hasMismatch ? (
        <ColabConnectionsAddFlow
          workspaceRoot={workspaceRoot}
          existingCount={connections.length}
          oauthPending={snapshot.oauthPending}
          lastOutcome={snapshot.lastLoginOutcome}
          reauthConnectionId={reauthConnectionId}
          reauthDefaultName={
            reauthConnectionId
              ? connections.find((c) => c.id === reauthConnectionId)?.name
              : undefined
          }
          onCancelForm={closeAddAccount}
        />
      ) : null}
    </section>
  )
}
