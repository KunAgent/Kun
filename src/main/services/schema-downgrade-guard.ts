export type SchemaGuardInput = {
  storedVersion: number
  supportedVersion: number
}

export type SchemaGuardMode = 'read-write' | 'read-only' | 'migration-required'

export type SchemaGuardDecision = {
  mode: SchemaGuardMode
  canWrite: boolean
  canExport: true
  reason: 'compatible' | 'newer-data-requires-upgrade' | 'older-data-requires-migration' | 'invalid-version'
}

/**
 * Decide whether persisted data may be opened for writing. This contract does
 * not migrate or mutate data; callers must honor `canWrite` before opening a
 * write-capable store and always keep export available.
 */
export function assessSchemaGuard(input: SchemaGuardInput): SchemaGuardDecision {
  if (!isValidInput(input) || !isVersion(input.storedVersion) || !isVersion(input.supportedVersion)) {
    return { mode: 'read-only', canWrite: false, canExport: true, reason: 'invalid-version' }
  }
  if (input.storedVersion > input.supportedVersion) {
    return { mode: 'read-only', canWrite: false, canExport: true, reason: 'newer-data-requires-upgrade' }
  }
  if (input.storedVersion < input.supportedVersion) {
    return { mode: 'migration-required', canWrite: false, canExport: true, reason: 'older-data-requires-migration' }
  }
  return { mode: 'read-write', canWrite: true, canExport: true, reason: 'compatible' }
}

function isValidInput(input: SchemaGuardInput): boolean {
  return Boolean(
    input &&
      typeof input === 'object' &&
      Object.keys(input).every((key) => key === 'storedVersion' || key === 'supportedVersion')
  )
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
