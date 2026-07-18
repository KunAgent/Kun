import { open, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DATA_MIGRATION_BACKUP_RETENTION_DAYS,
  DataMigrationReportSchema,
  type DataMigrationReport
} from '../../shared/data-migration'
import type { MigrationOperationJournal } from './transaction-journal'

export class MigrationReportStore {
  constructor(private readonly root: string) {}

  async writeImmutable(report: DataMigrationReport): Promise<string> {
    const sanitized = sanitizeDataMigrationReport(report)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const path = this.pathFor(sanitized.operationId)
    const handle = await open(path, 'wx', 0o600).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
      const existing = DataMigrationReportSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (JSON.stringify(existing) !== JSON.stringify(sanitized)) {
        throw new Error(`migration report already exists with different content: ${sanitized.operationId}`)
      }
      return null
    })
    if (!handle) return path
    try {
      await handle.writeFile(`${JSON.stringify(sanitized, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    const directory = await open(this.root, 'r').catch(() => null)
    try {
      await directory?.sync().catch(() => undefined)
    } finally {
      await directory?.close().catch(() => undefined)
    }
    return path
  }

  async read(operationId: string): Promise<DataMigrationReport> {
    return DataMigrationReportSchema.parse(JSON.parse(await readFile(this.pathFor(operationId), 'utf8')))
  }

  async list(): Promise<DataMigrationReport[]> {
    const names = await readdir(this.root).catch(() => [])
    const reports: DataMigrationReport[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        reports.push(DataMigrationReportSchema.parse(JSON.parse(await readFile(join(this.root, name), 'utf8'))))
      } catch {
        // Invalid files cannot become trusted report/UI data.
      }
    }
    return reports.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))
  }

  async delete(operationId: string): Promise<void> {
    await rm(this.pathFor(operationId), { force: true })
  }

  private pathFor(operationId: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(operationId)) {
      throw new Error(`unsafe migration report operation id: ${operationId}`)
    }
    return join(this.root, `${operationId}.json`)
  }
}

export function sanitizeDataMigrationReport(report: DataMigrationReport): DataMigrationReport {
  const parsed = DataMigrationReportSchema.parse(report)
  return DataMigrationReportSchema.parse({
    ...parsed,
    warnings: parsed.warnings.map(redactSensitiveText),
    ...(parsed.error
      ? {
          error: {
            ...parsed.error,
            message: redactSensitiveText(parsed.error.message),
            nextActions: parsed.error.nextActions.map(redactSensitiveText),
            ...(parsed.error.details
              ? {
                  details: Object.fromEntries(Object.entries(parsed.error.details).map(([key, value]) => [
                    sensitiveKey(key) ? redactKey(key) : key,
                    sensitiveKey(key) ? '[REDACTED]' : typeof value === 'string' ? redactSensitiveText(value) : value
                  ]))
                }
              : {})
          }
        }
      : {})
  })
}

export async function cleanupMigrationBackups(input: {
  journals: readonly MigrationOperationJournal[]
  now?: Date
  diskPressure?: boolean
  removePath?: (path: string) => Promise<void>
}): Promise<{ removed: string[]; retainedRecoverable: string[] }> {
  const now = input.now ?? new Date()
  const removePath = input.removePath ?? ((path: string) => rm(path, { recursive: true, force: true }))
  const removed: string[] = []
  const retainedRecoverable: string[] = []
  const journals = [...input.journals].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
  for (const journal of journals) {
    const backupPaths = unique(journal.mutations.flatMap((mutation) => mutation.backupPath ? [mutation.backupPath] : []))
    if (backupPaths.length === 0) continue
    if (!['completed', 'cancelled'].includes(journal.phase)) {
      retainedRecoverable.push(...backupPaths)
      continue
    }
    const fallbackExpiry = new Date(new Date(journal.completedAt ?? journal.updatedAt).getTime() + DATA_MIGRATION_BACKUP_RETENTION_DAYS * 86_400_000)
    const expiry = journal.backupExpiresAt ? new Date(journal.backupExpiresAt) : fallbackExpiry
    if (!input.diskPressure && expiry.getTime() > now.getTime()) continue
    for (const path of backupPaths) {
      await removePath(path)
      removed.push(path)
    }
  }
  return { removed, retainedRecoverable }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b(pass(?:word|phrase)?|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|runtime[_-]?token|credential)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
}

function sensitiveKey(value: string): boolean {
  return /pass|secret|credential|oauth|api.?key|access.?token|refresh.?token|runtime.?token/i.test(value)
}

function redactKey(value: string): string {
  return `redacted-${Buffer.from(value).toString('base64url').slice(0, 10)}`
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

export function defaultMigrationBackupExpiry(completedAt: Date): string {
  return new Date(completedAt.getTime() + DATA_MIGRATION_BACKUP_RETENTION_DAYS * 86_400_000).toISOString()
}
