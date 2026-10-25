import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { normalizeTerminalSettings } from '@shared/app-settings-terminal'
import { KUN_TUI_AGENT_ID, moveAgent, terminalAgentEntries } from './terminal-agent-catalog'
import { parsePackageScripts, scriptCommandLine } from './terminal-workspace-scripts'
import { launchPreview } from './TerminalAgentLauncher'

function row(id: string, patch: { installed?: 'yes' | 'no'; login?: 'signed-in' | 'signed-out'; terminal?: boolean } = {}): AdeHarnessRow {
  return {
    definition: {
      id,
      displayName: id.toUpperCase(),
      transport: 'terminal',
      credentialModes: [],
      permissionModes: [],
      modelSource: 'static',
      staticModels: [],
      builtin: true,
      ...(patch.terminal === false ? {} : { terminal: { argv: [id], taskFlag: id === 'opencode' ? '--prompt' : undefined } }),
      setup: { login: { command: id, args: ['login'] } }
    },
    status: { harnessId: id, installed: patch.installed ?? 'yes', version: '1.0.0', login: patch.login ?? 'signed-in' }
  } as unknown as AdeHarnessRow
}

describe('terminal agent catalog', () => {
  const settings = normalizeTerminalSettings({
    profiles: [{ id: 'custom-x', name: 'X', command: 'x', args: '{task}', icon: 'terminal', cwd: '', env: [] }],
    hiddenAgentIds: ['codex'],
    agentOrder: ['custom-x']
  })

  it('lists installed terminal harnesses, Kun TUI and profiles in the saved order', () => {
    const entries = terminalAgentEntries([row('codex'), row('opencode', { login: 'signed-out' }), row('acp-only', { terminal: false }), row('missing', { installed: 'no' })], settings)
    expect(entries.map((entry) => entry.id)).toEqual(['custom-x', 'codex', 'opencode', KUN_TUI_AGENT_ID])
    expect(entries.find((entry) => entry.id === 'codex')?.hidden).toBe(true)
    expect(entries.find((entry) => entry.id === 'opencode')).toMatchObject({ needsLogin: true, loginCommand: 'opencode login' })
    expect(entries.find((entry) => entry.id === KUN_TUI_AGENT_ID)?.takesTask).toBe(false)
    expect(moveAgent(entries, 'codex', 1)).toEqual(['custom-x', 'opencode', 'codex', KUN_TUI_AGENT_ID])
  })

  it('previews the launch command', () => {
    const [custom, , opencode] = terminalAgentEntries([row('codex'), row('opencode')], settings)
    expect(launchPreview(custom!, 'fix it')).toBe(`x 'fix it'`)
    expect(launchPreview(opencode!, 'fix it')).toBe(`opencode --prompt 'fix it'`)
    expect(launchPreview(opencode!, '')).toBe('opencode')
  })
})

describe('workspace scripts', () => {
  it('lists runnable scripts without pre/post hooks', () => {
    expect(parsePackageScripts('{"scripts":{"dev":"vite","predev":"x","test:unit":"vitest","bad name":"x"}}')).toEqual([
      { name: 'dev', command: 'vite' },
      { name: 'test:unit', command: 'vitest' }
    ])
    expect(parsePackageScripts('not json')).toEqual([])
    expect(scriptCommandLine('npm', 'dev')).toBe('npm run dev')
    expect(scriptCommandLine('pnpm', 'dev')).toBe('pnpm run dev')
  })
})
