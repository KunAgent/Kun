// Local details of custom assistants, keyed by enrollment id: the product name the user typed, its
// website, and the icon fetched from there. Presets need none of this; it never leaves the desktop.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type AssistantProfile = { product?: string; website?: string; icon?: string }
type ProfileFile = { version: 1; profiles: Record<string, AssistantProfile> }

export class AssistantProfileStore {
  private cache: Map<string, AssistantProfile> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly path: string) {}

  async all(): Promise<ReadonlyMap<string, AssistantProfile>> {
    if (this.cache) return this.cache
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as ProfileFile
      this.cache = new Map(Object.entries(parsed.version === 1 ? parsed.profiles : {}))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = new Map()
    }
    return this.cache
  }

  private mutate(change: (profiles: Map<string, AssistantProfile>) => boolean): Promise<void> {
    const work = async (): Promise<void> => {
      const profiles = new Map(await this.all())
      if (!change(profiles)) return
      const file: ProfileFile = { version: 1, profiles: Object.fromEntries(profiles) }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(file), { mode: 0o600 })
      await rename(temporary, this.path)
      this.cache = profiles
    }
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  update(enrollmentId: string, patch: AssistantProfile): Promise<void> {
    return this.mutate((profiles) => {
      profiles.set(enrollmentId, { ...profiles.get(enrollmentId), ...patch })
      return true
    })
  }

  /** Drops profiles of assistants and enrollments that no longer exist. */
  retain(keep: ReadonlySet<string>): Promise<void> {
    return this.mutate((profiles) => {
      let changed = false
      for (const id of [...profiles.keys()]) if (!keep.has(id)) { profiles.delete(id); changed = true }
      return changed
    })
  }
}
