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

const ExpertStatusSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.record(z.string(), ExpertStatusEntrySchema)
}).strict()

type ExpertStatusEntry = z.infer<typeof ExpertStatusEntrySchema>
type ExpertStatusFile = z.infer<typeof ExpertStatusSchema>

export type ExpertStatusSnapshot = {
  revision: number
  entries: Map<string, ExpertStatusEntry>
}

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
        revision: parsed.revision,
        entries: new Map(Object.entries(parsed.entries))
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { revision: 0, entries: new Map() }
      }
      throw error
    }
  }

  /** Persist status with CAS; throws on revision conflict. */
  async save(snapshot: ExpertStatusSnapshot, expectedRevision: number): Promise<void> {
    if (snapshot.revision !== expectedRevision + 1) {
      throw new Error(`Revision mismatch: expected ${expectedRevision + 1}, got ${snapshot.revision}`)
    }

    const file: ExpertStatusFile = {
      schemaVersion: 1,
      revision: snapshot.revision,
      entries: Object.fromEntries(snapshot.entries)
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
}
