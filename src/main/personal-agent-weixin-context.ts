import { loadWeixinAccountData } from './weixin-bridge-storage'
import { protectPersonalImSecret, unprotectPersonalImSecret } from './personal-agent-im-secrets'

/** Reply context tokens are credentials too; new private-Agent accounts never write them in plaintext. */
export async function protectedWeixinContextRecord(accountId: string, tokens: Record<string, string>): Promise<unknown> {
  const account = await loadWeixinAccountData(accountId)
  return account?.protectedToken
    ? { schemaVersion: 1, protectedContextTokens: await protectPersonalImSecret(JSON.stringify(tokens)) }
    : tokens
}
export async function readProtectedWeixinContexts(value: unknown): Promise<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || typeof record.protectedContextTokens !== 'string') return record
  const decoded: unknown = JSON.parse(await unprotectPersonalImSecret(record.protectedContextTokens))
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Invalid protected WeChat context')
  return decoded as Record<string, unknown>
}
