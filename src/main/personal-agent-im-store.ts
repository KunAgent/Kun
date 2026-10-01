import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { assertPersonalImSecretStorage, protectPersonalImSecret, unprotectPersonalImSecret } from './personal-agent-im-secrets'

export const PersonalImConnectionSchema = z.object({
  id: z.string(), roomId: z.string(), cardId: z.string(), agentId: z.string(), ownerId: z.string(),
  provider: z.enum(['feishu', 'weixin']), enabled: z.boolean(), pendingPairing: z.boolean().optional(),
  appId: z.string().optional(), appSecret: z.string().optional(), domain: z.string().optional(), accountId: z.string().optional(),
  delivery: z.object({ chatId: z.string(), cursor: z.number(),
    sentIds: z.array(z.string()).default([]), attentionIds: z.array(z.string()).default([]),
    uncertainIds: z.array(z.string()).default([]) }).optional()

}).strict()
export type PersonalImConnection = z.infer<typeof PersonalImConnectionSchema>
export interface PersonalImStore {
  assertAvailable(): Promise<void> | void
  load(): Promise<PersonalImConnection[]>
  save(value: PersonalImConnection[]): Promise<void>
}
export class ProtectedPersonalImStore implements PersonalImStore {
  constructor(private readonly path: string) {}
  assertAvailable(): Promise<void> { return assertPersonalImSecretStorage() }
  async load(): Promise<PersonalImConnection[]> {
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    return z.array(PersonalImConnectionSchema).parse(JSON.parse(await unprotectPersonalImSecret(raw)))
  }
  async save(value: PersonalImConnection[]): Promise<void> {
    const protectedValue = await protectPersonalImSecret(JSON.stringify(z.array(PersonalImConnectionSchema).parse(value)))
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, protectedValue, { mode: 0o600 })
    await rename(temporary, this.path)
  }
}
