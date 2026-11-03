import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useTerminalDockStore } from './terminal-dock-store'
import { statusDot, strongestDot, type TerminalStatusDot } from './terminal-dock-model'
import { useTerminalSettings } from './terminal-settings'

const DOT_COLOR: Record<Exclude<TerminalStatusDot, null>, string> = {
  running: 'var(--ds-accent)',
  waiting: 'var(--ds-warning)',
  done: 'var(--ds-success)',
  failed: 'var(--ds-danger)'
}

/** Most urgent session dot across terminals; running counts only when asked. */
export function useTerminalAttentionDot(includeRunning: boolean): TerminalStatusDot {
  return useTerminalDockStore((state) => strongestDot(Object.values(state.status).map((status) => {
    const dot = statusDot(status)
    return dot === 'running' && !includeRunning ? null : dot
  })))
}

/** Tooltip for the top-bar button: the label plus what needs attention. */
export function useTerminalButtonTooltip(base: string, dockOpen: boolean): string {
  const { t } = useTranslation('common')
  const counts = useTerminalDockStore(useShallow((state) => {
    const next = { waiting: 0, done: 0, running: 0 }
    for (const status of Object.values(state.status)) {
      const dot = statusDot(status)
      if (dot === 'waiting' || dot === 'done' || dot === 'running') next[dot] += 1
    }
    return next
  }))
  if (dockOpen) return base
  const parts = [base]
  if (counts.waiting) parts.push(t('termDockTooltipWaiting', { n: counts.waiting }))
  if (counts.done) parts.push(t('termDockTooltipDone', { n: counts.done }))
  if (counts.running) parts.push(t('termDockTooltipRunning', { n: counts.running }))
  return parts.join(' · ')
}

/** Dot on the top-bar terminal button while the dock is closed. */
export function TerminalAttentionBadge({ dockOpen }: { dockOpen: boolean }): ReactElement | null {
  const settings = useTerminalSettings()
  const dot = useTerminalAttentionDot(true)
  if (dockOpen || !settings.behavior.statusAlerts || !dot) return null
  return (
    <span
      aria-hidden="true"
      data-terminal-attention={dot}
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: DOT_COLOR[dot],
        boxShadow: '0 0 0 2px var(--ds-topbar-bg, var(--ds-bg-main))',
        pointerEvents: 'none'
      }}
    />
  )
}
