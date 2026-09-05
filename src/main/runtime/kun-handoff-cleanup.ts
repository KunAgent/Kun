import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../atomic-json-file'
import { appendManagedLogLine } from '../logger'

export type HandoffCleanupKind = 'runtime' | 'manager'

export type HandoffCleanupAuditEntry = {
  at: string
  action: 'backup' | 'cleanup'
  reason: string
  classification: string
  kind: HandoffCleanupKind
  instanceId: string
  pid?: number
  identityEvidence: string
  outcome: string
}

/**
 * Persist a copy of a stale discovery record before it is removed. Backups are
 * immutable snapshots under `userData/handoff-backups/` so a later forensic
 * review can reconstruct exactly which owner was cleaned up and why. The
 * caller must never clean up an `unknown` owner; only dead or verified-mismatch
 * owners reach this path. Best-effort: a backup failure never blocks cleanup.
 */
export async function backupHandoffCleanupRecord(
  record: unknown,
  instanceId: string,
  userDataPath: string
): Promise<string> {
  try {
    const dir = join(userDataPath, 'handoff-backups')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    const path = join(dir, `${stamp}-${instanceId}.json`)
    await atomicWriteFile(path, `${JSON.stringify(record, null, 2)}\n`)
    return path
  } catch {
    return ''
  }
}

/**
 * Append one machine-readable audit line to the managed `kun` log. The same
 * log directory is surfaced by the recovery page's "Open log folder" action,
 * so a user or support engineer can reconstruct every stale-owner cleanup.
 * Best-effort: logging must never break the settle path.
 */
export async function appendHandoffCleanupAudit(entry: HandoffCleanupAuditEntry): Promise<void> {
  try {
    await appendManagedLogLine('kun', `[handoff-cleanup] ${JSON.stringify(entry)}`)
  } catch {
    /* audit logging is best-effort */
  }
}

/**
 * Build the optional cleanup dependency overrides for the handoff coordinator.
 * Kept out of the coordinator's default dependencies so the coordinator (and
 * its tests) stay free of Electron's `app` module; the main process injects the
 * resolved userData directory here.
 */
export function handoffCleanupOverrides(userDataPath: string): {
  backupCleanupRecord: (record: unknown, instanceId: string) => Promise<string>
  appendCleanupAudit: (entry: HandoffCleanupAuditEntry) => Promise<void>
} {
  return {
    backupCleanupRecord: (record, instanceId) =>
      backupHandoffCleanupRecord(record, instanceId, userDataPath),
    appendCleanupAudit: appendHandoffCleanupAudit
  }
}
