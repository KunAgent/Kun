import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, LoaderCircle, X } from 'lucide-react'
import { AGENT_UPDATE_RUNNING, hideAgentUpdateToast, useAgentUpdateRunner, type AgentUpdateItem } from '../../store/harness-update-runner'
import { useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { AgentIcon } from '../agent-icon'
import { AgentElapsed } from './AgentCenterParts'
import { formatAgentUpdateElapsed } from './AgentUpdateProgress'
import { useAgentActivityStore } from './agent-center-activity-store'
import type { AgentInstallObservation } from './agent-center-presentation'
import './use-agent-install-watch'

/** Finished successes leave by themselves; failures stay until closed. */
const SUCCESS_MS = 8_000
const MAX_CARDS = 3

type Card = {
  key: string
  harnessId: string
  tone: 'running' | 'success' | 'warning'
  title: string
  detail: ReactNode
  action: { label: string; tab?: 'version' }
  close: () => void
  closeLabel: string
  since?: number
}

function Toast({ card, onOpen }: { card: Card; onOpen: () => void }): ReactElement {
  const badge = card.tone === 'running'
    ? <span className="grid h-4 w-4 place-items-center rounded-full bg-ds-card"><LoaderCircle aria-hidden className="h-3 w-3 animate-spin text-accent" /></span>
    : card.tone === 'success'
      ? <span className="grid h-4 w-4 place-items-center rounded-full border-2 border-ds-card bg-ds-status-success text-white"><Check aria-hidden className="h-2 w-2" strokeWidth={4} /></span>
      : <span className="grid h-4 w-4 place-items-center rounded-full border-2 border-ds-card bg-[var(--ds-warning)] text-[9px] font-bold leading-none text-white">!</span>
  return <div role={card.tone === 'warning' ? 'alert' : 'status'} data-agent-toast={card.key}
    className="pointer-events-auto relative flex w-[320px] max-w-[calc(100vw-2.5rem)] items-start gap-2.5 overflow-hidden rounded-2xl border border-ds-border bg-ds-card py-3 pl-3 pr-2 text-ds-ink shadow-[0_18px_44px_rgba(16,24,40,0.16)]">
    <span className="relative grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-ds-border-muted bg-ds-subtle">
      <AgentIcon harnessId={card.harnessId} size={15} />
      <span className="absolute -bottom-1.5 -right-1.5">{badge}</span>
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[13px] font-semibold leading-[18px]">{card.title}</p>
      <p className="mt-0.5 flex min-w-0 text-[12px] leading-[17px] text-ds-muted">
        <span className="truncate">{card.detail}</span>
        {card.since ? <span className="shrink-0">&nbsp;· <AgentElapsed since={card.since} /></span> : null}
      </p>
    </div>
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" onClick={onOpen} data-agent-toast-open
        className="h-7 rounded-lg border border-ds-border px-2.5 text-[12px] font-medium text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
        {card.action.label}</button>
      <button type="button" onClick={card.close} aria-label={card.closeLabel} title={card.closeLabel} data-agent-toast-close
        className="grid h-7 w-7 place-items-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40">
        <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
      </button>
    </div>
    {card.tone === 'running' ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-[color-mix(in_srgb,var(--ds-accent)_14%,transparent)]">
      <span className="block h-full w-1/3 animate-pulse bg-accent" />
    </span> : null}
  </div>
}

/**
 * Floating cards for Agent work that outlives its page:
 * an update or install keeps reporting after the user leaves Settings, and
 * its result is announced. The Agent whose page is open stays quiet; its
 * banner and list row already say the same thing.
 */
export function AgentActivityToasts(): ReactElement | null {
  const { t } = useTranslation('common')
  const items = useAgentUpdateRunner((state) => state.items)
  const installs = useAgentActivityStore((state) => state.install)
  const viewing = useAgentActivityStore((state) => state.viewing)
  const rows = useHarnessStore((state) => state.rows)
  const [closed, setClosed] = useState<Record<string, number>>({})
  // Only installs seen running in this session are announced when they end.
  const seenRunning = useRef(new Set<string>())
  for (const [id, observation] of Object.entries(installs)) {
    if (observation.status === 'running' || observation.status === 'verifying') seenRunning.current.add(id)
  }

  const installKey = (id: string, observation: AgentInstallObservation): string => `${id}:${observation.status}:${observation.startedAt ?? ''}`
  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = []
    for (const update of Object.values(items)) {
      if (update.phase !== 'completed' || update.toastHidden) continue
      timers.push(setTimeout(() => hideAgentUpdateToast(update.harnessId), Math.max(0, SUCCESS_MS - (Date.now() - (update.finishedAt ?? Date.now())))))
    }
    for (const [id, observation] of Object.entries(installs)) {
      if (observation.status !== 'completed') continue
      const key = installKey(id, observation)
      timers.push(setTimeout(() => setClosed((current) => ({ ...current, [key]: Date.now() })), SUCCESS_MS))
    }
    return () => timers.forEach(clearTimeout)
  }, [items, installs])

  const name = (id: string): string => rows.find((row) => row.definition.id === id)?.definition.displayName ?? id
  const updateCard = (update: AgentUpdateItem): Card | null => {
    if (update.toastHidden || update.harnessId === viewing) return null
    const rollback = update.action === 'rollback'
    const common = { key: `update:${update.harnessId}`, harnessId: update.harnessId, close: () => hideAgentUpdateToast(update.harnessId) }
    if (AGENT_UPDATE_RUNNING.has(update.phase)) {
      return { ...common, tone: 'running', title: t(rollback ? 'agentCenter.toast.rollingBack' : 'agentCenter.toast.updating', { name: name(update.harnessId) }),
        detail: t(`agentCenter.activity.step.${update.phase}`), since: update.startedAt,
        action: { label: t('agentCenter.toast.view'), tab: 'version' }, closeLabel: t('agentCenter.toast.hide') }
    }
    if (update.phase === 'completed') {
      return { ...common, tone: 'success', title: t(rollback ? 'agentCenter.toast.rolledBack' : 'agentCenter.toast.updated', { name: name(update.harnessId), version: update.version ?? '' }),
        detail: t('agentCenter.toast.updatedDetail', { time: formatAgentUpdateElapsed((update.finishedAt ?? update.startedAt) - update.startedAt) }),
        action: { label: t('agentCenter.toast.view'), tab: 'version' }, closeLabel: t('agentCenter.toast.close') }
    }
    return { ...common, tone: 'warning', title: t('agentCenter.toast.updateFailed', { name: name(update.harnessId) }),
      detail: t('agentCenter.toast.updateFailedDetail'), action: { label: t('agentCenter.toast.view'), tab: 'version' }, closeLabel: t('agentCenter.toast.close') }
  }
  const installCard = (id: string, observation: AgentInstallObservation): Card | null => {
    const key = installKey(id, observation)
    if (id === viewing || closed[key] || !seenRunning.current.has(id) || observation.status === 'cancelled') return null
    const close = () => setClosed((current) => ({ ...current, [key]: Date.now() }))
    if (observation.status === 'running' || observation.status === 'verifying') {
      return { key: `install:${id}`, harnessId: id, tone: 'running', title: t('agentCenter.toast.installing', { name: name(id) }),
        detail: observation.lastLine ?? t('agentCenter.state.installing.status'), ...(observation.startedAt ? { since: observation.startedAt } : {}),
        action: { label: t('agentCenter.toast.view') }, close, closeLabel: t('agentCenter.toast.hide') }
    }
    if (observation.status === 'completed') {
      return { key: `install:${id}`, harnessId: id, tone: 'success', title: t('agentCenter.toast.installed', { name: name(id) }),
        detail: t('agentCenter.toast.installedDetail'), action: { label: t('agentCenter.toast.connect') }, close, closeLabel: t('agentCenter.toast.close') }
    }
    return { key: `install:${id}`, harnessId: id, tone: 'warning', title: t('agentCenter.toast.installFailed', { name: name(id) }),
      detail: observation.lastLine ?? '', action: { label: t('agentCenter.toast.view') }, close, closeLabel: t('agentCenter.toast.close') }
  }

  const cards = [
    ...Object.values(items).map(updateCard),
    ...Object.entries(installs).map(([id, observation]) => installCard(id, observation))
  ].filter((card): card is Card => card !== null).slice(-MAX_CARDS)
  if (!cards.length) return null
  const open = (card: Card): void => {
    card.close()
    useHarnessStore.setState({ settingsHarnessId: card.harnessId, ...(card.action.tab ? { settingsHarnessTab: card.action.tab } : {}) })
    useChatStore.getState().openSettings('agentsHarnesses')
  }
  return <section aria-label={t('agentCenter.toast.region')} data-agent-toasts
    className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
    {cards.map((card) => <Toast key={card.key} card={card} onOpen={() => open(card)} />)}
  </section>
}
