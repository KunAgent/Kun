import { useEffect, type RefObject } from 'react'
import type { TerminalSettingsV1 } from '@shared/app-settings'
import { resolveTerminalTheme } from './terminal-panel-support'
import { configureTerminals, collectTerminalSnapshots, feedKunProcess, hasTerminalInstance } from './terminal-instance-registry'
import { processesInWorkspace, subscribeKunProcesses, useKunProcessStore } from './terminal-kun-processes'
import { addTerminalTab, useTerminalDockStore, workspaceTerminals } from './terminal-dock-store'
import { freshPane, TERMINAL_SNAPSHOT_LINES } from './terminal-dock-model'
import { saveTerminalSnapshots } from './terminal-restore'
import type { ShellCommandRecord } from './terminal-shell-commands'
import { useTerminalSettings } from './terminal-settings'

type T = (key: string, options?: Record<string, unknown>) => string

const SNAPSHOT_INTERVAL_MS = 20_000

function markDescription(record: ShellCommandRecord, t: T): string {
  const parts = [record.command || t('termDockLastCommand')]
  if (typeof record.exitCode === 'number') parts.push(t('termDockExitCode', { code: record.exitCode }))
  if (record.state === 'running') parts.push(t('termDockRunningShort'))
  return parts.join(' · ')
}

function formatSavedAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Wiring that lives as long as a dock is mounted: settings and theme for every
 * instance, Kun background shells mirrored into tabs, and periodic snapshots
 * for restore after restart.
 */
export function useTerminalDockRuntime({
  rootRef,
  workspaceRoot,
  workspaceKey,
  t
}: {
  rootRef: RefObject<HTMLElement | null>
  workspaceRoot: string
  workspaceKey: string
  t: T
}): TerminalSettingsV1 {
  const settings = useTerminalSettings()
  const processes = useKunProcessStore((state) => state.processes)

  useEffect(() => {
    const apply = (): void => {
      const root = rootRef.current
      const theme = resolveTerminalTheme(root, settings.colors)
      configureTerminals({
        settings,
        theme,
        searchColors: { match: 'rgba(240, 162, 63, 0.3)', active: 'rgba(240, 162, 63, 0.7)' },
        restoredDivider: (savedAt) => `── ${t('termDockRestoredDivider', { time: formatSavedAt(savedAt) })} ──`,
        describeMark: (record) => markDescription(record, t)
      })
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    return () => observer.disconnect()
  }, [rootRef, settings, t])

  useEffect(() => subscribeKunProcesses(true), [])

  useEffect(() => {
    const workspaceProcesses = processesInWorkspace(processes, workspaceRoot)
    const { dismissedProcesses } = useTerminalDockStore.getState()
    const { tabs } = workspaceTerminals(workspaceKey)
    const open = new Set(tabs.flatMap((tab) => tab.panes).flatMap((pane) => pane.target.kind === 'kun-process' ? [pane.target.processId] : []))
    for (const process of workspaceProcesses) {
      if (settings.behavior.showKunProcesses && process.status === 'running' && !open.has(process.id) && !dismissedProcesses[process.id]) {
        addTerminalTab(workspaceKey, freshPane(
          { kind: 'kun-process', processId: process.id, command: process.command, threadId: process.threadId },
          { title: process.command }
        ), { activate: false })
        open.add(process.id)
      }
    }
    for (const process of processes) {
      const id = `kun-process:${process.id}`
      if (hasTerminalInstance(id)) feedKunProcess(id, process.output ?? '', process.status === 'running', process.exitCode)
    }
  }, [processes, settings.behavior.showKunProcesses, workspaceKey, workspaceRoot])

  useEffect(() => {
    if (!settings.behavior.restoreSessions) return
    const save = (): void => saveTerminalSnapshots(collectTerminalSnapshots(TERMINAL_SNAPSHOT_LINES), TERMINAL_SNAPSHOT_LINES)
    const timer = window.setInterval(save, SNAPSHOT_INTERVAL_MS)
    window.addEventListener('beforeunload', save)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', save)
      save()
    }
  }, [settings.behavior.restoreSessions])

  return settings
}
