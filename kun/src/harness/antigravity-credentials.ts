import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnCaptured, type SpawnCaptured } from './harness-detector.js'

type Evidence = { configured: boolean; fingerprint: string }
const evidence = (configured: boolean, value: string): Evidence => ({ configured,
  fingerprint: createHash('sha256').update(value).digest('hex') })

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
      if (value && typeof value === 'object' && 'refresh_token' in value &&
        typeof value.refresh_token === 'string' && value.refresh_token.trim()) return evidence(true, content)
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
  // Includes Keychain creation/modification metadata, so removal/replacement
  // invalidates admission. Only the opaque digest leaves this helper.
  return evidence(true, result.stdout)
}
