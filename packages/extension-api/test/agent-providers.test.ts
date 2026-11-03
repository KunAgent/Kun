import { describe, expect, it } from 'vitest'
import { ExtensionManifestSchema, parseExtensionManifest } from '../src/index.js'

const manifest = {
  manifestVersion: 1,
  apiVersion: '1.5.0',
  name: 'fork-agent',
  publisher: 'acme',
  version: '1.0.0',
  engines: { kun: '^0.1.0' },
  main: 'dist/main.js',
  activationEvents: [],
  contributes: {
    agentProviders: [{ id: 'fork', displayName: 'Fork', extends: 'opencode', command: 'fork-cli', args: ['acp'] }]
  },
  permissions: ['agents.register'],
  stateSchemaVersion: 1
}

describe('agentProviders contribution', () => {
  it('declares a local ACP Agent behind the agents.register permission', () => {
    const parsed = parseExtensionManifest(manifest)
    expect(parsed.contributes.agentProviders[0]).toEqual({
      id: 'fork', displayName: 'Fork', extends: 'opencode', command: 'fork-cli', args: ['acp'], env: {}
    })
    expect(ExtensionManifestSchema.safeParse({ ...manifest, permissions: [] }).success).toBe(false)
  })

  it('rejects secrets-shaped env names, duplicate ids and browser-only declarations', () => {
    const agent = manifest.contributes.agentProviders[0]
    expect(ExtensionManifestSchema.safeParse({ ...manifest,
      contributes: { agentProviders: [{ ...agent, env: { lower: '1' } }] } }).success).toBe(false)
    expect(ExtensionManifestSchema.safeParse({ ...manifest,
      contributes: { agentProviders: [agent, agent] } }).success).toBe(false)
    const { main: _main, ...browserOnly } = manifest
    expect(ExtensionManifestSchema.safeParse({ ...browserOnly, browser: 'dist/index.html' }).success).toBe(false)
  })
})
