import { describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { buildGoogleWorkspaceToolProvider } from '../google-workspace/google-workspace-tools.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { runAgentCommand } from './agent-cli.js'

function writable() {
  const chunks: string[] = []
  return { write: (chunk: string): void => { chunks.push(chunk) }, text: (): string => chunks.join('') }
}

describe('CLI Google Workspace mandatory approval', () => {
  it('still permits read-only calls from non-interactive full access', async () => {
    const call = vi.fn(async () => ({ messages: [] }))
    const toolHost = new LocalToolHost({ registry: new CapabilityRegistry(buildGoogleWorkspaceToolProvider({ service: { call } })) })
    const stdout = writable()
    const runtime = { toolHost, shutdown: async () => undefined } as unknown as ServerRuntime
    const code = await runAgentCommand('exec', ['google_workspace_call', '--data-dir', '/tmp/google-workspace-cli-test', '--approval-policy', 'auto', '--sandbox-mode', 'danger-full-access', '--json', '--args', JSON.stringify({ method: 'gmail.users.messages.list' })], {
      stdout, stderr: writable(), createRuntime: async () => runtime
    })
    expect(code).toBe(0)
    expect(call).toHaveBeenCalledOnce()
    expect(stdout.text()).toContain('untrusted-external-data')
  })

  it('cannot silently send from kun exec --approval-policy auto --sandbox-mode danger-full-access', async () => {
    const call = vi.fn(async () => ({ id: 'must-not-send' }))
    const toolHost = new LocalToolHost({ registry: new CapabilityRegistry(buildGoogleWorkspaceToolProvider({ service: { call } })) })
    const stdout = writable()
    const stderr = writable()
    const shutdown = vi.fn(async () => undefined)
    const runtime = { toolHost, shutdown } as unknown as ServerRuntime
    const code = await runAgentCommand('exec', ['google_workspace_call', '--data-dir', '/tmp/google-workspace-cli-test', '--approval-policy', 'auto', '--sandbox-mode', 'danger-full-access', '--json', '--args', JSON.stringify({
      method: 'gmail.users.messages.send', body: { to: ['to@example.com'], subject: 'Subject', text: 'Do not send without human confirmation' }
    })], { stdout, stderr, createRuntime: async () => runtime })
    expect(stderr.text()).toBe('')
    expect(call).not.toHaveBeenCalled()
    expect(code).not.toBe(0)
    expect(stdout.text()).toContain('approval_denied')
    expect(stdout.text()).toContain('interactive')
    expect(shutdown).toHaveBeenCalledOnce()
  })
})
