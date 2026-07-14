/**
 * Version metadata for persisted workflow documents.
 *
 * This contract is intentionally independent from the editor/runtime so callers
 * can reject future documents before attempting a lossy normalization.
 */
export const CURRENT_WORKFLOW_SCHEMA_VERSION = 1 as const

export type WorkflowVersionMetadata = {
  schemaVersion: number
  createdAppVersion: string
  lastMigratedVersion: number
}

export type WorkflowVersionInspection =
  | { kind: 'supported'; metadata: WorkflowVersionMetadata }
  | { kind: 'missing'; metadata: WorkflowVersionMetadata }
  | { kind: 'future'; schemaVersion: number }
  | { kind: 'invalid' }

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000 ? value : null
}

function appVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  const hasControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
  return normalized.length > 0 && normalized.length <= 64 && !hasControlCharacter
    ? normalized
    : null
}

/**
 * Inspect version metadata without mutating the supplied workflow document.
 * Missing metadata is accepted for legacy documents and receives a current
 * in-memory default; future versions are rejected so unknown fields are not
 * silently discarded by the legacy normalizer.
 */
export function inspectWorkflowVersion(value: unknown): WorkflowVersionInspection {
  const input = record(value)
  if (!input) return { kind: 'invalid' }
  if (input.schemaVersion === undefined) {
    return {
      kind: 'missing',
      metadata: {
        schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
        createdAppVersion: 'legacy',
        lastMigratedVersion: CURRENT_WORKFLOW_SCHEMA_VERSION
      }
    }
  }

  const schemaVersion = boundedVersion(input.schemaVersion)
  if (schemaVersion === null) return { kind: 'invalid' }
  if (schemaVersion > CURRENT_WORKFLOW_SCHEMA_VERSION) return { kind: 'future', schemaVersion }

  const createdAppVersion = appVersion(input.createdAppVersion)
  const lastMigratedVersion = boundedVersion(input.lastMigratedVersion)
  if (
    !createdAppVersion ||
    lastMigratedVersion === null ||
    lastMigratedVersion < schemaVersion ||
    lastMigratedVersion > CURRENT_WORKFLOW_SCHEMA_VERSION
  ) {
    return { kind: 'invalid' }
  }

  return {
    kind: 'supported',
    metadata: { schemaVersion, createdAppVersion, lastMigratedVersion }
  }
}

export function createWorkflowVersionMetadata(appVersionValue: string): WorkflowVersionMetadata {
  const createdAppVersion = appVersion(appVersionValue)
  if (!createdAppVersion) throw new Error('invalid workflow app version')
  return {
    schemaVersion: CURRENT_WORKFLOW_SCHEMA_VERSION,
    createdAppVersion,
    lastMigratedVersion: CURRENT_WORKFLOW_SCHEMA_VERSION
  }
}
