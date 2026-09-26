import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendMarkdownBlockIdempotent } from './paper-notes-append'

describe('appendMarkdownBlockIdempotent', () => {
  let dir = ''
  let notesPath = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'paper-notes-'))
    notesPath = join(dir, 'NOTES.md')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('appends once and dedupes a repeated block', async () => {
    await writeFile(notesPath, '# Title\n')
    const block = '**Cool Papers · Kimi 解析**\n\n> 来源：[u](u)\n\n## Q1: x'
    expect(await appendMarkdownBlockIdempotent(notesPath, block)).toBe(true)
    expect(await appendMarkdownBlockIdempotent(notesPath, block)).toBe(false)
    const text = await readFile(notesPath, 'utf8')
    expect(text).toBe('# Title\n\n' + block + '\n')
  })

  it('creates the file when missing', async () => {
    expect(await appendMarkdownBlockIdempotent(notesPath, 'block')).toBe(true)
    expect(await readFile(notesPath, 'utf8')).toBe('block\n')
  })

  it('preserves CRLF and adds a blank separator line', async () => {
    await writeFile(notesPath, '# T\r\n\r\nnotes body\r\n')
    await appendMarkdownBlockIdempotent(notesPath, 'line1\nline2')
    const text = await readFile(notesPath, 'utf8')
    expect(text).toBe('# T\r\n\r\nnotes body\r\n\r\nline1\r\nline2\r\n')
  })

  it('keeps a single trailing newline when input lacks one', async () => {
    await writeFile(notesPath, 'no trailing newline')
    await appendMarkdownBlockIdempotent(notesPath, 'block')
    const text = await readFile(notesPath, 'utf8')
    expect(text).toBe('no trailing newline\n\nblock\n')
  })

  it('returns false for an empty block', async () => {
    await writeFile(notesPath, 'x\n')
    expect(await appendMarkdownBlockIdempotent(notesPath, '   \n\n')).toBe(false)
    expect(await readFile(notesPath, 'utf8')).toBe('x\n')
  })
})
