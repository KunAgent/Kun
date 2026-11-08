import type { WorkspaceSpreadsheetMutation } from '@shared/workspace-spreadsheet'
import { writeDocumentKey } from './write-editor-layout'

export type SpreadsheetMutationProjection = {
  mutations: WorkspaceSpreadsheetMutation[]
  unsupportedReason?: string
  baseFingerprints?: Record<string, string>
}

export type PreparedSpreadsheetSave = SpreadsheetMutationProjection & {
  token: string
}

export type SpreadsheetEditorRegistration = {
  isFocused: () => boolean
  prepareSave: () => Promise<PreparedSpreadsheetSave>
  commitSave: (token: string, sourceSha256: string) => SpreadsheetMutationProjection
  setSaving: (saving: boolean) => void
}

type RegistrationRecord = {
  id: string
  registeredAt: number
  editor: SpreadsheetEditorRegistration
  key: string
  documentEpoch?: number
}

export type CoordinatedSpreadsheetSave = {
  registrationId: string
  prepared: PreparedSpreadsheetSave
}

const registrations = new Map<string, Map<string, RegistrationRecord>>()
let registrationSequence = 0

export type SpreadsheetEditorDisposer = (() => void) & {
  matches: (path: string, documentEpoch?: number) => boolean
}

export function registerWriteSpreadsheetEditor(
  path: string,
  editor: SpreadsheetEditorRegistration,
  documentEpoch?: number
): SpreadsheetEditorDisposer {
  const key = writeDocumentKey(path)
  const id = `sheet-editor-${++registrationSequence}`
  const records = registrations.get(key) ?? new Map<string, RegistrationRecord>()
  const record: RegistrationRecord = { id, registeredAt: registrationSequence, editor, key, documentEpoch }
  records.set(id, record)
  registrations.set(key, records)
  const dispose = (): void => {
    const current = registrations.get(record.key)
    current?.delete(id)
    if (current?.size === 0) registrations.delete(record.key)
  }
  return Object.assign(dispose, {
    matches: (path: string, epoch?: number) => record.key === writeDocumentKey(path) && record.documentEpoch === epoch
  })
}

export function moveWriteSpreadsheetEditors(path: string, epoch: number, nextPath: string, nextEpoch: number): void {
  const key = writeDocumentKey(path)
  const nextKey = writeDocumentKey(nextPath)
  const records = registrations.get(key)
  if (!records) return
  const moved = registrations.get(nextKey) ?? new Map<string, RegistrationRecord>()
  for (const [id, record] of [...records]) {
    if (record.documentEpoch !== undefined && record.documentEpoch !== epoch) continue
    records.delete(id)
    record.key = nextKey
    record.documentEpoch = nextEpoch
    moved.set(id, record)
  }
  if (records.size === 0) registrations.delete(key)
  if (moved.size > 0) registrations.set(nextKey, moved)
}

export function hasWriteSpreadsheetEditor(path: string, epoch: number): boolean {
  return [...(registrations.get(writeDocumentKey(path))?.values() ?? [])]
    .some((record) => record.documentEpoch === undefined || record.documentEpoch === epoch)
}

export async function prepareWriteSpreadsheetEditorSave(
  path: string,
  documentEpoch?: number
): Promise<CoordinatedSpreadsheetSave | null> {
  const record = selectedRegistration(path, documentEpoch)
  if (!record) {
    if (registrations.get(writeDocumentKey(path))?.size) throw new Error('Spreadsheet editor belongs to another document instance.')
    return null
  }
  record.editor.setSaving(true)
  try {
    return { registrationId: record.id, prepared: await record.editor.prepareSave() }
  } catch (error) {
    record.editor.setSaving(false)
    throw error
  }
}

export function commitWriteSpreadsheetEditorSave(
  path: string,
  registrationId: string,
  token: string,
  sourceSha256: string
): SpreadsheetMutationProjection | null {
  const record = registrations.get(writeDocumentKey(path))?.get(registrationId)
  return record?.editor.commitSave(token, sourceSha256) ?? null
}

export function finishWriteSpreadsheetEditorSave(path: string, registrationId: string): void {
  registrations.get(writeDocumentKey(path))?.get(registrationId)?.editor.setSaving(false)
}

export function clearWriteSpreadsheetEditorRegistrationsForTests(): void {
  registrations.clear()
  registrationSequence = 0
}

function selectedRegistration(path: string, epoch?: number): RegistrationRecord | undefined {
  const records = [...(registrations.get(writeDocumentKey(path))?.values() ?? [])]
    .filter((record) => epoch === undefined || record.documentEpoch === undefined || record.documentEpoch === epoch)
  return records.find((record) => record.editor.isFocused()) ??
    records.sort((left, right) => right.registeredAt - left.registeredAt)[0]
}
