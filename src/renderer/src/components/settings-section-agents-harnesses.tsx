import type { ReactElement } from 'react'
import { useHarnessStore } from '../store/harness-store'
import { openTerminalWithSetup } from './terminal/terminal-open'
import { AgentCenter } from './ade/AgentCenter'

/**
 * Settings → Agents → Harnesses hosts the shared Agent Center (P4-08,
 * docs/ade/impl/p4 §3.2): the same cards the ADE sidebar entry opens, so
 * both surfaces stay identical.
 *
 * Interactive login and the optional manual install fallback prefill the builtin setup command
 * into a fresh Kun terminal tab instead of running it — the user reviews
 * and executes it, and the harness is re-probed when that PTY exits. The
 * command only ever comes from builtin `setup` metadata
 * (agent-center-actions.ts drops `setup` for custom definitions), and the
 * settings view is left first so the terminal is actually visible.
 */
export function AgentsHarnessesSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { kun, updateKun, activePanel, goBack, beforeAgentEnablementCheck } = view as {
    kun: Parameters<typeof AgentCenter>[0]['kun']
    updateKun: Parameters<typeof AgentCenter>[0]['updateKun']
    beforeAgentEnablementCheck?: () => Promise<boolean>
    activePanel: string
    goBack?: () => void
  }
  const rows = useHarnessStore((state) => state.rows)
  return (
    <div
      id="agents-settings-panel-harnesses"
      role="tabpanel"
      aria-labelledby="agents-settings-tab-harnesses"
      className={activePanel === 'harnesses' ? '' : 'hidden'}
    >
      {activePanel === 'harnesses' ? <AgentCenter
        settingsSurface
        kun={kun}
        updateKun={updateKun}
        beforeEnableCheck={beforeAgentEnablementCheck}
        onSetupCommand={(harnessId, command, title) => {
          const definition = rows.find((row) => row.definition.id === harnessId)?.definition
          // Defence in depth: only builtin definitions may prefill commands.
          if (!definition?.builtin || !command.trim()) return
          openTerminalWithSetup({
            prefill: command,
            probeHarnessId: harnessId,
            title: title ?? definition.displayName
          })
          goBack?.()
        }}
      /> : null}
    </div>
  )
}
