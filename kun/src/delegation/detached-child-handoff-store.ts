import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { applyPosixMode } from '../security/posix-permissions.js'

export const DetachedChildHandoffSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(256),
  childId: z.string().min(1),
  childUpdatedAt: z.string().min(1),
  parentThreadId: z.string().min(1),
  parentTurnId: z.string().min(1),
  notice: z.string().min(1),
  displayText: z.string().min(1),
  clientRequestId: z.string().min(1).max(256),
  createdAt: z.string().min(1),
  attempts: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().optional(),
  lastError: z.string().max(1_024).optional()
}).strict()
export type DetachedChildHandoff = z.infer<typeof DetachedChildHandoffSchema>

export class DetachedChildHandoffStore {
  private readonly root: string

  constructor(childRunsRoot: string) {
    this.root = join(childRunsRoot, 'handoffs')
  }

  async prepare(handoff: DetachedChildHandoff): Promise<DetachedChildHandoff> {
    const parsed = DetachedChildHandoffSchema.parse(handoff)
    const existing = await this.get(parsed.id)
    if (existing) return existing
    await this.ensureRoot()
    await withManagerDataMutex(`detached-child-handoff:${parsed.id}`, async () => {
      const current = await this.get(parsed.id)
      if (current) return
      await atomicWriteFile(this.path(parsed.id), `${JSON.stringify(parsed, null, 2)}\n`, {
        durable: true,
        allowDirectWriteFallback: false
      })
    })
    return (await this.get(parsed.id)) ?? parsed
  }

  async markAttempt(id: string, error: string, now: string): Promise<void> {
    await withManagerDataMutex(`detached-child-handoff:${id}`, async () => {
      const current = await this.get(id)
      if (!current) return
      const next = DetachedChildHandoffSchema.parse({
        ...current,
        attempts: current.attempts + 1,
        lastAttemptAt: now,
        lastError: error.slice(0, 1_024)
      })
      await atomicWriteFile(this.path(id), `${JSON.stringify(next, null, 2)}\n`, {
        durable: true,
        allowDirectWriteFallback: false
      })
    })
  }

  async ack(id: string): Promise<void> {
    await withManagerDataMutex(`detached-child-handoff:${id}`, () =>
      rm(this.path(id), { force: true }))
  }

  async get(id: string): Promise<DetachedChildHandoff | undefined> {
    try {
      return DetachedChildHandoffSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8')))
    } catch (error) {
      if (isMissingFileError(error)) return undefined
      throw error
    }
  }

  async list(): Promise<DetachedChildHandoff[]> {
    await this.ensureRoot()
    const names = await readdir(this.root)
    const values = await Promise.all(names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readFile(join(this.root, name), 'utf8')
        .then((text) => DetachedChildHandoffSchema.parse(JSON.parse(text)))
        .catch(() => undefined)))
    return values
      .filter((value): value is DetachedChildHandoff => Boolean(value))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async cleanupParent(parentThreadId: string): Promise<void> {
    const handoffs = await this.list()
    await Promise.all(handoffs
      .filter((handoff) => handoff.parentThreadId === parentThreadId)
      .map((handoff) => this.ack(handoff.id)))
  }

  private path(id: string): string {
    return join(this.root, `${Buffer.from(id, 'utf8').toString('base64url')}.json`)
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await applyPosixMode(this.root, 0o700)
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
