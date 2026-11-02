import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { normalizeAppSettings } from '../shared/app-settings-normalize'
import { providersConfigForRuntime } from './runtime/kun-runtime-model-config'

const require = createRequire(import.meta.url)
const { buildSmokeSettings } = require('../../scripts/smoke-packaged-update-handoff-support.cjs')
const fixture = () => buildSmokeSettings({ dataDir: 'C:\\fixture\\data', port: 18899,
  runtimeToken: 'fixture-token', workspaceRoot: 'C:\\fixture\\workspace',
  baseUrl: 'http://127.0.0.1:45678', autoStart: true })

describe('released GUI upgrade model fixture configuration', () => {
  it('reproduces legacy-only credentials being ignored when a provider object already exists', () => {
    const previous = fixture()
    delete previous.provider.apiKey
    delete previous.provider.baseUrl
    const normalized = normalizeAppSettings(previous)
    expect(normalized.provider.providers[0].apiKey).toBe('')
    expect(normalized.provider.providers[0].baseUrl).not.toBe(previous.agents.kun.baseUrl)
  })

  it('preserves canonical fixture credentials and loopback route through real settings normalization', () => {
    const normalized = normalizeAppSettings(fixture())
    const provider = normalized.provider.providers.find(provider => provider.id === 'deepseek')!
    expect(provider.apiKey).toBe('packaged-handoff-smoke-key')
    expect(provider.baseUrl).toBe('http://127.0.0.1:45678')
    expect(provider.models).toContain('packaged-handoff-smoke-model')
    const runtimeProvider = providersConfigForRuntime(normalized).deepseek
    expect(runtimeProvider.baseUrl).toBe(provider.baseUrl)
    expect(runtimeProvider.credentialSourceId).toBeTruthy()
    expect(runtimeProvider.apiKey).toBe('') // The protected credential store owns the secret.
  })
})
