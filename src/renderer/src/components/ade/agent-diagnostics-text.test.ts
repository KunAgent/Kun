import { describe, expect, it } from 'vitest'
import { agentDiagnosticsText } from './agent-diagnostics-text'

const base = { name: 'Codex', id: 'codex', transport: 'codex-app-server', connection: 'native login', platform: 'darwin' }

describe('agentDiagnosticsText', () => {
  it('lists the Agent, its launch facts and every check', () => {
    const text = agentDiagnosticsText({ ...base, version: '0.47.0', checkedAt: '2026-10-08T10:00:00Z', command: '/opt/homebrew/bin/codex',
      args: ['app-server', '--listen'], rows: [
        { id: 'command', status: 'ok', value: '/opt/homebrew/bin/codex' },
        { id: 'credentials', status: 'warn', value: 'No local credentials found' },
        { id: 'protocol', status: 'error', value: 'Handshake timed out' }
      ] })
    expect(text).toContain('Agent: Codex (codex)')
    expect(text).toContain('Version: 0.47.0')
    expect(text).toContain('Arguments: app-server --listen')
    expect(text).toContain('[ok] Command: /opt/homebrew/bin/codex')
    expect(text).toContain('[warning] Credentials: No local credentials found')
    expect(text).toContain('[failed] Session handshake: Handshake timed out')
  })

  it('names environment variables but never prints their values', () => {
    const text = agentDiagnosticsText({ ...base, envNames: ['OPENAI_BASE_URL', 'CODEX_HOME'] })
    expect(text).toContain('Environment variables (names only): CODEX_HOME, OPENAI_BASE_URL')
    expect(text).not.toMatch(/=/)
  })

  it('falls back to the coarse checks and reports the error with its detail', () => {
    const text = agentDiagnosticsText({ ...base, checks: [{ id: 'installation', ok: true }, { id: 'credentials', ok: false, detail: 'Missing account' }],
      error: 'Credentials are not confirmed', detail: 'Missing account' })
    expect(text).toContain('[ok] Installation')
    expect(text).toContain('[failed] Credentials: Missing account')
    expect(text).toContain('Error: Credentials are not confirmed')
    expect(text).toContain('Detail: Missing account')
  })
})
