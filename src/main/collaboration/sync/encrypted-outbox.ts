import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'

const ScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('meeting'), meetingId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('task'), meetingId: z.string().min(1), taskId: z.string().min(1) }).strict()
])
export type OutboxScope = z.infer<typeof ScopeSchema>

const KeyVersionSchema = z.object({
  epoch: z.number().int().nonnegative().optional(),
  generation: z.number().int().nonnegative().optional()
}).strict().refine((value) => value.epoch !== undefined || value.generation !== undefined)
export type OutboxKeyVersion = z.infer<typeof KeyVersionSchema>

const OutboxEntrySchema = z.object({
  commandId: z.string().min(1),
  scope: ScopeSchema,
  keyVersion: KeyVersionSchema,
  ciphertext: z.string().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
}).strict()
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>

const OutboxStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(OutboxEntrySchema)
}).strict()

export type OutboxFrame = {
  commandId: string
  scope: OutboxScope
  ciphertext: string
  epoch?: number
  generation?: number
}

export type OutboxCryptoPort = {
  currentVersion(scope: OutboxScope): OutboxKeyVersion | Promise<OutboxKeyVersion>
  seal(plaintext: Buffer, version: OutboxKeyVersion, scope: OutboxScope): Promise<string>
  open(ciphertext: string, version: OutboxKeyVersion, scope: OutboxScope): Promise<Buffer>
  send(frame: OutboxFrame): Promise<{ accepted: boolean }>
}

export class EncryptedOutbox {
  private operation: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly crypto: OutboxCryptoPort
  ) {}

  enqueue(input: { commandId: string; scope: OutboxScope; plaintext: Buffer }): Promise<OutboxEntry> {
    return this.exclusive(async () => {
      const state = await this.load()
      const existing = state.entries.find((entry) => entry.commandId === input.commandId)
      if (existing) return existing
      const keyVersion = KeyVersionSchema.parse(await this.crypto.currentVersion(input.scope))
      const now = new Date().toISOString()
      const entry = OutboxEntrySchema.parse({
        commandId: input.commandId,
        scope: input.scope,
        keyVersion,
        ciphertext: await this.crypto.seal(input.plaintext, keyVersion, input.scope),
        createdAt: now,
        updatedAt: now
      })
      state.entries.push(entry)
      await this.save(state)
      return entry
    })
  }

  pending(): Promise<OutboxEntry[]> {
    return this.exclusive(async () => (await this.load()).entries.map((entry) => ({ ...entry })))
  }

  flush(): Promise<OutboxFrame[]> {
    return this.exclusive(async () => {
      const state = await this.load()
      const sent: OutboxFrame[] = []
      for (const entry of [...state.entries]) {
        const current = KeyVersionSchema.parse(await this.crypto.currentVersion(entry.scope))
        if (!sameVersion(entry.keyVersion, current)) {
          const plaintext = await this.crypto.open(entry.ciphertext, entry.keyVersion, entry.scope)
          entry.ciphertext = await this.crypto.seal(plaintext, current, entry.scope)
          entry.keyVersion = current
          entry.updatedAt = new Date().toISOString()
          await this.save(state)
        }
        const frame: OutboxFrame = {
          commandId: entry.commandId,
          scope: entry.scope,
          ciphertext: entry.ciphertext,
          ...entry.keyVersion
        }
        const receipt = await this.crypto.send(frame)
        if (!receipt.accepted) break
        state.entries = state.entries.filter((candidate) => candidate.commandId !== entry.commandId)
        await this.save(state)
        sent.push(frame)
      }
      return sent
    })
  }

  private async load(): Promise<z.infer<typeof OutboxStateSchema>> {
    const content = await readFile(this.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return content === null ? { version: 1, entries: [] } : OutboxStateSchema.parse(JSON.parse(content))
  }

  private save(state: z.infer<typeof OutboxStateSchema>): Promise<void> {
    return writePrivateFileAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`)
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}

function sameVersion(left: OutboxKeyVersion, right: OutboxKeyVersion): boolean {
  return left.epoch === right.epoch && left.generation === right.generation
}
