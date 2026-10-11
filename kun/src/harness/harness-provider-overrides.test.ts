import { afterEach, describe, expect, it } from 'vitest'
import { HarnessesConfigSchema } from '../config/kun-config-harnesses.js'
import { harnessCommandOverride, harnessProviderOverrides } from '../config/kun-config-harness-providers.js'
import { HarnessCatalog } from './harness-catalog.js'
import { providerModule, setDerivedProviderModules } from './providers/registry.js'

afterEach(() => setDerivedProviderModules([]))

describe('harnessProviderOverrides', () => {
  const legacy = {
    binaryPaths: { codex: '/opt/codex', 'my-acp': '/opt/my-acp-2' },
    custom: [{ id: 'my-acp', displayName: 'Mine', command: 'my-acp', args: ['--acp'], env: { A: '1' }, secretEnv: [] }],
    terminalAgents: [{ id: 'my-tty', displayName: 'TTY', command: 'tty-agent', args: [], taskFlag: '-p' }]
  }

  it('folds command paths, custom ACP and terminal Agents into one view', () => {
    expect(harnessProviderOverrides(legacy)).toEqual({
      codex: { command: '/opt/codex' },
      // A command path used to override the custom Agent's own command at launch.
      'my-acp': { extends: 'acp', label: 'Mine', command: '/opt/my-acp-2', args: { mode: 'replace', values: ['--acp'] }, env: { A: '1' } },
      'my-tty': { extends: 'terminal', label: 'TTY', command: 'tty-agent', terminal: { taskFlag: '-p' } }
    })
  })

  it('lets explicit providers win over every legacy field', () => {
    const merged = harnessProviderOverrides({ ...legacy, providers: {
      codex: { command: '/usr/local/bin/codex' },
      'my-acp': { extends: 'opencode', label: 'Fork' }
    } })
    expect(merged.codex).toEqual({ command: '/usr/local/bin/codex' })
    // The explicit entry has no command, so the legacy path still fills it.
    expect(merged['my-acp']).toEqual({ extends: 'opencode', label: 'Fork', command: '/opt/my-acp-2' })
    expect(harnessCommandOverride({ ...legacy, providers: { codex: { command: '/usr/local/bin/codex' } } }, 'codex'))
      .toBe('/usr/local/bin/codex')
    expect(harnessCommandOverride(undefined, 'codex')).toBeUndefined()
  })

  it('accepts the providers section in kun config', () => {
    const parsed = HarnessesConfigSchema.parse({ providers: {
      'opencode-fork': { extends: 'opencode', command: 'fork', args: { mode: 'append', values: ['--x'] } }
    } })
    expect(parsed.providers['opencode-fork']?.args).toEqual({ mode: 'append', values: ['--x'] })
    expect(() => HarnessesConfigSchema.parse({ providers: { x: { env: { lower: '1' } } } })).toThrow()
  })
})

describe('HarnessCatalog provider overrides', () => {
  const catalog = (providers: Parameters<typeof harnessProviderOverrides>[0]) =>
    new HarnessCatalog({ providers: () => harnessProviderOverrides(providers) })

  it('patches a builtin label, arguments and environment but not its executable', () => {
    const opencode = catalog({ providers: { opencode: {
      label: 'OpenCode (work)', command: '/opt/opencode', args: { mode: 'append', values: ['--print-logs'] }, env: { OPENCODE_X: '1' }
    } } }).get('opencode')!
    expect(opencode.displayName).toBe('OpenCode (work)')
    expect(opencode.launch).toMatchObject({ command: 'opencode', args: ['acp', '--print-logs'], env: { OPENCODE_X: '1' } })
    expect(opencode.builtin).toBe(true)
  })

  it('derives an Agent from a builtin ACP engine with its behaviour but not its installer', () => {
    const list = catalog({ providers: { 'opencode-fork': { extends: 'opencode', label: 'Fork', command: 'fork-cli' } } }).list()
    const fork = list.find((definition) => definition.id === 'opencode-fork')!
    expect(fork).toMatchObject({
      displayName: 'Fork', transport: 'acp', builtin: false, derivedFrom: 'opencode',
      detect: { command: 'fork-cli', aliases: [] }, launch: { command: 'fork-cli', args: ['acp'] },
      permissionModes: [{ id: 'plan' }, { id: 'build' }], nativeAgents: 'session-modes'
    })
    expect(fork.historySource).toBeUndefined()
    expect(fork.setup?.install).toBeUndefined()
    const module = providerModule('opencode-fork')!
    expect(module.definition).toEqual(fork)
    expect(module.explainFailure).toBe(providerModule('opencode')!.explainFailure)
    expect(module.gatewayConfig).toBeDefined()
    expect(module.update).toBeUndefined()
    expect(module.installation).toBeUndefined()
  })

  it('keeps the base engine arguments unless the derived Agent replaces them', () => {
    const fork = catalog({ providers: { 'devin-two': { extends: 'devin', args: { mode: 'replace', values: ['acp', '--beta'] } } } })
      .get('devin-two')!
    expect(fork.launch?.args).toEqual(['acp', '--beta'])
    expect(fork.displayName).toBe('devin-two')
  })

  it('drops user Agents that cannot run or would shadow a builtin', () => {
    const list = catalog({ providers: {
      'codex-two': { extends: 'codex' },
      'claude-two': { extends: 'claude-code' },
      'kun-two': { extends: 'kun' },
      'nobody': { extends: 'missing-engine' },
      'orphan': { command: '/opt/orphan' },
      'no-command': { extends: 'acp' },
      opencode: { extends: 'acp', command: 'evil' }
    } }).list()
    for (const id of ['codex-two', 'claude-two', 'kun-two', 'nobody', 'orphan', 'no-command']) {
      expect(list.some((definition) => definition.id === id)).toBe(false)
    }
    expect(list.find((definition) => definition.id === 'opencode')?.launch?.command).toBe('opencode')
    expect(providerModule('codex-two')).toBeUndefined()
  })

  it('still lists legacy custom and terminal Agents, engine-backed ones first', () => {
    const list = new HarnessCatalog({
      custom: () => [{ id: 'zz-acp', displayName: 'ZZ', command: 'zz', args: [], env: {} }],
      terminalAgents: () => [{ id: 'aa-tty', displayName: 'AA', command: 'aa', args: [] }]
    }).list().filter((definition) => !definition.builtin)
    expect(list.map((definition) => [definition.id, definition.transport])).toEqual([['zz-acp', 'acp'], ['aa-tty', 'terminal']])
  })
})
