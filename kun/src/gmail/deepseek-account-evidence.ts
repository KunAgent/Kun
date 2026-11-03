import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { AtomicJsonFile, assertManagerAtomicJsonPath } from '../extensions/atomic-json.js'
import { isEncryptedEnvelope, type SecretEncryptor } from '../security/secret-store.js'
import { GoogleWorkspaceModelPolicyError } from '../domain/google-workspace-model-policy.js'

const AAD = 'kun-gmail-deepseek-account-evidence:v1'
const Envelope = z.object({ schemaVersion: z.literal(1), __enc: z.string() }).strict()
const Evidence = z.object({
  schemaVersion: z.literal(1), evidenceId: z.string().uuid(), credentialSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  endpointOrigin: z.literal('https://api.deepseek.com'), protocol: z.literal('chat_completions'),
  verificationSource: z.literal('user-confirmed-unified-account-opt-out'), checkedAt: z.iso.datetime(),
  policyVersion: z.literal('open-platform:2026-04-22;terms:2025-09-05;privacy:2026-02-10'),
  policyUrls: z.tuple([z.literal('https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html'),
    z.literal('https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html'),
    z.literal('https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html')])
}).strict()
const proofSet = new WeakSet<object>()
export type DeepSeekAccountEvidenceProof = {
  readonly accountBinding: string
  assertCredentials(apiKey: string, headers?: Record<string, string>): void
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

/** Only the encrypted, host-owned operator record can mint this transport capability. */
export class DeepSeekAccountEvidenceStore {
  private readonly file: AtomicJsonFile<z.infer<typeof Envelope> | null>
  constructor(dataDir: string, private readonly encryptor: SecretEncryptor) {
    const path = join(dataDir, 'mcp-oauth', 'deepseek-account-evidence.json')
    assertManagerAtomicJsonPath(path)
    this.file = new AtomicJsonFile(path, (value) => {
      if (value === null) return null
      const envelope = Envelope.parse(value)
      if (!isEncryptedEnvelope(envelope.__enc)) throw new Error('Invalid account evidence envelope')
      return envelope
    }, false)
  }

  /** Called by the local operator installer, never by an HTTP/IPC endpoint or model tool. */
  async install(input: { apiKey: string; source: 'user-confirmed-unified-account-opt-out'; checkedAt: string }): Promise<{
    evidenceId: string; endpoint: string; checkedAt: string
  }> {
    const key = input.apiKey.trim()
    if (!key || input.source !== 'user-confirmed-unified-account-opt-out') throw new Error('Current DeepSeek account confirmation is required')
    const checkedAt = z.iso.datetime().parse(input.checkedAt)
    if (Date.parse(checkedAt) > Date.now() + 60_000) throw new Error('Account confirmation time is invalid')
    const evidence = Evidence.parse({ schemaVersion: 1, evidenceId: randomUUID(), credentialSha256: digest(key),
      endpointOrigin: 'https://api.deepseek.com', protocol: 'chat_completions', verificationSource: input.source, checkedAt,
      policyVersion: 'open-platform:2026-04-22;terms:2025-09-05;privacy:2026-02-10', policyUrls: [
        'https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html',
        'https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html',
        'https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html'] })
    await this.file.update(() => null, () => ({ schemaVersion: 1, __enc: this.encryptor.encrypt(JSON.stringify(evidence), AAD) }))
    return { evidenceId: evidence.evidenceId, endpoint: evidence.endpointOrigin, checkedAt }
  }

  async proof(apiKey: string): Promise<DeepSeekAccountEvidenceProof | undefined> {
    const envelope = await this.file.read(() => null)
    if (!envelope) return undefined
    const evidence = Evidence.parse(JSON.parse(this.encryptor.decrypt(envelope.__enc, AAD)))
    if (!apiKey.trim() || evidence.credentialSha256 !== digest(apiKey.trim())) return undefined
    const proof: DeepSeekAccountEvidenceProof = Object.freeze({ accountBinding: `deepseek-api:${evidence.evidenceId}`,
      assertCredentials(key: string, headers?: Record<string, string>) {
        if (evidence.credentialSha256 !== digest(key.trim())) {
          throw new GoogleWorkspaceModelPolicyError('DeepSeek API account evidence changed. Confirm this account’s training opt-out again.')
        }
        if (headers) {
          const final = new Headers(headers)
          if (final.get('authorization') !== `Bearer ${key}` || final.has('cookie') || final.has('x-api-key') || final.has('proxy-authorization')) {
            throw new GoogleWorkspaceModelPolicyError('Gmail requires the reviewed DeepSeek API account’s exact Bearer credential.')
          }
        }
      } })
    proofSet.add(proof)
    return proof
  }
}

export function assertDeepSeekEvidenceProof(value: DeepSeekAccountEvidenceProof | undefined): asserts value is DeepSeekAccountEvidenceProof {
  if (!value || !proofSet.has(value)) throw new GoogleWorkspaceModelPolicyError('DeepSeek API account training opt-out has not been reviewed in this Kun installation.')
}
