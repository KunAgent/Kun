import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getDotenv, setDotenv } from './edit/dotenv.js'
import { getJsoncValue, setJsoncValue } from './edit/jsonc.js'
import { getTomlTable, getTomlTopLevel, setTomlTable, setTomlTopLevel, type TomlScalar, type TomlTable } from './edit/toml.js'
import type { AgentWiringRecord, StashedValue, WiringEdit, WiringSlot } from './types.js'

export function slotId(slot: WiringSlot): string {
  switch (slot.format) {
    case 'json': return `${slot.file}#json:${JSON.stringify(slot.path)}`
    case 'toml-key': return `${slot.file}#toml:${slot.key}`
    case 'toml-table': return `${slot.file}#table:${slot.table}`
    case 'dotenv': return `${slot.file}#env:${slot.key}`
  }
}

export function readFileText(file: string): string {
  try { return readFileSync(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

const BOM = '﻿'

export function readSlot(text: string, slot: WiringSlot): unknown {
  const body = text.startsWith(BOM) ? text.slice(1) : text
  switch (slot.format) {
    case 'json': return getJsoncValue(body, slot.path)
    case 'toml-key': return getTomlTopLevel(body, slot.key)
    case 'toml-table': return getTomlTable(body, slot.table)
    case 'dotenv': return getDotenv(body, slot.key)
  }
}

export function writeSlot(text: string, slot: WiringSlot, value: unknown): string {
  const bom = text.startsWith(BOM) ? BOM : ''
  const body = bom ? text.slice(1) : text
  let out: string
  switch (slot.format) {
    case 'json': out = setJsoncValue(body, slot.path, value); break
    case 'toml-key': out = setTomlTopLevel(body, slot.key, value as TomlScalar | undefined); break
    case 'toml-table': out = setTomlTable(body, slot.table, value as TomlTable | undefined); break
    case 'dotenv': out = setDotenv(body, slot.key, value === undefined ? undefined : String(value)); break
  }
  return bom + out
}

/**
 * Writes a config atomically, keeping the file's permission bits. Agent
 * configs can hold credentials, so a newly created file is user-only.
 */
export function writeFileAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  let mode = 0o600
  try { mode = statSync(file).mode & 0o777 } catch { /* new file */ }
  const temp = `${file}.kun-${process.pid}-${Date.now()}.tmp`
  writeFileSync(temp, content, { mode })
  renameSync(temp, file)
}

function isEmptyDocument(text: string, slot: WiringSlot): boolean {
  const trimmed = text.replace(BOM, '').trim()
  if (!trimmed) return true
  return slot.format === 'json' && /^\{\s*\}$/.test(trimmed)
}

/**
 * Applies edits to every file, recording each slot's original value the first
 * time Kun touches it, so later model switches never overwrite the stash.
 */
export function applyWiringEdits(edits: WiringEdit[], record: AgentWiringRecord): void {
  const byFile = new Map<string, WiringEdit[]>()
  for (const edit of edits) byFile.set(edit.slot.file, [...byFile.get(edit.slot.file) ?? [], edit])
  // Read and transform every file first so a parse error leaves nothing half-written.
  const writes: { file: string; before: string; after: string }[] = []
  for (const [file, fileEdits] of byFile) {
    const before = readFileText(file)
    let text = before
    for (const edit of fileEdits) {
      if ('ownedArray' in edit) {
        const current = readSlot(text, edit.slot)
        const kept = Array.isArray(current) ? current.filter((item) => !edit.ownedArray.owns(item)) : []
        text = writeSlot(text, edit.slot, [...kept, ...edit.ownedArray.items])
        if (!record.ownedArrays.some((entry) => entry.file === file && JSON.stringify(entry.path) === JSON.stringify(edit.slot.path))) {
          record.ownedArrays.push({ file, path: [...edit.slot.path] })
        }
        continue
      }
      const id = slotId(edit.slot)
      if (edit.slot.format === 'json') {
        for (let size = 1; size < edit.slot.path.length; size += 1) {
          const parent = { file, format: 'json' as const, path: edit.slot.path.slice(0, size) }
          const parentId = slotId(parent)
          if (!record.originals[parentId] && readSlot(text, parent) === undefined) {
            record.originals[parentId] = { slot: parent, absent: true, pruneIfEmpty: true }
          }
        }
      }
      if (!record.originals[id]) {
        const original = readSlot(text, edit.slot)
        record.originals[id] = original === undefined
          ? { slot: edit.slot, absent: true }
          : { slot: edit.slot, absent: false, value: structuredClone(original) }
      }
      text = writeSlot(text, edit.slot, edit.value)
    }
    if (text !== before) writes.push({ file, before, after: text })
  }
  record.files ??= {}
  for (const write of writes) {
    const known = record.files[write.file]
    if (!write.before && !existsSync(write.file) && !record.createdFiles.includes(write.file)) record.createdFiles.push(write.file)
    // The first write in a connection keeps the user's file as it was.
    const backup = known ? known.backup : Boolean(write.before)
    if (!known && write.before) copyFileSync(write.file, backupPath(write.file))
    writeFileAtomic(write.file, write.after)
    record.files[write.file] = { backup, writtenHash: hashText(write.after) }
  }
}

export function backupPath(file: string): string {
  return `${file}.kun-backup`
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Puts every stashed slot back, removes Kun's entries from shared arrays, and
 * deletes files Kun created when nothing else remains in them.
 */
export function restoreWiring(record: AgentWiringRecord, owns: (file: string, path: string[], item: unknown) => boolean): void {
  const files = new Set<string>([
    ...Object.values(record.originals).map((entry) => entry.slot.file),
    ...record.ownedArrays.map((entry) => entry.file)
  ])
  for (const file of files) {
    const before = readFileText(file)
    if (!before && !existsSync(file)) continue
    const tracked = record.files?.[file]
    if (tracked && tracked.writtenHash === hashText(before)) {
      // Nobody edited the file since Kun's last write: put the original back exactly.
      if (tracked.backup && existsSync(backupPath(file))) {
        writeFileAtomic(file, readFileText(backupPath(file)))
        unlinkSync(backupPath(file))
      } else if (record.createdFiles.includes(file)) unlinkSync(file)
      else continue
      continue
    }
    let text = before
    // Restore table and nested slots after their children so parents are rebuilt last.
    const entries: StashedValue[] = Object.values(record.originals).filter((entry) => entry.slot.file === file)
      .sort((left, right) => depth(right.slot) - depth(left.slot))
    for (const entry of entries) {
      if (entry.pruneIfEmpty) {
        const current = readSlot(text, entry.slot)
        const empty = current !== null && typeof current === 'object' && !Array.isArray(current) && !Object.keys(current).length
        if (empty) text = writeSlot(text, entry.slot, undefined)
        continue
      }
      text = writeSlot(text, entry.slot, entry.absent ? undefined : entry.value)
    }
    for (const owned of record.ownedArrays.filter((entry) => entry.file === file)) {
      const slot = { file, format: 'json' as const, path: owned.path }
      const current = readSlot(text, slot)
      if (Array.isArray(current)) {
        const kept = current.filter((item) => !owns(file, owned.path, item))
        text = writeSlot(text, slot, kept.length ? kept : undefined)
      }
    }
    if (record.createdFiles.includes(file) && entries.every((entry) => entry.absent) && isEmptyDocument(text, entries[0]?.slot ?? { file, format: 'json', path: [] })) {
      unlinkSync(file)
      continue
    }
    if (text !== before) writeFileAtomic(file, text)
  }
}

function depth(slot: WiringSlot): number {
  return slot.format === 'json' ? slot.path.length : 1
}
