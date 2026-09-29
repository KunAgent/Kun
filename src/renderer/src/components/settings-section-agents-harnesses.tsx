import type { ReactElement } from 'react'
import { AgentCenter } from './ade/AgentCenter'

/**
 * Settings → Agents → Harnesses hosts the shared Agent Center (P4-08,
 * docs/ade/impl/p4 §3.2): the same cards the ADE sidebar entry opens, so
 * both surfaces stay identical.
 */
export function AgentsHarnessesSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, kun, updateKun, activePanel } = view as {
    t: (key: string, options?: Record<string, unknown>) => string
    kun: Parameters<typeof AgentCenter>[0]['kun']
    updateKun: Parameters<typeof AgentCenter>[0]['updateKun']
    activePanel: string
  }
  return (
    <div
      id="agents-settings-panel-harnesses"
      role="tabpanel"
      aria-labelledby="agents-settings-tab-harnesses"
      className={activePanel === 'harnesses' ? '' : 'hidden'}
    >
      <AgentCenter t={t} kun={kun} updateKun={updateKun} />
    </div>
  )
}
