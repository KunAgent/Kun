import { join } from 'node:path'
import { z } from 'zod'
import { assertManagerAtomicJsonPath, AtomicJsonFile } from '../extensions/atomic-json.js'
import type { SecretEncryptor } from '../security/secret-store.js'
import { isEncryptedEnvelope } from '../security/secret-store.js'
import { GmailScopeIdSchema } from '../contracts/gmail.js'

const TokenSchema = z.object({
  accessToken: z.string().min(1).max(16_384),
  refreshToken: z.string().min(1).max(16_384).optional(),
  expiresAt: z.number().finite(),
  scopes: z.array(z.string().max(256)).max(16),
  email: z.string().min(1).max(254)
}).strict()
const GrantSchema = z.object({
  scopeId: GmailScopeIdSchema,
  allowModelSharing: z.boolean(),
  grantedAt: z.number().finite()
}).strict()
const AttemptSchema = z.object({
  operationId: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  scopeId: GmailScopeIdSchema,
  status: z.enum(['attempted', 'sent', 'failed', 'unknown']),
  attemptedAt: z.number().finite(),
  result: z.object({ id: z.string().max(128), threadId: z.string().max(128).optional(), status: z.literal('sent') }).optional()
}).strict()
export const CredentialsStateSchema = z.object({
  schemaVersion: z.literal(1),
  tokens: TokenSchema.optional(),
  reconnectRequired: z.boolean(),
  grants: z.array(GrantSchema).max(256),
  sensitiveScopes: z.array(GmailScopeIdSchema).max(4_096).default([]),
  attempts: z.array(AttemptSchema).max(64)
}).strict()
export type CredentialsState = z.infer<typeof CredentialsStateSchema>
export type GmailTokens = z.infer<typeof TokenSchema>
export const emptyCredentials = (): CredentialsState => ({
  schemaVersion: 1, reconnectRequired: false, grants: [], sensitiveScopes: [], attempts: []
})

const AAD = 'kun-native-google-gmail:v1'
const EnvelopeSchema = z.object({ schemaVersion: z.literal(1), __enc: z.string() }).strict()
type Envelope = z.infer<typeof EnvelopeSchema>

/** Manager-aware atomic persistence; plaintext OAuth state is never accepted. */
export class EncryptedGmailStore {
  readonly path: string
  private readonly file: AtomicJsonFile<Envelope | null>

  constructor(dataDir: string, private readonly encryptor: SecretEncryptor) {
    if (!encryptor) throw new Error('Gmail requires encrypted credential storage')
    this.path = join(dataDir, 'mcp-oauth', 'native-google-gmail.json')
    assertManagerAtomicJsonPath(this.path)
    this.file = new AtomicJsonFile(this.path, (value) => {
      if (value === null) return null
      const parsed = EnvelopeSchema.parse(value)
      if (!isEncryptedEnvelope(parsed.__enc)) throw new Error('Gmail credential envelope is invalid')
      return parsed
    }, false)
  }

  async read(): Promise<CredentialsState> {
    const value = await this.file.read(() => null)
    return value ? this.decode(value) : emptyCredentials()
  }

  async update(mutate: (state: CredentialsState) => CredentialsState): Promise<CredentialsState> {
    const written = await this.file.update(() => null, (stored) => {
      const next = CredentialsStateSchema.parse(mutate(stored ? this.decode(stored) : emptyCredentials()))
      return { schemaVersion: 1, __enc: this.encryptor.encrypt(JSON.stringify(next), AAD) }
    })
    return written ? this.decode(written) : emptyCredentials()
  }

  private decode(value: Envelope): CredentialsState {
    try {
      const state = CredentialsStateSchema.parse(JSON.parse(this.encryptor.decrypt(value.__enc, AAD)))
      // Early connector builds stored consent without classification; preserve its history on migration.
      return CredentialsStateSchema.parse({ ...state, sensitiveScopes: [...new Set([
        ...state.sensitiveScopes, ...state.grants.filter((grant) => grant.allowModelSharing).map((grant) => grant.scopeId)
      ])] })
    } catch {
      throw new Error('Gmail credentials could not be decrypted; restore the original key or reconnect Gmail')
    }
  }
}
