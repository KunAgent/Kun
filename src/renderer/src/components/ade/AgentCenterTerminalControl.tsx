import type { ReactElement } from 'react'
import { Terminal } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileEnabled, selectedHarnessProfile, terminalHarnessProfileReady } from '@shared/harness-enablement'
import { useChatStore } from '../../store/chat-store'
import { openTerminal } from '../terminal/terminal-open'
import { AgentIntegrationDocs, AgentIntegrationLocations, useAgentIntegration, type IntegrationT } from './AgentIntegrationLocations'

export function AgentCenterTerminalControl({ row, settings, t }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  t: IntegrationT
}): ReactElement {
  const integration = useAgentIntegration(row)
  const profile = selectedHarnessProfile(row, settings)
  const ready = harnessProfileEnabled(settings, profile) && terminalHarnessProfileReady(row, profile)
  const open = (): void => {
    if (!ready) return
    const state = useChatStore.getState()
    openTerminal({ cwd: state.workspaceRoot || undefined, title: row.definition.displayName,
      agent: { harnessId: row.definition.id, title: row.definition.displayName } })
    if (state.route === 'settings') state.closeSettings()
    if (useChatStore.getState().route !== 'chat') state.setRoute('chat')
  }
  return <section className="mt-3" data-agent-terminal-control>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" data-agent-open-terminal disabled={!ready} onClick={open}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45">
        <Terminal size={14} />{t('agentIntegrations.openTerminal')}
      </button>
      <AgentIntegrationDocs url={integration.info?.docsUrl ?? row.definition.setup?.docsUrl} integration={integration} t={t} />
    </div>
    {!ready ? <p className="mt-1 text-[11px] text-ds-faint">{t('agentIntegrations.terminalOpenHint')}</p> : null}
    <AgentIntegrationLocations integration={integration} t={t} />
  </section>
}
