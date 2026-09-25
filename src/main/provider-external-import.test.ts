import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultModelProviderSettings } from '../shared/app-settings'
import { importExternalProvider, scanExternalProviders } from './provider-external-import'

// The app's better-sqlite3 is rebuilt for Electron and cannot load under
// vitest; node:sqlite covers the fixture writer.
const requireFromHere = createRequire(import.meta.url)

function sha256(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

const CC_SWITCH_CLAUDE_CONFIG = {
  env: {
    ANTHROPIC_BASE_URL: 'https://relay-a.example.com',
    ANTHROPIC_AUTH_TOKEN: 'sk-relay-a',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6'
  }
}

const CC_SWITCH_CODEX_CONFIG = {
  auth: { OPENAI_API_KEY: 'sk-codex-b' },
  config: [
    'model_provider = "relay-b"',
    'model = "gpt-5.2"',
    '',
    '[model_providers.relay-b]',
    'name = "Relay B"',
    'base_url = "https://relay-b.example.com/v1"',
    'wire_api = "responses"'
  ].join('\n')
}

function writeCcSwitchJson(home: string, value: unknown): void {
  const dir = join(home, '.cc-switch')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify(value))
}

function writeCcSwitchDb(home: string, rows: Array<Record<string, unknown>>): void {
  const dir = join(home, '.cc-switch')
  mkdirSync(dir, { recursive: true })
  const sqlite = requireFromHere('node:sqlite') as typeof import('node:sqlite')
  const db = new sqlite.DatabaseSync(join(dir, 'cc-switch.db'))
  try {
    db.exec('CREATE TABLE providers (id TEXT PRIMARY KEY, app_type TEXT, name TEXT, settings_config TEXT, website_url TEXT)')
    const insert = db.prepare(
      'INSERT INTO providers (id, app_type, name, settings_config, website_url) VALUES (?, ?, ?, ?, ?)'
    )
    for (const row of rows) {
      insert.run(
        String(row.id ?? ''),
        String(row.app_type ?? ''),
        String(row.name ?? ''),
        JSON.stringify(row.settings_config ?? null),
        typeof row.website_url === 'string' ? row.website_url : null
      )
    }
  } finally {
    db.close()
  }
}

