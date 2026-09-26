/**
 * Idempotent append of a Markdown block to NOTES.md. Existing user content is
 * never rewritten: dedupe runs on whitespace-normalized content, and the file's
 * own newline style (CRLF/LF) is preserved. The result always ends with a
 * single trailing newline.
 */
import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from '../../atomic-json-file'

function normalizeForDedupe(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Appends `block` to the file at `notesPath`. Returns false when the block is
 * already present (normalized-content comparison), true when appended.
 */
export async function appendMarkdownBlockIdempotent(
  notesPath: string,
  block: string
): Promise<boolean> {
  const existing = await readFile(notesPath, 'utf8').catch(() => '')
  const normalizedBlock = normalizeForDedupe(block)
  if (!normalizedBlock) return false
  if (normalizeForDedupe(existing).includes(normalizedBlock)) return false

  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const blockText = block.replace(/\r\n?/g, '\n').replace(/\n/g, newline).trim()
  const head = existing.replace(/[\r\n]+$/, '')
  const next = (head ? `${head}${newline}${newline}` : '') + blockText + newline
  await atomicWriteFile(notesPath, next)
  return true
}
