import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnCaptured, type SpawnCaptured } from './harness-detector.js'

type Evidence = { configured: boolean; fingerprint: string }
const evidence = (configured: boolean, value: string): Evidence => ({ configured,
  fingerprint: createHash('sha256').update(value).digest('hex') })

function stableKeychainAttributes(stdout: string): string {
  // `agy` refreshes its hourly OAuth access_token in place via `security add-generic-password -U`,
  // which rewrites `"mdat"<timedate>` while keeping `"cdat"<timedate>` and item attributes intact.
  return stdout
    .split(/\r?\n/)
    .filter((line) => !/^\s*"mdat"<timedate>=/.test(line))
    .join('\n')
}

/** Native agy storage, distinct from Gemini CLI OAuth. Presence is not authentication. */
export async function antigravityCredentialEvidence(env: NodeJS.ProcessEnv = process.env, deps: {
  platform?: NodeJS.Platform; home?: string; spawn?: SpawnCaptured; signal?: AbortSignal
} = {}): Promise<Evidence> {
  const home = env.HOME || env.USERPROFILE || homedir()
  const tokenPath = join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token')
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(tokenPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stat = await file.stat()
    if (stat.isFile() && stat.size <= 65536) {
      const buffer = Buffer.alloc(65537)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const content = bytesRead <= 65536 ? buffer.subarray(0, bytesRead).toString('utf8') : ''
      const value: unknown = JSON.parse(content)
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        const nested = record.token && typeof record.token === 'object'
          ? (record.token as Record<string, unknown>)
          : undefined
        const refreshToken = typeof record.refresh_token === 'string'
          ? record.refresh_token.trim()
          : typeof record.refreshToken === 'string'
            ? record.refreshToken.trim()
            : typeof nested?.refresh_token === 'string'
              ? nested.refresh_token.trim()
              : typeof nested?.refreshToken === 'string'
                ? nested.refreshToken.trim()
                : ''
        // Hash the durable refresh token rather than volatile hourly access_token/expiry fields.
        if (refreshToken) return evidence(true, refreshToken)
      }
    }
  } catch { /* Native keyring profiles do not have a token file. */ }
  finally { await file?.close() }
  // Never read an OS account's keyring while checking a different HOME profile.
  if ((deps.platform ?? process.platform) !== 'darwin' || resolve(home) !== resolve(deps.home ?? homedir())) return evidence(false, '')
  // agy uses the gemini service and antigravity account (not Gemini CLI's
  // OAuth record). Query attributes only: deliberately omit -w and -g so the
  // credential is never returned, copied, logged, or decrypted by Kun.
  const result = await (deps.spawn ?? spawnCaptured)('/usr/bin/security', [
    'find-generic-password', '-s', 'gemini', '-a', 'antigravity'
  ], { timeoutMs: 3000, signal: deps.signal, env }).catch(() => undefined)
  deps.signal?.throwIfAborted()
  if (!result || result.timedOut || result.exitCode !== 0 ||
    !result.stdout.includes('"svce"<blob>="gemini"') || !result.stdout.includes('"acct"<blob>="antigravity"')) return evidence(false, '')
  // Keep Keychain creation/item metadata while ignoring volatile mdat updates
  // from hourly OAuth access_token refreshes. Only the opaque digest leaves this helper.
  return evidence(true, stableKeychainAttributes(result.stdout))
}
