import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCanonicalKunRuntimeDataMigration } from './runtime-data-dir-migration'
import { auditPreservedHistory } from './runtime-data-dir-preserved-history-audit'
import * as inventory from './runtime-data-dir-migration-inventory'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function backup() {
  const root = await mkdtemp(join(tmpdir(), 'kun-history-audit-'))
  roots.push(root)
  const path = join(root, 'home', '.deepseekgui', 'kun')
  const payload = join(path, 'files', 'artifact')
  await mkdir(join(path, 'files'), { recursive: true })
  await writeFile(payload, Buffer.alloc(1_100_000, 1))
  return { root, path, payload }
}

describe('preserved Runtime backup audit', () => {
  it('matches the activation fingerprint including links, and detects a same-size edit', async () => {
    const { root, path, payload } = await backup()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(path, 'link'), 'junction')
    const snapshot = inventory.runtimeTreeFingerprint(path)
    const check = { path, inventory: snapshot.inventory, fingerprint: snapshot.fingerprint }
    const log = vi.fn()
    const signal = new AbortController().signal
    await writeFile(join(outside, 'later'), 'not part of the backup')
    await auditPreservedHistory(check, log, signal)
    expect(log).not.toHaveBeenCalled()
    await writeFile(payload, Buffer.alloc(1_100_000, 2))
    await auditPreservedHistory(check, log, signal)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('fingerprint changed'),
      expect.objectContaining({ recordedFingerprint: snapshot.fingerprint, currentFingerprint: inventory.runtimeTreeFingerprint(path).fingerprint }))
  })

  it('returns an inventory-only audit on a previously stopped profile and honors explicit deep verification', async () => {
    const { root, path, payload } = await backup()
    const options = { userDataPath: join(root, 'profile'), homeDir: join(root, 'home') }
    await mkdir(options.userDataPath)
    await writeFile(join(options.userDataPath, 'kun-settings.json'),
      JSON.stringify({ version: 1, agents: { kun: { dataDir: '~/.deepseekgui/kun' } } }))
    const migrated = runCanonicalKunRuntimeDataMigration(options)
    expect(migrated.status).toBe('completed')
    const journal = JSON.parse(await readFile(migrated.journalPath, 'utf8'))
    await writeFile(migrated.journalPath, JSON.stringify({
      ...journal, runtimeVerificationAttempts: 3, runtimeVerificationStoppedAt: new Date().toISOString()
    }))
    vi.stubEnv('KUN_VERIFY_PRESERVED_HISTORY', '0')
    const synchronousHash = vi.spyOn(inventory, 'runtimeTreeFingerprint')
    const synchronousInventory = vi.spyOn(inventory, 'runtimeStoreInventory')
    const check = runCanonicalKunRuntimeDataMigration(options).preservedHistoryCheck!
    expect(check).toEqual({ path, inventory: journal.sourceInventory })
    const log = vi.fn()
    const signal = new AbortController().signal
    await writeFile(payload, 'changed')
    await auditPreservedHistory(check, log, signal)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('inventory changed'), expect.anything())
    vi.stubEnv('KUN_VERIFY_PRESERVED_HISTORY', '1')
    expect(runCanonicalKunRuntimeDataMigration(options).preservedHistoryCheck?.fingerprint).toBe(journal.sourceFingerprint)
    expect(synchronousHash).not.toHaveBeenCalled()
    expect(synchronousInventory).not.toHaveBeenCalled()
  })

  it('honors quit without opening the archive', async () => {
    const check = { path: 'unused', inventory: { files: 0, directories: 0, symlinks: 0, bytes: 0 } }
    await expect(auditPreservedHistory(check, vi.fn(), AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
  })
})
