/**
 * Renderer-facing helpers for "does this provider already have usable
 * credentials?" without reading plaintext secrets.
 *
 * Canonical connections expose only `configured` / `credentialStatus`;
 * `settings:get` redacts `provider.apiKey` to an empty string. UI surfaces that
 * previously checked `apiKey.trim()` alone mis-report OAuth subscriptions
 * (e.g. grok-subscription) as missing a key.
 */

export type SharedConnectionCredentialState = {
  id: string
  configured: boolean
  credentialStatus?: 'ready' | 'missing' | 'unreadable' | 'not-required'
}

export function sharedModelConnectionHasUsableCredential(
  connection: Pick<SharedConnectionCredentialState, 'configured' | 'credentialStatus'> | undefined
): boolean {
  return Boolean(
    connection?.configured &&
    connection.credentialStatus !== 'missing' &&
    connection.credentialStatus !== 'unreadable'
  )
}

export function providerHasUsableCredential(
  provider: { id?: string; apiKey?: string } | null | undefined,
  connection: (Pick<SharedConnectionCredentialState, 'configured' | 'credentialStatus'> &
    Partial<Pick<SharedConnectionCredentialState, 'id'>>) | undefined
): boolean {
  if (provider?.apiKey?.trim()) return true
  return sharedModelConnectionHasUsableCredential(connection)
}

export function connectionCredentialStateById(
  states: readonly SharedConnectionCredentialState[] | null | undefined,
  providerId: string | undefined
): SharedConnectionCredentialState | undefined {
  const id = providerId?.trim()
  if (!id || !states?.length) return undefined
  return states.find((item) => item.id === id)
}

type SharedModelConnectionsSnapshotLike = {
  schemaVersion?: unknown
  providers?: unknown
}

function parseCredentialStates(body: string): SharedConnectionCredentialState[] {
  let value: SharedModelConnectionsSnapshotLike
  try {
    value = JSON.parse(body) as SharedModelConnectionsSnapshotLike
  } catch {
    throw new Error('Invalid shared model connection response')
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.providers)) {
    throw new Error('Invalid shared model connection response')
  }
  const states: SharedConnectionCredentialState[] = []
  for (const entry of value.providers) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    if (typeof item.configured !== 'boolean') continue
    const credentialStatus = item.credentialStatus
    states.push({
      id: item.id,
      configured: item.configured,
      ...(credentialStatus === 'ready' ||
      credentialStatus === 'not-required' ||
      credentialStatus === 'missing' ||
      credentialStatus === 'unreadable'
        ? { credentialStatus }
        : {})
    })
  }
  return states
}

/**
 * Whether a capability settings row should warn that the selected provider
 * still needs credentials. Suppresses the warning while credential state is
 * still loading (`connectionCredentials == null`).
 */
export function shouldWarnMissingProviderCredential(input: {
  usingCustomProvider: boolean
  protocolExempt?: boolean
  provider: { id?: string; apiKey?: string } | null | undefined
  connectionCredentials: readonly SharedConnectionCredentialState[] | null
}): boolean {
  if (input.usingCustomProvider || input.protocolExempt) return false
  if (input.connectionCredentials == null) return false
  return !providerHasUsableCredential(
    input.provider,
    connectionCredentialStateById(input.connectionCredentials, input.provider?.id)
  )
}

/** One-shot GET of credential readiness for all shared model connections. */
export async function fetchSharedModelConnectionCredentialStates(): Promise<SharedConnectionCredentialState[]> {
  if (typeof window.kunGui?.runtimeRequest !== 'function') return []
  const result = await window.kunGui.runtimeRequest('/v1/model-connections', 'GET')
  if (!result.ok) {
    throw new Error(`Shared model connection request failed (HTTP ${result.status})`)
  }
  return parseCredentialStates(result.body)
}
