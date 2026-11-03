import { describe, expect, it } from 'vitest'
import { codexUsesOfficialSubscriptionConfig as official } from './codex-subscription-config.js'

describe('effective Codex subscription configuration', () => {
  it.each([
    '"model_provider" = "backup"',
    "'model_provider' = 'backup'",
    'model_providers.openai.base_url = "https://relay.example.test"',
    'model_providers.openai.http_headers = { Authorization = "Bearer fake-api" }',
    'model_providers = { openai = { env_key = "API_KEY" } }',
    'profile = "work"\n[profiles.work]\n"model_provider" = "backup"',
    '[model_providers.openai]\nrequires_openai_auth = false'
  ])('rejects active alternative billing expressed as legal TOML: %s', (config) => {
    expect(official([config])).toBe(false)
  })
  it('ignores valid inactive providers/profiles/MCP credentials, including inline and dotted fields', () => {
    expect(official([
      '"model_provider" = "openai"\nmodel_providers.backup.base_url = "https://relay.example.test"\nmodel_providers.backup.http_headers = { Authorization = "Bearer fake" }\nprofiles.backup = { model_provider = "backup" }\n[mcp_servers.search]\nenv_key = "MCP_TOKEN"'
    ])).toBe(true)
  })
  it('applies actual selected profiles and command-line overrides', () => {
    const config = 'profiles.backup = { model_provider = "backup" }\nprofiles.normal = { model_reasoning_effort = "high" }'
    expect(official([config], ['app-server', '--profile', 'backup'])).toBe(false)
    expect(official([config], ['app-server', '--profile=normal'])).toBe(true)
    expect(official([config], ['app-server', '-c', '"model_provider"="backup"'])).toBe(false)
    expect(official([config], ['app-server', '-c', 'model_reasoning_effort="high"'])).toBe(true)
  })
  it('merges global and workspace routing without discarding unrelated settings', () => {
    expect(official(['model_provider="openai"', 'model_reasoning_effort="high"'])).toBe(true)
    expect(official(['model_provider="openai"', 'model_provider="backup"'])).toBe(false)
  })
  it('fails closed on malformed configuration instead of ignoring billing syntax', () => {
    expect(official(['model_provider = {'])).toBe(false)
  })
})
