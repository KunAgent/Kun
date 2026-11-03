import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { checkpointDir } from './git-checkpoint-foundation'

export type TurnUndoRecordFile = {
  /** Repository-relative `/` path. */
  path: string
  action: 'restore' | 'delete'
  /** Content the turn left (saved in the redo snapshot) and its mode. */
  endSha256: string
  endExecutable: boolean
  /** Content undo wrote; `null` when undo deleted the file. */
  restoredSha256: string | null
}

export type TurnUndoRecord = {
  version: 1
  undoId: string
  checkpointId: string
  threadId: string
  scope: 'turn' | 'rewind'
  state: 'pending' | 'undone' | 'reapplied' | 'failed'
  createdAt: string
  updatedAt: string
  files: TurnUndoRecordFile[]
}

type TurnUndoLedger = { version: 1; records: TurnUndoRecord[] }

/** Undo records live inside the checkpoint so retention removes them together. */
const LEDGER_FILE = 'turn-undo.json'
const REDO_DIRECTORY = 'turn-undo'
const MAX_RECORDS = 20

export function turnUndoLedgerPath(checkpointsRoot: string, checkpointId: string): string {
  return join(checkpointDir(checkpointsRoot, checkpointId), LEDGER_FILE)
}

export function turnUndoRedoDir(checkpointsRoot: string, checkpointId: string, undoId: string): string {
  return join(checkpointDir(checkpointsRoot, checkpointId), REDO_DIRECTORY, undoId)
}

export function createTurnUndoId(): string {
  return `tu_${Date.now()}_${randomUUID()}`
}

export function isValidTurnUndoId(undoId: string): boolean {
  return /^tu_\d+_[0-9a-f-]{36}$/.test(undoId)
}

export async function readTurnUndoLedger(checkpointsRoot: string, checkpointId: string): Promise<TurnUndoRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(turnUndoLedgerPath(checkpointsRoot, checkpointId), 'utf8')) as Partial<TurnUndoLedger>
    return Array.isArray(parsed.records)
      ? parsed.records.filter((record): record is TurnUndoRecord =>
          Boolean(record) && record.version === 1 && typeof record.undoId === 'string' && Array.isArray(record.files))
      : []
  } catch {
    return []
  }
}

/** Insert or replace a record by `undoId`; newest records are kept. */
export async function writeTurnUndoRecord(checkpointsRoot: string, record: TurnUndoRecord): Promise<void> {
  const records = (await readTurnUndoLedger(checkpointsRoot, record.checkpointId))
    .filter((existing) => existing.undoId !== record.undoId)
  records.push(record)
  const ledger: TurnUndoLedger = { version: 1, records: records.slice(-MAX_RECORDS) }
  const path = turnUndoLedgerPath(checkpointsRoot, record.checkpointId)
  await mkdir(checkpointDir(checkpointsRoot, record.checkpointId), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(ledger, null, 2), 'utf8')
  await rename(temporary, path)
}
