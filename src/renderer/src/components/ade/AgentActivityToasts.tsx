import { useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AGENT_UPDATE_RUNNING,
  hideAgentUpdateToast,
  useAgentUpdateRunner,
  type AgentUpdateItem
} from '../../store/harness-update-runner'
import { useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { formatAgentUpdateElapsed } from './AgentUpdateProgress'
import { useAgentActivityStore } from './agent-center-activity-store'
import type { AgentInstallObservation } from './agent-center-presentation'
import { usePublishedToasts } from '../../toast/use-published-toast'
import type { ToastInput } from '../../toast/toast-types'
import './use-agent-install-watch'

/** Finished successes leave by themselves; failures stay until closed. */
const SUCCESS_MS = 8_000

/**
 * Publishes Agent work that outlives its page to the global dock: an update
 * or install keeps reporting after the user leaves Settings, and its result
 * is announced. The Agent whose page is open stays quiet; its banner and list
 * row already say the same thing.
 */
export function AgentActivityToasts(): ReactElement | null {
  const { t } = useTranslation('common')
  const items = useAgentUpdateRunner((state) => state.items)
  const installs = useAgentActivityStore((state) => state.install)
  const viewing = useAgentActivityStore((state) => state.viewing)
  const rows = useHarnessStore((state) => state.rows)
  const [closed, setClosed] = useState<Record<string, true>>({})
  // Only installs seen running in this session are announced when they end.
  const seenRunning = useRef(new Set<string>())
  for (const [id, observation] of Object.entries(installs)) {
    if (observation.status === 'running' || observation.status === 'verifying') seenRunning.current.add(id)
  }

  const name = (id: string): string =>
    rows.find((row) => row.definition.id === id)?.definition.displayName ?? id
  const open = (harnessId: string, tab?: 'version'): void => {
    useHarnessStore.setState({ settingsHarnessId: harnessId, ...(tab ? { settingsHarnessTab: tab } : {}) })
    useChatStore.getState().openSettings('agentsHarnesses')
  }
  const installKey = (id: string, observation: AgentInstallObservation): string =>
    `${id}:${observation.status}:${observation.startedAt ?? ''}`
  const closeInstall = (key: string): void => setClosed((current) => ({ ...current, [key]: true }))

  const updateToast = (update: AgentUpdateItem): ToastInput | null => {
    if (update.toastHidden || update.harnessId === viewing) return null
    const rollback = update.action === 'rollback'
    const harnessId = update.harnessId
    const action = { label: t('agentCenter.toast.view'), run: () => open(harnessId, 'version') }
    const onDismiss = (): void => hideAgentUpdateToast(harnessId)
    if (AGENT_UPDATE_RUNNING.has(update.phase)) {
      return {
        id: `update:${harnessId}`,
        tone: 'running',
        title: t(rollback ? 'agentCenter.toast.rollingBack' : 'agentCenter.toast.updating', { name: name(harnessId) }),
        description: t(`agentCenter.activity.step.${update.phase}`),
        since: update.startedAt,
        durationMs: null,
        actions: [action],
        onDismiss
      }
    }
    if (update.phase === 'completed') {
      return {
        id: `update:${harnessId}`,
        tone: 'success',
        title: t(rollback ? 'agentCenter.toast.rolledBack' : 'agentCenter.toast.updated', { name: name(harnessId), version: update.version ?? '' }),
        description: t('agentCenter.toast.updatedDetail', {
          time: formatAgentUpdateElapsed((update.finishedAt ?? update.startedAt) - update.startedAt)
        }),
        durationMs: SUCCESS_MS,
        actions: [action],
        onDismiss
      }
    }
    return {
      id: `update:${harnessId}`,
      tone: 'warning',
      title: t('agentCenter.toast.updateFailed', { name: name(harnessId) }),
      description: t('agentCenter.toast.updateFailedDetail'),
      durationMs: null,
      actions: [action],
      onDismiss
    }
  }

  const installToast = (id: string, observation: AgentInstallObservation): ToastInput | null => {
    const key = installKey(id, observation)
    if (id === viewing || closed[key] || !seenRunning.current.has(id) || observation.status === 'cancelled') return null
    const action = {
      label: t(observation.status === 'completed' ? 'agentCenter.toast.connect' : 'agentCenter.toast.view'),
      run: () => open(id)
    }
    const onDismiss = (): void => closeInstall(key)
    if (observation.status === 'running' || observation.status === 'verifying') {
      return {
        id: `install:${id}`,
        tone: 'running',
        title: t('agentCenter.toast.installing', { name: name(id) }),
        description: observation.lastLine ?? t('agentCenter.state.installing.status'),
        ...(observation.startedAt ? { since: observation.startedAt } : {}),
        durationMs: null,
        actions: [action],
        onDismiss
      }
    }
    if (observation.status === 'completed') {
      return {
        id: `install:${id}`,
        tone: 'success',
        title: t('agentCenter.toast.installed', { name: name(id) }),
        description: t('agentCenter.toast.installedDetail'),
        durationMs: SUCCESS_MS,
        actions: [action],
        onDismiss
      }
    }
    return {
      id: `install:${id}`,
      tone: 'warning',
      title: t('agentCenter.toast.installFailed', { name: name(id) }),
      ...(observation.lastLine ? { description: observation.lastLine } : {}),
      durationMs: null,
      actions: [action],
      onDismiss
    }
  }

  usePublishedToasts([
    ...Object.values(items).map(updateToast),
    ...Object.entries(installs).map(([id, observation]) => installToast(id, observation))
  ].filter((toast): toast is ToastInput => toast !== null))
  return null
}
