/**
 * `secretEnv` resolution for custom ACP harnesses (docs/ade/impl/p4 §3.7,
 * P4-12): config stores only `{ name, secretRef }` pairs; the credential
 * store value is read at spawn/probe time and injected into the child env.
 * Secret values are never logged, echoed in responses, or persisted in
 * settings — this module only ever returns them into an in-memory env map.
 */
import type { HarnessDefinition } from '../contracts/harness.js'
import type { ExtensionCredentialStore } from '../services/extension-credential-store.js'

/** Resolves an opaque credential-store reference to its secret value. */
export type HarnessSecretRefResolver = (
  secretRef: string
) => Promise<string | null>

/**
 * Build a resolver over the extension credential store. Harness secrets are
 * stored as `{ apiKey: value }` payloads; `accessToken`/`clientSecret` are
 * accepted as fallbacks so OAuth-sourced credentials can serve as refs too.
 */
export function harnessSecretRefResolver(
  store: Pick<ExtensionCredentialStore, 'get'> | undefined
): HarnessSecretRefResolver | undefined {
  if (!store) return undefined
  return async (secretRef) => {
    const payload = await store.get(secretRef).catch(() => null)
    if (!payload) return null
    return (
      payload.apiKey ??
      payload.accessToken ??
      payload.clientSecret ??
      payload.refreshToken ??
      null
    )
  }
}

/**
 * Resolve a definition's `launch.secretEnv` into a plain env map for spawn.
 * Throws with the env names (never refs or values) when a configured secret
 * cannot be resolved — a missing secret must fail the launch, not silently
 * spawn an agent that cannot authenticate.
 */
export async function resolveHarnessSecretEnv(
  definition: HarnessDefinition,
  resolve: HarnessSecretRefResolver | undefined
): Promise<Record<string, string>> {
  const entries = definition.launch?.secretEnv ?? []
  if (entries.length === 0) return {}
  if (!resolve) {
    throw new Error(
      `harness ${definition.id} has secretEnv entries but no credential store is available`
    )
  }
  const env: Record<string, string> = {}
  const missing: string[] = []
  for (const entry of entries) {
    const value = await resolve(entry.secretRef)
    if (value === null || value === '') missing.push(entry.name)
    else env[entry.name] = value
  }
  if (missing.length > 0) {
    throw new Error(
      `harness ${definition.id} secretEnv could not be resolved: ${missing.join(', ')}`
    )
  }
  return env
}
