/** A single, forward-only migration for one workflow node type. */
export interface WorkflowNodeMigration {
  nodeType: string
  fromVersion: number
  toVersion: number
  migrate(config: unknown): unknown
}

const MAX_NODE_TYPE_LENGTH = 256
const MAX_VERSION = 10_000

function isValidNodeType(value: unknown): value is string {
  if (typeof value !== 'string') return false
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f)) return false
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_NODE_TYPE_LENGTH) return false
  return true
}

function isValidVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_VERSION
}

function migrationKey(migration: Pick<WorkflowNodeMigration, 'nodeType' | 'fromVersion' | 'toVersion'>): string {
  return `${migration.nodeType}\u0000${migration.fromVersion}\u0000${migration.toVersion}`
}

function assertMigration(migration: WorkflowNodeMigration): WorkflowNodeMigration {
  if (!migration || typeof migration !== 'object') throw new TypeError('workflow migration must be an object')
  if (!isValidNodeType(migration.nodeType)) throw new TypeError('workflow migration nodeType is invalid')
  if (!isValidVersion(migration.fromVersion) || !isValidVersion(migration.toVersion)) {
    throw new TypeError('workflow migration versions are invalid')
  }
  if (migration.toVersion <= migration.fromVersion) {
    throw new TypeError('workflow migration must move forward')
  }
  if (typeof migration.migrate !== 'function') throw new TypeError('workflow migration callback is required')

  return {
    ...migration,
    nodeType: migration.nodeType.trim()
  }
}

/**
 * In-memory registry used by a future workflow loader. It deliberately does
 * not run callbacks; callers can review and execute a resolved chain in the
 * persistence boundary that owns backups and rollback.
 */
export class WorkflowNodeMigrationRegistry {
  private readonly migrations = new Map<string, WorkflowNodeMigration>()

  register(migration: WorkflowNodeMigration): void {
    const normalized = assertMigration(migration)
    const key = migrationKey(normalized)
    if (this.migrations.has(key)) throw new Error(`workflow migration already registered: ${key}`)
    this.migrations.set(key, normalized)
  }

  findPath(nodeType: string, fromVersion: number, toVersion: number): readonly WorkflowNodeMigration[] | null {
    if (!isValidNodeType(nodeType) || !isValidVersion(fromVersion) || !isValidVersion(toVersion)) return null
    const normalizedNodeType = nodeType.trim()
    if (fromVersion > toVersion) return null
    if (fromVersion === toVersion) return []

    const paths: WorkflowNodeMigration[][] = [[]]
    const visited = new Set<number>([fromVersion])
    while (paths.length > 0) {
      const path = paths.shift()!
      const currentVersion = path.length === 0 ? fromVersion : path[path.length - 1]!.toVersion
      const next = [...this.migrations.values()]
        .filter((migration) => migration.nodeType === normalizedNodeType && migration.fromVersion === currentVersion)
        .sort((left, right) => left.toVersion - right.toVersion)

      for (const migration of next) {
        if (migration.toVersion > toVersion || visited.has(migration.toVersion)) continue
        const candidate = [...path, migration]
        if (migration.toVersion === toVersion) return candidate
        visited.add(migration.toVersion)
        paths.push(candidate)
      }
    }
    return null
  }
}
