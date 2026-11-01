import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { StorageTrashRestoreResult, StorageTrashRun, StorageTrashSummary } from '../../../shared/storage-cleanup'

/**
 * Cleanup trash: every file the cleaner removes is first moved under
 * `<root>/<runId>/files/<n>` with a manifest that remembers where it came
 * from. Runs expire after the configured number of days and are then deleted
 * for real. Restore only puts an entry back when nothing has taken its place.
 */

type TrashEntry = { original: string; stored: string; bytes: number }
type TrashManifest = { runId: string; createdAt: string; expiresAt: string; entries: TrashEntry[] }

const MANIFEST = 'manifest.json'

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep)
}

async function assertVacant(path: string): Promise<void> {
  try {
    await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw Object.assign(new Error('The original path is occupied; the entry was kept in the cleanup trash.'), { code: 'EEXIST' })
}

export class StorageTrash {
  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {}

  /** Start a run; `move` relocates one path into it, `commit` writes the manifest. */
  async begin(trashDays: number, shouldContinue: () => boolean = () => true): Promise<{
    runId: string
    move: (path: string, bytes: number) => Promise<boolean>
    commit: () => Promise<number>
  }> {
    const createdAt = this.now()
    const runId = `${createdAt.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const runDir = join(this.root, runId)
    const entries: TrashEntry[] = []
    const manifest = (): TrashManifest => ({
      runId,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + trashDays * 86_400_000).toISOString(),
      entries
    })
    return {
      runId,
      move: async (path, bytes) => {
        const source = resolve(path)
        if (isInside(source, this.root) || source === resolve(this.root)) return false
        const stored = join('files', String(entries.length))
        const target = join(runDir, stored)
        await mkdir(dirname(target), { recursive: true })
        if (!shouldContinue()) return false
        try {
          await rename(source, target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
          if (!shouldContinue()) return false
          await cp(source, target, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true })
          if (!shouldContinue()) {
            await rm(target, { recursive: true, force: true })
            return false
          }
          await rm(source, { recursive: true, force: true })
        }
        entries.push({ original: source, stored, bytes })
        // Persist after every move so a crash mid-run still leaves a restorable manifest.
        await writeFile(join(runDir, MANIFEST), JSON.stringify(manifest(), null, 2))
        return true
      },
      commit: async () => {
        if (entries.length === 0) {
          await rm(runDir, { recursive: true, force: true })
          return 0
        }
        await writeFile(join(runDir, MANIFEST), JSON.stringify(manifest(), null, 2))
        return entries.length
      }
    }
  }

  async summary(): Promise<StorageTrashSummary> {
    const runs = (await this.manifests()).map(({ manifest }): StorageTrashRun => ({
      runId: manifest.runId,
      createdAt: manifest.createdAt,
      expiresAt: manifest.expiresAt,
      entries: manifest.entries.length,
      bytes: manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0)
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return {
      runs,
      bytes: runs.reduce((sum, run) => sum + run.bytes, 0),
      entries: runs.reduce((sum, run) => sum + run.entries, 0)
    }
  }

  /** Move a run's entries back; entries whose original path is occupied stay in the trash. */
  async restore(runId: string): Promise<StorageTrashRestoreResult> {
    const found = (await this.manifests()).find((item) => item.manifest.runId === runId)
    if (!found) return { restored: 0, kept: 0, failures: [] }
    const remaining: TrashEntry[] = []
    const failures: StorageTrashRestoreResult['failures'] = []
    let restored = 0
    for (const entry of found.manifest.entries) {
      const source = join(found.dir, entry.stored)
      try {
        await assertVacant(entry.original)
        await mkdir(dirname(entry.original), { recursive: true })
        try {
          await rename(source, entry.original)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
          // Stage on the destination volume: a failed copy must not leave a partial original.
          const staging = await mkdtemp(join(dirname(entry.original), '.kun-storage-restore-'))
          try {
            const staged = join(staging, 'entry')
            await cp(source, staged, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true })
            await assertVacant(entry.original)
            await rename(staged, entry.original)
          } finally {
            await rm(staging, { recursive: true, force: true })
          }
          // Do not remove the only restorable copy until the complete destination is in place.
          await rm(source, { recursive: true, force: true })
        }
        restored += 1
      } catch (error) {
        remaining.push(entry)
        failures.push({
          path: entry.original,
          code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    if (remaining.length === 0) await rm(found.dir, { recursive: true, force: true })
    else await writeFile(join(found.dir, MANIFEST), JSON.stringify({ ...found.manifest, entries: remaining }, null, 2))
    return { restored, kept: remaining.length, failures }
  }

  async purgeExpired(): Promise<number> {
    const now = this.now().getTime()
    let removed = 0
    for (const { manifest, dir } of await this.manifests()) {
      if (Date.parse(manifest.expiresAt) > now) continue
      await rm(dir, { recursive: true, force: true })
      removed += 1
    }
    return removed
  }

  async empty(): Promise<void> {
    for (const { dir } of await this.manifests()) await rm(dir, { recursive: true, force: true })
  }

  private async manifests(): Promise<Array<{ dir: string; manifest: TrashManifest }>> {
    const names = await readdir(this.root).catch(() => [] as string[])
    const result: Array<{ dir: string; manifest: TrashManifest }> = []
    for (const name of names) {
      const dir = join(this.root, name)
      const raw = await readFile(join(dir, MANIFEST), 'utf8').catch(() => null)
      if (!raw) continue
      try {
        const manifest = JSON.parse(raw) as TrashManifest
        if (typeof manifest.runId === 'string' && Array.isArray(manifest.entries)) result.push({ dir, manifest })
      } catch {
        // A torn manifest is left alone; its files are still on disk for manual recovery.
      }
    }
    return result
  }
}