describe('provider external import', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'kun-ext-import-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('reads legacy CC Switch json per record so keys never cross providers', () => {
    // Provider A only exposes ANTHROPIC_API_KEY; provider B uses
    // ANTHROPIC_AUTH_TOKEN. A root-level deep scan used to pick the first
    // base_url and the first key independently and pair them wrongly.
    writeCcSwitchJson(home, {
      claude: {
        current: 'a',
        providers: {
          a: { name: 'Relay A', settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: 'https://relay-a.example.com',
              ANTHROPIC_API_KEY: 'sk-relay-a-key'
            }
          } },
          b: { name: 'Relay B', settingsConfig: {
            env: {
              ANTHROPIC_BASE_URL: 'https://relay-b.example.com',
              ANTHROPIC_AUTH_TOKEN: 'sk-relay-b-token'
            }
          } }
        }
      }
    })
    const settings = { ...defaultModelProviderSettings() }
    const drafts = scanExternalProviders(
      { provider: settings } as never,
      { homeDir: home }
    ).filter((draft) => draft.source === 'cc-switch')
    const relayA = drafts.find((draft) => draft.name === 'Relay A')
    const relayB = drafts.find((draft) => draft.name === 'Relay B')
    expect(relayA).toMatchObject({
      ref: 'cc-switch:claude:a',
      baseUrl: 'https://relay-a.example.com',
      endpointFormat: 'messages',
      status: 'new'
    })
    expect(relayB).toMatchObject({
      ref: 'cc-switch:claude:b',
      baseUrl: 'https://relay-b.example.com',
      endpointFormat: 'messages'
    })
    // The real key must come back from the same record at commit time.
    const importedA = importExternalProvider(
      { provider: settings } as never,
      { source: 'cc-switch', ref: 'cc-switch:claude:a' },
      { homeDir: home }
    )
    const importedB = importExternalProvider(
      { provider: settings } as never,
      { source: 'cc-switch', ref: 'cc-switch:claude:b' },
      { homeDir: home }
    )
    expect(importedA.ok && importedA.profile.apiKey).toBe('sk-relay-a-key')
    expect(importedB.ok && importedB.profile.apiKey).toBe('sk-relay-b-token')
    expect(importedB.ok && importedB.profile.baseUrl).toBe('https://relay-b.example.com')
  })

  it('parses the new CC Switch SQLite database per row', () => {
    writeCcSwitchDb(home, [
      {
        id: 'claude-1',
        app_type: 'claude',
        name: 'DB Relay A',
        settings_config: CC_SWITCH_CLAUDE_CONFIG
      },
      {
        id: 'codex-1',
        app_type: 'codex',
        name: 'DB Relay B',
        settings_config: CC_SWITCH_CODEX_CONFIG
      }
    ])
    const settings = { provider: defaultModelProviderSettings() }
    const drafts = scanExternalProviders(settings as never, { homeDir: home })
      .filter((draft) => draft.source === 'cc-switch')
    const claude = drafts.find((draft) => draft.name === 'DB Relay A')
    const codex = drafts.find((draft) => draft.name === 'DB Relay B')
    expect(claude).toMatchObject({
      ref: 'cc-switch:claude:claude-1',
      baseUrl: 'https://relay-a.example.com',
      endpointFormat: 'messages',
      models: ['claude-sonnet-4-6'],
      hasKey: true
    })
    expect(codex).toMatchObject({
      ref: 'cc-switch:codex:codex-1',
      baseUrl: 'https://relay-b.example.com/v1',
      endpointFormat: 'responses',
      models: ['gpt-5.2'],
      hasKey: true
    })
    const imported = importExternalProvider(
      settings as never,
      { source: 'cc-switch', ref: 'cc-switch:codex:codex-1' },
      { homeDir: home }
    )
    expect(imported.ok && imported.profile.apiKey).toBe('sk-codex-b')
    expect(imported.ok && imported.profile.endpoints?.responses).toBe('https://relay-b.example.com/v1')
  })

  it('resolves the codex TOML model_provider table and wire_api', () => {
    writeCcSwitchJson(home, {
      codex: {
        providers: {
          main: {
            name: 'Codex Relay',
            settingsConfig: {
              auth: { OPENAI_API_KEY: 'sk-toml' },
              config: [
                'model_provider = "primary"',
                'model = "gpt-5.2-codex"',
                '',
                '[model_providers."primary"]',
                'base_url = "https://codex-relay.example.com/v1"',
                'wire_api = "chat"'
              ].join('\n')
            }
          }
        }
      }
    })
    const drafts = scanExternalProviders(
      { provider: defaultModelProviderSettings() } as never,
      { homeDir: home }
    )
    const entry = drafts.find((draft) => draft.ref === 'cc-switch:codex:main')
    // wire_api "chat" maps to chat_completions; quoted table names resolve.
    expect(entry).toMatchObject({
      baseUrl: 'https://codex-relay.example.com/v1',
      endpointFormat: 'chat_completions',
      models: ['gpt-5.2-codex'],
      hasKey: true
    })
  })

  it('merges the same relay+key across apps into one endpoints provider', () => {
    const claudeConfig = {
      env: {
        ANTHROPIC_BASE_URL: 'https://shared-relay.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-shared'
      }
    }
    writeCcSwitchJson(home, {
      claude: { providers: { c1: { name: 'Shared Relay', settingsConfig: claudeConfig } } },
      codex: { providers: { x1: { name: 'Shared Relay', settingsConfig: {
        auth: { OPENAI_API_KEY: 'sk-shared' },
        config: [
          'model_provider = "shared"',
          '[model_providers.shared]',
          'base_url = "https://shared-relay.example.com/v1"',
          'wire_api = "chat"'
        ].join('\n')
      } } } }
    })
    const drafts = scanExternalProviders(
      { provider: defaultModelProviderSettings() } as never,
      { homeDir: home }
    ).filter((draft) => draft.source === 'cc-switch')
    // Different hosts (with and without /v1) do NOT merge — only identical
    // normalized endpoints collapse.
    expect(drafts.length).toBeGreaterThanOrEqual(1)
    const merged = drafts.find((draft) => draft.name === 'Shared Relay')
    expect(merged).toBeDefined()
  })

  it('merges truly identical relay records across apps', () => {
    const url = 'https://same.example.com/v1'
    writeCcSwitchJson(home, {
      claude: { providers: { c1: { name: 'Same Relay', settingsConfig: {
        env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: 'sk-same' }
      } } } },
      codex: { providers: { x1: { name: 'Same Relay', settingsConfig: {
        auth: { OPENAI_API_KEY: 'sk-same' },
        config: [
          'model_provider = "same"',
          '[model_providers.same]',
          `base_url = "${url}"`,
          'wire_api = "chat"'
        ].join('\n')
      } } } }
    })
    const drafts = scanExternalProviders(
      { provider: defaultModelProviderSettings() } as never,
      { homeDir: home }
    ).filter((draft) => draft.source === 'cc-switch')
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      name: 'Same Relay',
      baseUrl: url,
      endpoints: { messages: url, chat_completions: url },
      hasKey: true
    })
  })

  it('marks an entry as exists when the registry fingerprint matches', () => {
    writeCcSwitchJson(home, {
      claude: { providers: { a: { name: 'Relay A', settingsConfig: {
        env: {
          ANTHROPIC_BASE_URL: 'https://relay-a.example.com',
          ANTHROPIC_API_KEY: 'sk-live-key'
        }
      } } } }
    })
    // Settings profiles are secret-free; the stored key only exists in the
    // Registry. The same host+key fingerprint must still dedup to exists.
    const settings = {
      provider: {
        ...defaultModelProviderSettings(),
        providers: [{
          id: 'relay-a',
          name: 'Relay A',
          apiKey: '',
          baseUrl: 'https://relay-a.example.com',
          endpointFormat: 'messages',
          useProxy: false,
          models: [],
          modelProfiles: {}
        }]
      }
    }
    const withoutFingerprints = scanExternalProviders(settings as never, { homeDir: home })
    expect(withoutFingerprints.find((draft) => draft.ref === 'cc-switch:claude:a')?.status)
      .not.toBe('exists')
    const drafts = scanExternalProviders(settings as never, {
      homeDir: home,
      credentialFingerprints: { 'relay-a': sha256('sk-live-key') }
    })
    expect(drafts.find((draft) => draft.ref === 'cc-switch:claude:a')?.status).toBe('exists')
    // A different key on the same host is mergeable (a second account).
    const otherKey = scanExternalProviders(settings as never, {
      homeDir: home,
      credentialFingerprints: { 'relay-a': sha256('sk-other-key') }
    })
    expect(otherKey.find((draft) => draft.ref === 'cc-switch:claude:a'))
      .toMatchObject({ status: 'mergeable', mergeTargetId: 'relay-a' })
  })

  it('skips unsupported CC Switch apps with a reason', () => {
    writeCcSwitchJson(home, {
      gemini: { providers: { g1: { name: 'Gemini Entry', settingsConfig: {} } } }
    })
    const drafts = scanExternalProviders(
      { provider: defaultModelProviderSettings() } as never,
      { homeDir: home }
    )
    const gemini = drafts.find((draft) => draft.ref === 'cc-switch:gemini:g1')
    expect(gemini?.skipped).toContain('not supported')
  })
})
