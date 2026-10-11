import { spawnCaptured, type SpawnCaptured } from './harness-detector.js'
import { raceProbeAbort } from './probe-abort.js'

export type FxNativeCredentialEvidence = { configured: boolean | 'unknown'; authentication: 'unverified' | 'missing' }
export type FxNativeCredentialProbeOptions = {
  /** The caller supplies the already sanitized, profile-specific environment. */
  env: Record<string, string | undefined>
  signal?: AbortSignal
  spawnCaptured?: SpawnCaptured
}

const unknown = (): FxNativeCredentialEvidence => ({ configured: 'unknown', authentication: 'unverified' })

/**
 * Official prompt-free status metadata, including Vercel sessions in Keychain.
 * JSON.auth is a credential-source label, not verified authentication or quota.
 * https://fx.sh/docs/getting-started/authentication
 * https://github.com/vercel-labs/fx/blob/main/tests/e2e/oauth-keychain-migration.test.ts
 * https://github.com/vercel-labs/fx/blob/main/src/core/auth/auth_runtime.zig
 * https://github.com/vercel-labs/fx/blob/main/src/core/output/output_contracts.zig
 */
export async function probeFxNativeCredentials(
  command: string | undefined,
  options: FxNativeCredentialProbeOptions
): Promise<FxNativeCredentialEvidence> {
  options.signal?.throwIfAborted()
  if (!command?.trim()) return unknown()
  const result = await raceProbeAbort(Promise.resolve().then(() => {
    options.signal?.throwIfAborted()
    return (options.spawnCaptured ?? spawnCaptured)(command, ['status', '--json'], {
      timeoutMs: 10_000,
      signal: options.signal,
      // Preserve the caller's environment; never add process.env or disable Keychain.
      env: { ...options.env, FX_AUTO_UPGRADE: '0' }
    })
  }), options.signal).catch(() => undefined)
  options.signal?.throwIfAborted()
  if (!result || result.timedOut || result.exitCode !== 0 || Buffer.byteLength(result.stdout) > 64 * 1024) return unknown()
  try {
    const value: unknown = JSON.parse(result.stdout)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown()
    const details = value as Record<string, unknown>
    if (details.auth_expired !== undefined && typeof details.auth_expired !== 'boolean') return unknown()
    const auth = details.auth
    // The official status writer emits auth_expired only when it is true.
    // A refreshable expired session still cannot authorize an enable action.
    if (auth === 'fx login') return { configured: details.auth_expired !== true, authentication: 'unverified' }
    if (auth === 'missing') return { configured: false, authentication: 'missing' }
  } catch { /* Unsupported or malformed output is never evidence of logout. */ }
  // Do not return stdout, auth_help, account data, token values or CLI errors.
  return unknown()
}
