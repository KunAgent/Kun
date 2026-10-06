import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite'
import {
  additionalNativeCredentialEnv,
  additionalNativeCredentialFiles,
  additionalNativeCredentialsConfigured
} from './additional-native-agent-credentials.js'

const require = createRequire(import.meta.url)
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
async function fixture(id: string) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-additional-native-')); dirs.push(dir)
  const env = { HOME: dir, USERPROFILE: dir, XDG_CONFIG_HOME: join(dir, '.config'), XDG_DATA_HOME: join(dir, '.local/share') }
  const files = additionalNativeCredentialFiles(id, env)
  for (const path of files) await mkdir(dirname(path), { recursive: true })
  return { dir, env, files }
}
const oauth = { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: 1 }
const session = { version: 1, access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at_ms: 1, account_id: 'account-id' }

describe('additional native credential evidence', () => {
  it('keeps unknown profiles, unrelated keys and Cursor config directories unconfigured', async () => {
    const f = await fixture('cursor-cli')
    await mkdir(join(f.dir, '.cursor'), { recursive: true })
    await writeFile(join(f.dir, '.cursor/cli-config.json'), JSON.stringify({ user: 'person', model: 'model' }))
    const env = { ...f.env, OPENAI_API_KEY: 'unrelated' }
    expect(additionalNativeCredentialsConfigured('cursor-cli', env)).toBe(false)
    expect(additionalNativeCredentialsConfigured('unknown', env)).toBe(false)
    expect(additionalNativeCredentialFiles('cursor-cli', env)).toEqual([])
    expect(additionalNativeCredentialEnv('unknown', env)).toEqual({})
    expect(additionalNativeCredentialEnv('cursor-cli', { ...env, CURSOR_API_KEY: 'cursor-key' })).toEqual({ CURSOR_API_KEY: 'cursor-key' })
    expect(additionalNativeCredentialsConfigured('cursor-cli', { ...env, CURSOR_AUTH_TOKEN: 'cursor-token' })).toBe(true)
  })

  it('recognizes only complete MiMo native auth records', async () => {
    const f = await fixture('mimocode')
    for (const entry of [oauth, { type: 'api', key: 'fixture-key' }, { type: 'wellknown', key: 'CUSTOM_API_KEY', token: 'fixture-token' }]) {
      await writeFile(f.files[0]!, JSON.stringify({ provider: entry }))
      expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(true)
    }
    for (const entry of [{ type: 'oauth', access: 'access' }, { type: 'api', key: '' },
      { type: 'api', key: 'mimocode-oauth-dummy-key' }, { type: 'api_key', key: 'wrong-dialect' }, { model: 'model' }]) {
      await writeFile(f.files[0]!, JSON.stringify({ provider: entry }))
      expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(false)
    }
  })

  it('uses MiMo home and credential injection without borrowing a shadowed native file', async () => {
    const f = await fixture('mimocode')
    const env = { ...f.env, MIMOCODE_HOME: join(f.dir, 'mimo-home') }
    expect(additionalNativeCredentialFiles('mimocode', env)[0]).toBe(join(env.MIMOCODE_HOME, 'data/auth.json'))
    expect(additionalNativeCredentialFiles('mimocode', { ...env, MIMOCODE_HOME: '../workspace' })).toEqual([])
    await writeFile(f.files[0]!, JSON.stringify({ provider: oauth }))
    expect(additionalNativeCredentialsConfigured('mimocode', { ...f.env, MIMOCODE_AUTH_CONTENT: '{}' })).toBe(false)
    expect(additionalNativeCredentialsConfigured('mimocode', { ...f.env, MIMOCODE_AUTH_CONTENT: ' '.repeat(65 * 1024) })).toBe(false)
  })

  it('includes real MiMo JSONC key references while preserving commas inside strings', async () => {
    const f = await fixture('mimocode')
    await writeFile(f.files[2]!, '{ // provider\n "provider": { "custom": { "options": { "apiKey": "{env:MY_MIMO_KEY}", }, }, }, }')
    expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(false)
    const env = { ...f.env, MY_MIMO_KEY: 'first-key', UNRELATED_API_KEY: 'unrelated' }
    expect(additionalNativeCredentialsConfigured('mimocode', env)).toBe(true)
    expect(additionalNativeCredentialEnv('mimocode', env)).toMatchObject({ MY_MIMO_KEY: 'first-key' })
    expect(additionalNativeCredentialEnv('mimocode', { ...env, MY_MIMO_KEY: 'rotated' })).not.toEqual(additionalNativeCredentialEnv('mimocode', env))
    expect(additionalNativeCredentialEnv('mimocode', env)).not.toHaveProperty('UNRELATED_API_KEY')
    await writeFile(f.files[2]!, '{ "provider": { "custom": { "options": { "apiKey": "literal, } token" } } } }')
    expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(true)
    await writeFile(f.files[2]!, '{ "provider": { "custom": { "options": { "apiKey": "key" } } } } /* unterminated')
    expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(false)
  })

  it('honors the selected fx provider and remembered credential source', async () => {
    const f = await fixture('fx')
    const env = { ...f.env, AI_GATEWAY_API_KEY: 'gateway-key' }
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(true)
    await writeFile(f.files[0]!, JSON.stringify({ provider: 'codex' }))
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(false)
    await writeFile(f.files[2]!, JSON.stringify(session))
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(true)
    await writeFile(f.files[0]!, JSON.stringify({ provider: 'gateway', credential_source: 'fx_login' }))
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(false)
    await writeFile(f.files[1]!, JSON.stringify({ ...session, issuer: 'https://vercel.com', client_id: 'client', scope: 'openid', token_type: 'Bearer' }))
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(true)
    await writeFile(f.files[1]!, JSON.stringify({ ...session, issuer: 'https://unrelated.example', client_id: 'client', scope: 'openid', token_type: 'Bearer' }))
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(false)
  })

  it('requires the explicit fx bearer variable and rejects ordinary settings as auth', async () => {
    const f = await fixture('fx')
    await writeFile(f.files[0]!, JSON.stringify({ provider: 'custom', providers: { custom: { auth: { type: 'bearer', env: 'MY_FX_KEY' } } } }))
    expect(additionalNativeCredentialsConfigured('fx', { ...f.env, AI_GATEWAY_API_KEY: 'wrong-provider' })).toBe(false)
    const env = { ...f.env, MY_FX_KEY: 'custom-key' }
    expect(additionalNativeCredentialsConfigured('fx', env)).toBe(true)
    expect(additionalNativeCredentialEnv('fx', env)).toMatchObject({ MY_FX_KEY: 'custom-key' })
    await writeFile(f.files[0]!, JSON.stringify({ model: 'model', configured: true }))
    expect(additionalNativeCredentialsConfigured('fx', f.env)).toBe(false)
    await writeFile(f.files[4]!, 'saved-key')
    expect(additionalNativeCredentialsConfigured('fx', f.env)).toBe(true)
  })

  it('resolves omp profile stores and config references, never executing key commands', async () => {
    const f = await fixture('omp')
    const env = { ...f.env, OMP_PROFILE: 'work', PI_PROFILE: 'other', PI_CODING_AGENT_DIR: join(f.dir, 'ignored') }
    expect(additionalNativeCredentialFiles('omp', env)[0]).toBe(join(f.dir, '.omp/profiles/work/agent/agent.db'))
    expect(additionalNativeCredentialFiles('omp', { ...env, OMP_PROFILE: '../workspace' })).toEqual([])
    const reset = { ...f.env, OMP_PROFILE: '', PI_PROFILE: 'work' }
    expect(additionalNativeCredentialFiles('omp', reset)[0]).toBe(join(f.dir, '.omp/agent/agent.db'))
    expect(additionalNativeCredentialEnv('omp', reset)).toMatchObject({ OMP_PROFILE: '', PI_PROFILE: 'work' })
    await writeFile(f.files[3]!, 'providers:\n  custom:\n    apiKey: MY_OMP_KEY\n')
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
    const keyEnv = { ...f.env, MY_OMP_KEY: 'configured-key' }
    expect(additionalNativeCredentialsConfigured('omp', keyEnv)).toBe(true)
    expect(additionalNativeCredentialEnv('omp', keyEnv)).toMatchObject({ MY_OMP_KEY: 'configured-key' })
    await writeFile(f.files[3]!, 'providers:\n  custom:\n    apiKey: "!print-a-secret"\n')
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
  })

  it('accepts complete legacy omp records only when a modern database does not supersede them', async () => {
    const f = await fixture('omp')
    await writeFile(f.files[2]!, JSON.stringify({ provider: [oauth, { type: 'api_key', key: 'fixture-key' }] }))
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(true)
    await writeFile(f.files[0]!, 'not a valid SQLite store')
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
    expect(additionalNativeCredentialFiles('omp', f.env)).toContain(`${f.files[0]}-wal`)
  })

  it('reads complete Hermes OAuth/pool records and its native dotenv model keys', async () => {
    const f = await fixture('hermes')
    await writeFile(f.files[0]!, 'DEEPSEEK_API_KEY="dotenv-key"\nTAVILY_API_KEY=tool-only-key\n')
    expect(additionalNativeCredentialsConfigured('hermes', f.env)).toBe(true)
    await writeFile(f.files[0]!, 'TAVILY_API_KEY=tool-only-key\n')
    expect(additionalNativeCredentialsConfigured('hermes', f.env)).toBe(false)
    await writeFile(f.files[1]!, JSON.stringify({ version: 1, providers: { 'xai-oauth': { tokens: { access_token: 'access', refresh_token: 'refresh' } } } }))
    expect(additionalNativeCredentialsConfigured('hermes', f.env)).toBe(true)
    await writeFile(f.files[1]!, JSON.stringify({ version: 1, credential_pool: { 'openai-api': [{ auth_type: 'api_key', access_token: 'pool-key' }] } }))
    expect(additionalNativeCredentialsConfigured('hermes', f.env)).toBe(true)
    await writeFile(f.files[1]!, JSON.stringify({ version: 1, providers: { spotify: { tokens: { access_token: 'tool-access', refresh_token: 'tool-refresh' } } } }))
    expect(additionalNativeCredentialsConfigured('hermes', f.env)).toBe(false)
    await writeFile(f.files[1]!, JSON.stringify({ version: 1, providers: { openai: { account: 'person' } } }))
    expect(additionalNativeCredentialsConfigured('hermes', f.env)).toBe(false)
  })

  it('includes Hermes key pointers and dotenv expansion inputs in the credential identity', async () => {
    const f = await fixture('hermes')
    await writeFile(f.files[2]!, 'model:\n  provider: custom\n  key_env: MY_HERMES_KEY\n')
    await writeFile(f.files[0]!, 'MY_HERMES_KEY=${HERMES_KEY_SOURCE}\n')
    const env = { ...f.env, HERMES_KEY_SOURCE: 'first-key', UNRELATED_TOKEN: 'unrelated' }
    expect(additionalNativeCredentialsConfigured('hermes', env)).toBe(true)
    expect(additionalNativeCredentialEnv('hermes', env)).toMatchObject({ HERMES_KEY_SOURCE: 'first-key' })
    expect(additionalNativeCredentialEnv('hermes', { ...env, HERMES_KEY_SOURCE: 'second-key' })).not.toEqual(additionalNativeCredentialEnv('hermes', env))
    expect(additionalNativeCredentialEnv('hermes', env)).not.toHaveProperty('UNRELATED_TOKEN')
  })

  it('uses actual Grok scoped records and explicitly named per-model key variables', async () => {
    const f = await fixture('grok')
    expect(additionalNativeCredentialsConfigured('grok', { ...f.env, GROK_API_KEY: 'undocumented' })).toBe(false)
    const entry = { key: 'token', auth_mode: 'oidc', user_id: 'user', create_time: '2026-10-06T00:00:00Z', refresh_token: 'refresh' }
    await writeFile(f.files[0]!, JSON.stringify({ 'https://auth.x.ai': entry }))
    expect(additionalNativeCredentialsConfigured('grok', f.env)).toBe(true)
    await writeFile(f.files[0]!, JSON.stringify({ 'https://auth.x.ai': { ...entry, auth_mode: 'web_login' } }))
    expect(additionalNativeCredentialsConfigured('grok', f.env)).toBe(false)
    await writeFile(f.files[1]!, '[model."custom/model"]\nenv_key = "MY_GROK_KEY"\n')
    const env = { ...f.env, MY_GROK_KEY: 'configured-key' }
    expect(additionalNativeCredentialsConfigured('grok', env)).toBe(true)
    expect(additionalNativeCredentialEnv('grok', env)).toMatchObject({ MY_GROK_KEY: 'configured-key' })
  })

  it('rejects linked, malformed and oversized native credential files', async () => {
    const f = await fixture('mimocode')
    const target = join(f.dir, 'actual-auth.json')
    await writeFile(target, JSON.stringify({ provider: oauth }))
    await symlink(target, f.files[0]!)
    expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(false)
    await rm(f.files[0]!)
    await writeFile(f.files[0]!, JSON.stringify({ provider: oauth, padding: 'x'.repeat(65 * 1024) }))
    expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(false)
    await writeFile(f.files[0]!, '{ malformed')
    expect(additionalNativeCredentialsConfigured('mimocode', f.env)).toBe(false)
  })

  it('inspects enabled modern omp SQLite rows without changing the store', async (context) => {
    let Database: new (path: string) => SqliteDatabase
    try { Database = require('node:sqlite').DatabaseSync; const probe = new Database(':memory:'); probe.close() }
    catch { context.skip(); return }
    const f = await fixture('omp')
    const db = new Database(f.files[0]!)
    db.exec('CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)')
    const insert = db.prepare('INSERT INTO auth_credentials VALUES (?, ?, ?, ?, ?)')
    insert.run(1, 'provider', 'oauth', JSON.stringify({ access: 'access', refresh: 'refresh', expires: 1 }), null)
    db.close()
    const before = await readFile(f.files[0]!)
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(true)
    expect(await readFile(f.files[0]!)).toEqual(before)
    const mutate = new Database(f.files[0]!)
    mutate.prepare('UPDATE auth_credentials SET disabled_cause = ?').run('logged_out')
    mutate.close()
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
  })

  it('reads stopped and live WAL stores without creating coordination files', async (context) => {
    let Database: new (path: string) => SqliteDatabase
    try { Database = require('node:sqlite').DatabaseSync; const probe = new Database(':memory:'); probe.close() }
    catch { context.skip(); return }
    const f = await fixture('omp')
    let writer = new Database(f.files[0]!)
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)')
    writer.prepare('INSERT INTO auth_credentials VALUES (1, ?, ?, ?, NULL)').run('openai', 'api_key', JSON.stringify({ key: 'key' }))
    writer.close()
    const before = await readdir(dirname(f.files[0]!))
    expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(true)
    expect(await readdir(dirname(f.files[0]!))).toEqual(before)
    writer = new Database(f.files[0]!)
    try {
      writer.prepare('UPDATE auth_credentials SET data = ?').run(JSON.stringify({ key: 'rotated' }))
      expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(true)
      writer.prepare('UPDATE auth_credentials SET disabled_cause = ?').run('logged_out')
      expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
    } finally { writer.close() }
  })

  it('bounds SQLite rows and JSON size and excludes MCP-only token records', async (context) => {
    let Database: new (path: string) => SqliteDatabase
    try { Database = require('node:sqlite').DatabaseSync; const probe = new Database(':memory:'); probe.close() }
    catch { context.skip(); return }
    const f = await fixture('omp')
    const writer = new Database(f.files[0]!)
    try {
      writer.exec('CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT)')
      const insert = writer.prepare('INSERT INTO auth_credentials VALUES (?, ?, ?, ?, NULL)')
      insert.run(1, 'mcp_oauth:tool', 'oauth', JSON.stringify({ access: 'access', refresh: 'refresh', expires: 1 }))
      expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
      insert.run(2, 'openai', 'api_key', JSON.stringify({ key: 'key', padding: 'x'.repeat(65 * 1024) }))
      expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
      for (let id = 3; id < 66; id++) insert.run(id, 'openai', 'api_key', '{}')
      insert.run(66, 'openai', 'api_key', JSON.stringify({ key: 'outside-budget' }))
      expect(additionalNativeCredentialsConfigured('omp', f.env)).toBe(false)
    } finally { writer.close() }
  })
})
