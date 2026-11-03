// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { AgentDiagnosticRows } from './AgentDiagnosticRows'

it('labels each readiness stage and marks its status', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div'), root = createRoot(container)
  try {
    await act(async () => root.render(createElement(AgentDiagnosticRows, { rows: [
      { id: 'command', status: 'ok', value: '/opt/homebrew/bin/opencode' },
      { id: 'credentials', status: 'warn', value: 'No local credential found; the Agent asks you to sign in if it needs one' },
      { id: 'protocol', status: 'error', value: 'OpenCode cannot open its database' }
    ] })))
    const rows = [...container.querySelectorAll<HTMLElement>('[data-agent-diagnostic]')]
    expect(rows.map((row) => [row.dataset.agentDiagnostic, row.dataset.status])).toEqual([
      ['command', 'ok'], ['credentials', 'warn'], ['protocol', 'error']])
    expect(container.textContent).toContain('agentEnablement.diagnostics.credentials')
    expect(container.textContent).toContain('/opt/homebrew/bin/opencode')
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals() }
})
