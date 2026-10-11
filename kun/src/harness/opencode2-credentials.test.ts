import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openCode2CredentialEvidence, openCode2DatabasePath } from './opencode2-credentials.js'
import { HarnessCatalog } from './harness-catalog.js'
import { HarnessReadinessService } from './harness-readiness.js'

const fixtures: Array<{ root: string; db: DatabaseSync }> = []
afterEach(() => { for (const { root, db } of fixtures.splice(0)) { db.close(); rmSync(root, { recursive: true, force: true }) } })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kun-opencode2-credentials-'))
  const env = { XDG_DATA_HOME: root }
  const path = openCode2DatabasePath(env)
  mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, active INTEGER, value TEXT); CREATE TABLE session_fixture (id TEXT)')
  fixtures.push({ root, db })
  const insert = (value: unknown, active: number | null = 1) => db.prepare('INSERT OR REPLACE INTO credential VALUES (?, ?, ?, ?)')
    .run('credential-fixture', 'openai', active, JSON.stringify(value))
  return { root, env, path, db, insert }
}

describe('OpenCode2 native credential evidence', () => {
  it('reads configured credentials through live WAL without modifying the database', () => {
    const f = fixture(); f.insert({ type: 'key', key: 'fixture-secret' })
    const before = readFileSync(f.path)
    const proof = openCode2CredentialEvidence(f.env)
    expect(proof.configured).toBe(true)
    expect(proof.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(proof)).not.toContain('fixture-secret')
    expect(readFileSync(f.path)).toEqual(before)
    f.db.prepare('INSERT INTO session_fixture VALUES (?)').run('unrelated-session')
    expect(openCode2CredentialEvidence(f.env)).toEqual(proof)
    f.insert({ type: 'key', key: 'rotated-fixture-secret' })
    expect(openCode2CredentialEvidence(f.env).fingerprint).not.toBe(proof.fingerprint)
  })
  it('accepts complete OAuth and legacy unflagged credentials without claiming authentication', () => {
    const f = fixture(); f.insert({ type: 'oauth', access: 'fixture', refresh: 'refresh', expires: 0 }, null)
    expect(openCode2CredentialEvidence(f.env).configured).toBe(true)
  })
  it('rejects inactive, malformed and missing credentials without borrowing V1 auth.json', () => {
    const f = fixture()
    for (const value of [{}, { type: 'key', key: '' }, { type: 'oauth', access: 'fixture' }]) {
      f.insert(value); expect(openCode2CredentialEvidence(f.env).configured).toBe(false)
    }
    f.insert({ type: 'key', key: 'fixture' }, 0)
    expect(openCode2CredentialEvidence(f.env).configured).toBe(false)
    expect(openCode2CredentialEvidence({ XDG_DATA_HOME: join(f.root, 'missing') }).configured).toBe(false)
    expect(openCode2CredentialEvidence({ OPENCODE_DB: ':memory:' }).configured).toBe(false)
    f.db.exec('DROP TABLE credential')
    expect(openCode2CredentialEvidence(f.env).configured).toBe(false)
  })
  it('honors explicit DB paths and refuses symlink credentials', () => {
    const f = fixture(); f.insert({ type: 'key', key: 'fixture' })
    expect(openCode2CredentialEvidence({ OPENCODE_DB: f.path }).configured).toBe(true)
    const link = join(f.root, 'linked.db'); symlinkSync(f.path, link)
    expect(openCode2CredentialEvidence({ OPENCODE_DB: link }).configured).toBe(false)
    expect(openCode2DatabasePath({ XDG_DATA_HOME: f.root, OPENCODE_DB: 'alternate.db' })).toBe(join(f.root, 'opencode/alternate.db'))
  })
  it('invalidates exact-profile readiness after credential changes, but not unrelated session writes', async () => {
    const f = fixture(); f.insert({ type: 'key', key: 'fixture' })
    const profile = { harnessId: 'opencode2', credentialMode: 'native-login' as const }
    const definition = new HarnessCatalog().get('opencode2')!
    const scoped = { ...definition, launch: { ...definition.launch!, env: f.env } }
    const catalog = new HarnessCatalog({ custom: () => [], enabledProfiles: () => [profile] })
    catalog.get = () => scoped
    const readiness = new HarnessReadinessService({ options: () => ({}), catalog,
      detector: { status: async () => ({ harnessId: 'opencode2', installed: 'yes', login: 'unknown', checkedAt: new Date().toISOString() }) },
      handshake: async () => ({ ok: true, supported: true, protocol: 'acp' }) })
    expect(await readiness.test(scoped, { level: 'handshake', ...profile })).toMatchObject({ ok: true,
      readiness: { authentication: 'unverified', usable: true } })
    expect(await readiness.readyProfiles('opencode2')).toHaveLength(1)
    f.db.exec("INSERT INTO session_fixture VALUES ('session-change')")
    expect(await readiness.readyProfiles('opencode2')).toHaveLength(1)
    f.insert({ type: 'key', key: 'new-fixture' })
    expect(await readiness.readyProfiles('opencode2')).toEqual([])
  })
})
