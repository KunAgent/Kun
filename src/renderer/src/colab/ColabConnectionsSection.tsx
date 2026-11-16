import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react'
import { ChevronDown, ChevronRight, Cloud, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ColabConnectionView } from '@shared/colab/colab-types'
import { ColabConnectionRow } from './ColabConnectionRow'
import { ColabConnectionsAddFlow } from './ColabConnectionsAddFlow'
import { performColabConnectionSwitch, requestColabConnectionSwitch } from './colab-connection-switch'
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
  const highlightedId = useColabStore((s) => s.highlightedConnectionId)
  const highlightConnection = useColabStore((s) => s.highlightConnection)
  const pendingSwitchTargetId = useColabStore((s) => s.pendingSwitchTargetId)
  const setPendingSwitchTargetId = useColabStore((s) => s.setPendingSwitchTargetId)
  const showToast = useColabStore((s) => s.showToast)

  const [signOutTarget, setSignOutTarget] = useState<ColabConnectionView | null>(null)
  const [stopBeforeSignOut, setStopBeforeSignOut] = useState(true)
  const [focusIdx, setFocusIdx] = useState<number | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const wsKey = normalizeColabWorkspaceKey(workspaceRoot)
  const activeConnection = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const workspaceRunning = selectWorkspaceSessions(snapshot, workspaceRoot).filter(
    isColabSessionRunning
  )
  const connections = snapshot.connections
  const pendingSwitchTarget = pendingSwitchTargetId
    ? connections.find((c) => c.id === pendingSwitchTargetId) ?? null
    : null
  const outcome = snapshot.lastLoginOutcome
  const hasLoginFailure = Boolean(outcome && !outcome.ok)
  const selectedIdx = Math.max(
    0,
    connections.findIndex((c) => c.id === activeConnection?.id)
  )
  const rovingIdx = focusIdx !== null && focusIdx < connections.length ? focusIdx : selectedIdx

  useEffect(() => {
    if (!outcome || !outcome.ok) return
    const { connection } = outcome
    if (outcome.kind === 'refreshed_existing') {
      showToast(t('colab.refreshedToast', { name: connection.name }), {
        label: t('colab.locateBtn'),
        run: () => highlightConnection(connection.id)
      })
    } else {
      showToast(t('colab.createdToast', { email: connection.email }))
    }
    void window.kunGui.colabClearLastLoginOutcome()
  }, [outcome, showToast, highlightConnection, t])

  // Drop a stale confirmation if the target disappeared or the workspace stopped running.
  useEffect(() => {
    if (pendingSwitchTargetId && (!pendingSwitchTarget || workspaceRunning.length === 0)) {
      setPendingSwitchTargetId(null)
    }
  }, [pendingSwitchTargetId, pendingSwitchTarget, workspaceRunning.length, setPendingSwitchTargetId])

  const handleRowKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, index: number): void => {
    const count = connections.length
    if (count === 0) return
    let next: number | null = null
    if (e.key === 'ArrowDown') next = (index + 1) % count
    else if (e.key === 'ArrowUp') next = (index - 1 + count) % count
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    if (next !== null) {
      e.preventDefault()
      setFocusIdx(next)
      rowRefs.current[next]?.focus()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const item = connections[index]
      if (item) requestColabConnectionSwitch(workspaceRoot, item, t)
    }
  }

  const addFlowVisible = addAccountOpen || Boolean(snapshot.oauthPending) || hasLoginFailure
  const addFlow = addFlowVisible ? (
    <ColabConnectionsAddFlow
      workspaceRoot={workspaceRoot}
      oauthPending={snapshot.oauthPending}
      lastOutcome={outcome}
      reauthConnectionId={reauthConnectionId}
      reauthName={
        reauthConnectionId ? connections.find((c) => c.id === reauthConnectionId)?.name : undefined
      }
      onCancelForm={closeAddAccount}
    />
  ) : null

  if (connections.length === 0) {
    return (
      <section data-testid="colab-connections-empty" className="w-full max-w-[360px]">
        <div className="rounded-xl border border-ds-border bg-ds-card p-5 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Cloud className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[13.5px] font-semibold text-ds-ink">{t('colab.emptyTitle')}</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ds-muted">{t('colab.emptyDesc')}</p>
          {!addFlowVisible ? (
            <button
              type="button"
              onClick={() => openAddAccount()}
              className="mt-3.5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white shadow-sm hover:opacity-95"
            >
              <span>{t('colab.signInWithGoogle')}</span>
            </button>
          ) : null}
        </div>
        {addFlow}
      </section>
    )
  }

  const isExpanded = expanded || addFlowVisible || pendingSwitchTarget !== null

  if (!isExpanded && activeConnection) {
    const expired = activeConnection.status === 'expired'
    return (
      <section
        data-testid="colab-connections-collapsed"
        className="shrink-0 border-t border-ds-border bg-ds-sidebar px-3 py-2.5"
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
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
            {expired ? activeConnection.name : `${activeConnection.name} · ${activeConnection.email}`}
          </span>
          {expired ? (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
              {t('colab.reauthorize')}
            </span>
          ) : activeConnection.balanceCu !== null ? (
            <span className="shrink-0 font-mono text-[11px] text-ds-muted">
              {activeConnection.balanceCu} CU
            </span>
          ) : null}
          {connections.length > 1 ? (
            <span className="shrink-0 rounded-full bg-ds-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ds-faint">
              {connections.length}
            </span>
          ) : null}
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
          aria-expanded
          onClick={() => {
            closeAddAccount()
            setPendingSwitchTargetId(null)
            setExpanded(false)
          }}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ds-ink hover:text-accent"
        >
          <ChevronDown className="h-3.5 w-3.5 text-ds-faint" />
          <span>{t('colab.connectionsLabel')}</span>
        </button>
        {!addFlowVisible ? (
          <button
            type="button"
            onClick={() => openAddAccount()}
            className="inline-flex items-center gap-1 rounded-lg border border-ds-border bg-ds-card px-2 py-1 text-[11px] font-medium text-ds-ink hover:bg-ds-hover"
          >
            <Plus className="h-3 w-3" />
            <span>{t('colab.addAccountBtn')}</span>
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-ds-faint">{t('colab.connectionsSubtitle')}</p>

      <div role="radiogroup" aria-label={t('colab.connectionsLabel')} className="mt-2 space-y-1.5">
        {connections.map((conn, idx) => (
          <ColabConnectionRow
            key={conn.id}
            conn={conn}
            wsKey={wsKey}
            selected={activeConnection?.id === conn.id}
            focusable={idx === rovingIdx}
            isNew={newlyCreatedId === conn.id}
            highlighted={highlightedId === conn.id}
            registerRef={(el) => {
              rowRefs.current[idx] = el
            }}
            onFocus={() => setFocusIdx(idx)}
            onKeyDown={(e) => handleRowKeyDown(e, idx)}
            onActivate={() => requestColabConnectionSwitch(workspaceRoot, conn, t)}
            onReauth={() => openAddAccount(conn.id)}
            onRequestSignOut={() => {
              setStopBeforeSignOut(true)
              setSignOutTarget(conn)
            }}
          />
        ))}
      </div>

      {pendingSwitchTarget && activeConnection ? (
        <div
          role="alertdialog"
          className="mt-2 rounded-xl border border-amber-500/35 bg-ds-card p-3 text-[12px] shadow-md"
        >
          <div className="font-semibold text-ds-ink">
            {t('colab.switchConfirmTitle')}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ds-muted">
            {t('colab.switchConfirmBody', {
              session: workspaceRunning.map((s) => s.sessionName).join(', '),
              from: activeConnection.name,
              to: pendingSwitchTarget.name
            })}
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingSwitchTargetId(null)}
              className="rounded-lg px-2.5 py-1 text-[11.5px] text-ds-muted hover:bg-ds-hover"
            >
              {t('colab.cancelBtn')}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => void performColabConnectionSwitch(workspaceRoot, pendingSwitchTarget, t)}
              className="rounded-lg bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white"
            >
              {t('colab.switchConfirmAction')}
            </button>
          </div>
        </div>
      ) : null}

      {signOutTarget ? (
        <div
          role="alertdialog"
          className="mt-2 rounded-xl border border-red-500/35 bg-ds-card p-3 text-[12px] shadow-md"
        >
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
              autoFocus
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
                  stopRunningSessions: target.activeSessions.length > 0 ? stopBeforeSignOut : false
                })
              }}
              className="rounded-lg bg-red-600 px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-red-700"
            >
              {t('colab.signOutConfirm')}
            </button>
          </div>
        </div>
      ) : null}

      {addFlow}
    </section>
  )
}
