/**
 * Shared spawn-environment hygiene for delegated harness child processes.
 *
 * A harness process must never inherit credentials that would outrank the
 * credential mode Kun selected for the route (native login token, gateway
 * proxy, or injected provider key). The denylist is matched case-insensitively
 * because Windows environment keys are case-insensitive; an alternate-cased
 * key must not bypass the boundary on any platform.
 */

/**
 * Credentials and credential-adjacent configuration a harness child must not
 * inherit from the host environment:
 * - Anthropic auth overrides that outrank the Claude subscription OAuth token
 *   (ANTHROPIC_API_KEY > ANTHROPIC_AUTH_TOKEN > apiKeyHelper > OAuth token).
 * - Main/Kun-only browser bridge credentials that belong to the host process.
 */
export const HARNESS_CREDENTIAL_ENV_DENYLIST: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  // `kun serve` accepts the host model credential via this env var; a harness
  // child must reach the model through its own credential mode instead.
  'DEEPSEEK_API_KEY',
  'KUN_BROWSER_USE_BRIDGE_URL',
  'KUN_BROWSER_USE_BRIDGE_TOKEN',
  'KUN_BROWSER_USE_APPROVAL_SIGNING_KEY'
]

/**
 * Build a child environment: copy `base`, remove the shared denylist plus any
 * caller-supplied `strip` keys, then apply `add` entries last so deliberate
 * credential injection always wins over stripping.
 *
 * The result must be byte-stable for a given (harnessId, credentialIdentity):
 * callers must not fold random values or timestamps into `add`, or the ACP
 * connection pool would see a changed configuration and respawn uselessly.
 */
export function buildHarnessEnv(input: {
  base: Record<string, string | undefined>
  strip?: readonly string[]
  add?: Record<string, string | undefined>
}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...input.base }
  const denied = new Set<string>()
  for (const key of HARNESS_CREDENTIAL_ENV_DENYLIST) denied.add(key.toUpperCase())
  for (const key of input.strip ?? []) denied.add(key.toUpperCase())
  for (const key of Object.keys(env)) {
    if (denied.has(key.toUpperCase())) delete env[key]
  }
  for (const [key, value] of Object.entries(input.add ?? {})) {
    if (value === undefined) continue
    env[key] = value
  }
  return env
}
