import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

/**
 * Expert status persistence — stores enabled/disabled state across restarts.
 *
 * Schema: { schemaVersion: 1, revision: number, entries: { [expertId]: { enabled: boolean, updatedAt: string } } }
 * Atomic write: temp + fsync + rename, with expectedRevision CAS.
 */

const ExpertStatusEntrySchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.string()
}).strict()

const ExpertStatusV1Schema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.record(z.string(), ExpertStatusEntrySchema)
}).strict()

const ExpertStatusV2Schema = z.object({
  schemaVersion: z.literal(2),
  revision: z.number().int().nonnegative(),
  entries: z.record(z.string(), ExpertStatusEntrySchema),
  activeExpertIds: z.array(z.string().min(1)).max(5),
  activeTeamIds: z.array(z.string().min(1)).max(5)
}).strict()

const ExpertStatusSchema = z.union([ExpertStatusV1Schema, ExpertStatusV2Schema])

type ExpertStatusEntry = z.infer<typeof ExpertStatusEntrySchema>
type ExpertStatusFile = z.infer<typeof ExpertStatusSchema>

export type ExpertStatusSnapshot = {
  schemaVersion: 1 | 2
  revision: number
  entries: Map<string, ExpertStatusEntry>
  activeExpertIds: string[]
  activeTeamIds: string[]
  legacyEnabledIds: string[]
}

type ExpertStatusSaveSnapshot = Pick<ExpertStatusSnapshot, 'revision' | 'entries'> &
  Partial<Pick<ExpertStatusSnapshot, 'activeExpertIds' | 'activeTeamIds'>>

export type ExpertActivationKind = 'expert' | 'team'

const MAX_ACTIVE_PER_KIND = 5

export class ExpertStatusStore {
  private readonly statusFilePath: string

  constructor(private readonly dataDir: string) {
    this.statusFilePath = join(dataDir, 'experts', 'status.json')
  }

  /** Load status from disk; returns revision 0 with empty entries if file missing. */
  async load(): Promise<ExpertStatusSnapshot> {
    try {
      const text = await readFile(this.statusFilePath, 'utf8')
      const parsed = ExpertStatusSchema.parse(JSON.parse(text))
      return {
        schemaVersion: parsed.schemaVersion,
        revision: parsed.revision,
        entries: new Map(Object.entries(parsed.entries)),
        activeExpertIds: parsed.schemaVersion === 2 ? [...parsed.activeExpertIds] : [],
        activeTeamIds: parsed.schemaVersion === 2 ? [...parsed.activeTeamIds] : [],
        legacyEnabledIds: parsed.schemaVersion === 1
          ? Object.entries(parsed.entries)
            .filter(([, entry]) => entry.enabled)
            .sort(([idA, entryA], [idB, entryB]) =>
              entryA.updatedAt.localeCompare(entryB.updatedAt) || idA.localeCompare(idB)
            )
            .map(([id]) => id)
          : []
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return {
          schemaVersion: 2,
          revision: 0,
          entries: new Map(),
          activeExpertIds: [],
          activeTeamIds: [],
          legacyEnabledIds: []
        }
      }
      throw error
    }
  }

  /** Persist status with CAS; throws on revision conflict. */
  async save(snapshot: ExpertStatusSaveSnapshot, expectedRevision: number): Promise<void> {
    if (snapshot.revision !== expectedRevision + 1) {
      throw new Error(`Revision mismatch: expected ${expectedRevision + 1}, got ${snapshot.revision}`)
    }

    const file: ExpertStatusFile = {
      schemaVersion: 2,
      revision: snapshot.revision,
      entries: Object.fromEntries(snapshot.entries),
      activeExpertIds: uniqueQueue(snapshot.activeExpertIds ?? []),
      activeTeamIds: uniqueQueue(snapshot.activeTeamIds ?? [])
    }

    await mkdir(join(this.dataDir, 'experts'), { recursive: true })
    const tempPath = join(
      this.dataDir,
      'experts',
      `.status.tmp.${randomBytes(4).toString('hex')}`
    )

    await writeFile(tempPath, JSON.stringify(file, null, 2), 'utf8')
    try {
      await rename(tempPath, this.statusFilePath)
    } catch (err) {
      try {
        await unlink(tempPath)
      } catch {
        // ignore cleanup failure
      }
      throw err
    }
  }

  async activate(kind: ExpertActivationKind, id: string): Promise<ExpertStatusSnapshot> {
    return this.updateActivation(kind, id, true)
  }

  async deactivate(kind: ExpertActivationKind, id: string): Promise<ExpertStatusSnapshot> {
    return this.updateActivation(kind, id, false)
  }

  async remove(id: string): Promise<ExpertStatusSnapshot> {
    const snapshot = await this.load()
    snapshot.entries.delete(id)
    const next = {
      ...snapshot,
      schemaVersion: 2 as const,
      revision: snapshot.revision + 1,
      activeExpertIds: snapshot.activeExpertIds.filter((value) => value !== id),
      activeTeamIds: snapshot.activeTeamIds.filter((value) => value !== id),
      legacyEnabledIds: []
    }
    await this.save(next, snapshot.revision)
    return next
  }

  private async updateActivation(
    kind: ExpertActivationKind,
    id: string,
    active: boolean
  ): Promise<ExpertStatusSnapshot> {
    const snapshot = await this.load()
    const queueKey = kind === 'expert' ? 'activeExpertIds' : 'activeTeamIds'
    const queue = active
      ? activateInQueue(snapshot[queueKey], id)
      : snapshot[queueKey].filter((value) => value !== id)
    const next: ExpertStatusSnapshot = {
      ...snapshot,
      schemaVersion: 2,
      revision: snapshot.revision + 1,
      [queueKey]: queue,
      legacyEnabledIds: []
    }
    await this.save(next, snapshot.revision)
    return next
  }
}

function activateInQueue(queue: readonly string[], id: string): string[] {
  return [...queue.filter((value) => value !== id), id].slice(-MAX_ACTIVE_PER_KIND)
}

function uniqueQueue(queue: readonly string[]): string[] {
  const unique = queue.filter((value, index) => queue.indexOf(value) === index)
  return unique.slice(-MAX_ACTIVE_PER_KIND)
}
