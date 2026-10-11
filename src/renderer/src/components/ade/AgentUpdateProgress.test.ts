// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { AgentUpdateProgress, agentUpdateLastLine, agentUpdateStepIndex, formatAgentUpdateElapsed } from './AgentUpdateProgress'

describe('Agent update progress', () => {
  it('maps updater stages to steps', () => {
    expect(['waiting', 'running', 'verifying', 'ready', 'completed'].map((status) => agentUpdateStepIndex(status as never))).toEqual([0, 1, 2, 3, 4])
    expect(agentUpdateStepIndex('verifying', true)).toBe(3)
  })
  it('shows the latest updater line and elapsed time', () => {
    expect(agentUpdateLastLine('Current version: 2.1.291\nChecking for updates...\n\u001b[32mUpdating to 2.1.295...\u001b[0m\n\n')).toBe('Updating to 2.1.295...')
    expect(agentUpdateLastLine('')).toBeUndefined()
    expect(formatAgentUpdateElapsed(9_400)).toBe('9s')
    expect(formatAgentUpdateElapsed(125_000)).toBe('2m 05s')
  })
  it('renders done, active and pending steps with the live output line', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(createElement(AgentUpdateProgress, { version: '2.1.295', t: (key: string, options?: Record<string, unknown>) => `${key}${options?.version ? `:${options.version}` : ''}`,
        job: { id: 'j', action: 'update', status: 'running', startedAt: new Date(Date.now() - 12_000).toISOString(), output: 'Updating to 2.1.295...\n' } })))
      const steps = [...host.querySelectorAll('[data-agent-update-step]')].map((node) => `${node.getAttribute('data-agent-update-step')}=${node.getAttribute('data-state')}`)
      expect(steps).toEqual(['wait=done', 'install=active', 'verify=todo', 'activate=todo'])
      expect(host.textContent).toContain('agentUpdate.progress.install:2.1.295')
      expect(host.querySelector('[data-agent-update-last-line]')?.textContent).toBe('Updating to 2.1.295...')
      expect(host.querySelector('[data-agent-update-elapsed]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false }
  })
})
