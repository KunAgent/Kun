import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { isEncryptedEnvelope, type SecretEncryptor } from '../security/secret-store.js'
import { GitHubScopeSchema, GITHUB_SHARING_POLICY } from '../contracts/github-app.js'

export const GitHubTokensSchema = z.object({
  accessToken: z.string().min(1).max(16384), refreshToken: z.string().min(1).max(16384),
  expiresAt: z.number().finite(), refreshExpiresAt: z.number().finite(),
  userId: z.number().int().positive(), login: z.string().min(1).max(100), clientId: z.string().min(1)
}).strict()
export type GitHubTokens = z.infer<typeof GitHubTokensSchema>
const StateSchema = z.object({
  schemaVersion: z.literal(1), tokens: GitHubTokensSchema.optional(), reconnectRequired: z.boolean(),
  grants: z.array(z.object({ scopeId: GitHubScopeSchema, policy: z.literal(GITHUB_SHARING_POLICY) }).strict()).max(4096)
}).strict()
export type GitHubState = z.infer<typeof StateSchema>
const empty = (): GitHubState => ({ schemaVersion: 1, reconnectRequired: false, grants: [] })
const EnvelopeSchema = z.object({ schemaVersion: z.literal(1), __enc: z.string().refine(isEncryptedEnvelope) }).strict()
const AAD = 'kun-github-app:v1'

/** All physical writes go through the application-owned Service Manager. */
export class GitHubAppStore {
  private readonly file: AtomicJsonFile<z.infer<typeof EnvelopeSchema> | null>
  constructor(dataDir: string, private readonly encryptor: SecretEncryptor) {
    const path = join(dataDir, 'mcp-oauth', 'native-github-app.json')
    assertManagerAtomicJsonPath(path)
    this.file = new AtomicJsonFile(path, (value) => value === null ? null : EnvelopeSchema.parse(value), false)
  }
  private decode(value: z.infer<typeof EnvelopeSchema> | null): GitHubState {
    try { return value ? StateSchema.parse(JSON.parse(this.encryptor.decrypt(value.__enc, AAD))) : empty() }
    catch { throw new Error('GitHub credentials could not be opened with the local encryption key') }
  }
  async read(): Promise<GitHubState> { return this.decode(await this.file.read(() => null)) }
  async update(mutate: (state: GitHubState) => GitHubState): Promise<GitHubState> {
    return this.decode(await this.file.update(() => null, (value) => ({ schemaVersion: 1,
      __enc: this.encryptor.encrypt(JSON.stringify(StateSchema.parse(mutate(this.decode(value)))), AAD) })))
  }
}
