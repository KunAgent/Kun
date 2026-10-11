import { describe, expect, it } from 'vitest'
import { codexConfig, opencodeConfig, piModelsConfig } from './gateway-config-templates.js'

describe('isolated client configuration credential references', () => {
  it('uses Pi bare environment lookup, rather than unsupported shell interpolation', () => {
    const document = JSON.parse(piModelsConfig('http://127.0.0.1:18899/v1', 'route/coding', 'KUN_GATEWAY_TOKEN'))
    expect(document.providers.kun.apiKey).toBe('KUN_GATEWAY_TOKEN')
    const environment = { KUN_GATEWAY_TOKEN: 'fixture-only-value' }
    // Pi 0.73.1 resolveConfigValue: process.env[config] || config.
    const key = environment[document.providers.kun.apiKey as keyof typeof environment] || document.providers.kun.apiKey
    expect(key).toBe('fixture-only-value')
    expect(JSON.stringify(document)).not.toContain('fixture-only-value')
  })
  it('keeps official-client references specific to their configuration grammar', () => {
    expect(codexConfig('http://127.0.0.1:18899/v1', 'route/coding', 'KUN_GATEWAY_TOKEN'))
      .toContain('env_key = "KUN_GATEWAY_TOKEN"')
    expect(JSON.parse(opencodeConfig('http://127.0.0.1:18899/v1', 'route/coding', 'KUN_GATEWAY_TOKEN'))
      .provider.kun.options.apiKey).toBe('{env:KUN_GATEWAY_TOKEN}')
  })
})
