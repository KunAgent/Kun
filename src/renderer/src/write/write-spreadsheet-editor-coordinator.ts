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
}

export type CoordinatedSpreadsheetSave = {
  registrationId: string
  prepared: PreparedSpreadsheetSave
}

const registrations = new Map<string, Map<string, RegistrationRecord>>()
let registrationSequence = 0

export function registerWriteSpreadsheetEditor(
  path: string,
  editor: SpreadsheetEditorRegistration
): () => void {
  const key = writeDocumentKey(path)
  const id = `sheet-editor-${++registrationSequence}`
  const records = registrations.get(key) ?? new Map<string, RegistrationRecord>()
  records.set(id, { id, registeredAt: registrationSequence, editor })
  registrations.set(key, records)
  return () => {
    const current = registrations.get(key)
    current?.delete(id)
    if (current?.size === 0) registrations.delete(key)
  }
}

export async function prepareWriteSpreadsheetEditorSave(
  path: string
): Promise<CoordinatedSpreadsheetSave | null> {
  const record = selectedRegistration(path)
  if (!record) return null
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

function selectedRegistration(path: string): RegistrationRecord | undefined {
  const records = [...(registrations.get(writeDocumentKey(path))?.values() ?? [])]
  return records.find((record) => record.editor.isFocused()) ??
    records.sort((left, right) => right.registeredAt - left.registeredAt)[0]
}
