import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  harnessRowAvailable,
  harnessRowRunsTurns,
  useHarnessStore
} from '../../store/harness-store'

/**
 * P4-16: on a manager session the composer shows which agents the manager can
 * dispatch to — the ready turn-capable harness rows. Terminal-only agents
 * (P4-13) and one-to-one/worker threads never see the label; clicking opens
 * the Agent Center where the dispatchable set is managed.
 */
export function FloatingComposerDispatchableAgents({
  thread,
  enabled
}: {
  thread: NormalizedThread | null
  enabled: boolean
}): ReactElement | null {
  const { t } = useTranslation('common')
  const openSettings = useChatStore((s) => s.openSettings)
  const rows = useHarnessStore((s) => s.rows)
  const isManager =
    enabled === true &&
    thread?.workspaceMode === 'ade' &&
    !thread.executionUnit &&
    !thread.harnessId
  const names = useMemo(
    () =>
      rows
        .filter((row) => harnessRowRunsTurns(row) && harnessRowAvailable(row))
        .map((row) => row.definition.displayName),
    [rows]
  )
  if (!isManager) return null
  const empty = names.length === 0
  const shown = names.slice(0, 3)
  const label = empty
    ? t('adeDispatchableNone')
    : t('adeDispatchable', {
        names: shown.join(' · ') + (names.length > shown.length ? ` +${names.length - shown.length}` : '')
      })
  return (
    <button
      type="button"
      data-dispatchable-agents-pill
      onClick={() => openSettings('agentsHarnesses')}
      title={t('adeDispatchableHint')}
      className={`ds-composer-status-glass pointer-events-auto inline-flex min-h-8 items-center gap-1.5 self-start rounded-full border px-3 py-1 text-[12px] font-medium transition hover:border-accent/40 ${
        empty ? 'border-ds-status-warning/40 text-ds-status-warning' : 'text-ds-muted hover:text-ds-ink'
      }`}
    >
      <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
      {label}
    </button>
  )
}
