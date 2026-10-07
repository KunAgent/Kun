import { afterEach, describe, expect, it } from 'vitest'
import { parseExtensionManifest } from '@kun/extension-api'
import { HarnessIdSchema } from '../contracts/harness.js'
import { loadExtensionAgentProviders } from '../server/extension-agent-provider-loader.js'
import { HarnessCatalog } from './harness-catalog.js'
import {
  ExtensionAgentProviderSource,
  extensionAgentHarnessId,
  extensionAgentProvider
} from './extension-agent-providers.js'
import { providerModule, setDerivedProviderModules } from './providers/registry.js'

afterEach(() => setDerivedProviderModules([]))

const manifest = (agentProviders: unknown[], permissions = ['agents.register']) => parseExtensionManifest({
  manifestVersion: 1, apiVersion: '1.5.0', name: 'fork-agent', publisher: 'acme', version: '1.0.0', displayName: 'Fork Pack',
  engines: { kun: '^0.1.0' }, main: 'dist/main.js', activationEvents: [],
  contributes: { agentProviders }, permissions, stateSchemaVersion: 1
})

describe('extension Agent providers', () => {
  it('derives stable harness ids within the id rule', () => {
    expect(extensionAgentHarnessId('acme.fork-agent', 'fork')).toBe('ext-acme-fork-agent-fork')
    const long = extensionAgentHarnessId('a-very-long-publisher-name.an-even-longer-extension-name', 'agent-id')
    expect(long.length).toBeLessThanOrEqual(48)
    expect(HarnessIdSchema.safeParse(long).success).toBe(true)
    expect(long).not.toBe(extensionAgentHarnessId('a-very-long-publisher-name.an-even-longer-extension-name', 'other-id'))
  })

  it('maps declarations to provider overrides', () => {
    const [derived, generic] = manifest([
      { id: 'fork', displayName: 'Fork', extends: 'opencode', command: 'fork-cli' },
      { id: 'plain', displayName: 'Plain', command: '/opt/plain', args: ['--acp'], env: { PLAIN_MODE: 'x' } }
    ]).contributes.agentProviders
    expect(extensionAgentProvider({ id: 'acme.fork-agent', name: 'Fork Pack' }, derived!).override)
      .toEqual({ extends: 'opencode', label: 'Fork', command: 'fork-cli' })
    expect(extensionAgentProvider({ id: 'acme.fork-agent' }, generic!).override).toEqual({
      extends: 'acp', label: 'Plain', command: '/opt/plain', args: { mode: 'replace', values: ['--acp'] }, env: { PLAIN_MODE: 'x' }
    })
  })

  it('loads only enabled, admitted extensions that hold agents.register', async () => {
    const declared = manifest([{ id: 'fork', displayName: 'Fork', extends: 'opencode', command: 'fork-cli' }])
    const entry = (id: string, extra: Record<string, unknown>) => ({ id, globallyEnabled: true, useDevelopment: false,
      selectedVersion: '1.0.0', versions: { '1.0.0': { manifest: declared, grantedPermissions: ['agents.register'] } }, ...extra })
    const registry = { read: async () => ({ extensions: {
      'acme.fork-agent': entry('acme.fork-agent', {}),
      'acme.disabled': entry('acme.disabled', { globallyEnabled: false }),
      'acme.ungranted': entry('acme.ungranted', { versions: { '1.0.0': { manifest: declared, grantedPermissions: [] } } }),
      'acme.incompatible': entry('acme.incompatible', {})
    } }) } as never
    const packageManager = { admitManifest: (value: unknown) => {
      if (value === declared && admitCalls++ === 1) throw new Error('incompatible')
      return {} as never
    } }
    let admitCalls = 0
    const loaded = await loadExtensionAgentProviders({ registry, packageManager })
    expect(loaded.map((agent) => [agent.extensionId, agent.harnessId])).toEqual([['acme.fork-agent', 'ext-acme-fork-agent-fork']])
  })

  it('lists extension Agents after settings Agents and keeps the last good list', async () => {
    const source = new ExtensionAgentProviderSource()
    const declaration = manifest([{ id: 'fork', displayName: 'Fork', extends: 'opencode', command: 'fork-cli' }]).contributes.agentProviders[0]!
    let fail = false
    source.setLoader(async () => {
      if (fail) throw new Error('registry unreadable')
      return [extensionAgentProvider({ id: 'acme.fork-agent', name: 'Fork Pack' }, declaration)]
    })
    await source.refresh()
    fail = true
    await source.refresh()
    const catalog = new HarnessCatalog({ extensionAgents: () => source.list() })
    const fork = catalog.get('ext-acme-fork-agent-fork')!
    expect(fork).toMatchObject({ displayName: 'Fork', derivedFrom: 'opencode', builtin: false,
      extension: { id: 'acme.fork-agent', name: 'Fork Pack' }, launch: { command: 'fork-cli', args: ['acp'] } })
    expect(providerModule('ext-acme-fork-agent-fork')?.update).toBeUndefined()
    const shadowed = new HarnessCatalog({ extensionAgents: () => source.list(),
      providers: () => ({ 'ext-acme-fork-agent-fork': { extends: 'acp', label: 'Mine', command: '/bin/mine' } }) })
    expect(shadowed.get('ext-acme-fork-agent-fork')).toMatchObject({ displayName: 'Mine' })
    expect(shadowed.get('ext-acme-fork-agent-fork')?.extension).toBeUndefined()
  })
})
