import { describe, expect, it } from 'vitest'
import { HarnessDefinitionSchema } from '../contracts/harness.js'
import { HARNESS_CAPABILITY_KEYS } from '../contracts/harness-capabilities.js'
import {
  HarnessCatalog,
  terminalAgentToDefinition
} from './harness-catalog.js'

describe('terminalAgents catalog entries (P4-13)', () => {
  it('parses into a valid HarnessDefinition with terminal launch details', () => {
    const def = HarnessDefinitionSchema.parse(
      terminalAgentToDefinition({
        id: 'zed-shell',
        displayName: 'Zed Shell',
        command: '/bin/zsh-agent',
        args: ['--tty'],
        taskFlag: '-i',
        resumeArgs: ['--resume'],
        hooks: 'claude-settings'
      })
    )
    expect(def.transport).toBe('terminal')
    expect(def.builtin).toBe(false)
    expect(def.detect?.command).toBe('/bin/zsh-agent')
    expect(def.terminal).toMatchObject({
      argv: ['--tty'],
      taskFlag: '-i',
      resumeArgs: ['--resume'],
      hooks: { kind: 'claude-settings' }
    })
    expect(def.terminal?.hooks?.events).toContain('Stop')
    // Terminal-only: every capability must read unsupported so admission and
    // harness_list never treat it as dispatchable.
    for (const key of HARNESS_CAPABILITY_KEYS) {
      expect(def.capabilities.statuses[key].supported).toBe(false)
    }
    expect(def.staticModels).toEqual([])
  })

  it('omits managed hooks when the entry opts out', () => {
    const none = HarnessDefinitionSchema.parse(
      terminalAgentToDefinition({
        id: 'plain-cli', displayName: 'Plain', command: '/bin/plain', args: [], hooks: 'none'
      })
    )
    expect(none.terminal?.hooks).toBeUndefined()
    const absent = HarnessDefinitionSchema.parse(
      terminalAgentToDefinition({
        id: 'bare-cli', displayName: 'Bare', command: '/bin/bare', args: []
      })
    )
    expect(absent.terminal?.hooks).toBeUndefined()
  })

  it('list() merges terminal agents and drops id collisions', () => {
    const catalog = new HarnessCatalog({
      custom: () => [
        { id: 'my-acp', displayName: 'Mine', command: '/bin/mine', args: [], env: {} }
      ],
      terminalAgents: () => [
        // Collides with the custom entry — custom wins.
        { id: 'my-acp', displayName: 'Shadow', command: '/bin/shadow', args: [] },
        // Collides with a builtin — dropped.
        { id: 'kun', displayName: 'Fake Kun', command: '/bin/nope', args: [] },
        {
          id: 'zed-shell', displayName: 'Zed Shell', command: '/bin/zsh-agent', args: []
        }
      ]
    })
    const ids = catalog.list().map((def) => def.id)
    expect(ids).toContain('my-acp')
    expect(ids).toContain('zed-shell')
    expect(ids.filter((id) => id === 'my-acp')).toHaveLength(1)
    expect(ids.filter((id) => id === 'kun')).toHaveLength(1)
    const mine = catalog.get('my-acp')!
    expect(mine.transport).toBe('acp')
    const zed = catalog.get('zed-shell')!
    expect(zed.transport).toBe('terminal')
    expect(catalog.get('kun')?.builtin).toBe(true)
  })
})

describe('transportOverrides (P6-07)', () => {
  it('swaps codex onto its codex-app-server variant', () => {
    const catalog = new HarnessCatalog({
      custom: () => [],
      transportOverrides: () => ({ codex: 'codex-app-server' })
    })
    const codex = catalog.get('codex')!
    expect(codex.transport).toBe('codex-app-server')
    expect(codex.launch?.command).toBe('codex')
    expect(codex.launch?.args).toEqual(['app-server'])
    expect(codex.detect?.command).toBe('codex')
    expect(codex.detect?.minVersion).toBe('0.145.0')
    expect(codex.capabilities.statuses.fork.supported).toBe(true)
  })

  it('keeps the default acp binding without an override', () => {
    const codex = new HarnessCatalog({ custom: () => [] }).get('codex')!
    expect(codex.transport).toBe('acp')
    expect(codex.launch?.command).toBe('codex-acp')
    expect(codex.detect?.adapterHint?.command).toBe('codex')
  })

  it('ignores unknown transports and unrelated ids', () => {
    const catalog = new HarnessCatalog({
      custom: () => [],
      transportOverrides: () => ({
        codex: 'terminal', // not a declared codex variant → unchanged
        unknownharness: 'codex-app-server'
      })
    })
    expect(catalog.get('codex')!.transport).toBe('acp')
    expect(catalog.get('unknownharness')).toBeUndefined()
  })
})
