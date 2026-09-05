import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWriteDocumentGuard,
  resolveWriteDocumentPath
} from './runtime-write-document-guard.js'

describe('resolveWriteDocumentPath', () => {
  it('accepts an absolute path inside the workspace', () => {
    const root = '/workspace/deepseek-gui'
    expect(resolveWriteDocumentPath(root, '/workspace/deepseek-gui/draft.md')).toBe(
      '/workspace/deepseek-gui/draft.md'
    )
  })

  it('resolves a relative path against the workspace root', () => {
    expect(resolveWriteDocumentPath('/workspace/deepseek-gui', 'draft.md')).toBe(
      '/workspace/deepseek-gui/draft.md'
    )
  })

  it('rejects a path that escapes the workspace', () => {
    expect(resolveWriteDocumentPath('/workspace/deepseek-gui', '../secret.md')).toBeNull()
    expect(resolveWriteDocumentPath('/workspace/deepseek-gui', '/etc/passwd')).toBeNull()
  })

  it('rejects a non-absolute workspace root', () => {
    expect(resolveWriteDocumentPath('workspace/deepseek-gui', 'draft.md')).toBeNull()
  })
})

describe('createWriteDocumentGuard', () => {
  let dir: string
  let root: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'write-guard-'))
    root = join(dir, 'workspace')
    await mkdir(root, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('passes whiteboard-only sends with no document path', async () => {
    const guard = createWriteDocumentGuard()
    await expect(
      guard({ workspaceRoot: root, documentPath: null, whiteboardId: 'wb_1' })
    ).resolves.toBeNull()
  })

  it('passes when the document exists and the sha matches', async () => {
    await writeFile(join(root, 'draft.md'), 'hello', 'utf8')
    const sha = createHash('sha256').update('hello').digest('hex')
    const guard = createWriteDocumentGuard()
    await expect(
      guard({ workspaceRoot: root, documentPath: 'draft.md', expectedSha256: sha })
    ).resolves.toBeNull()
  })

  it('fails when the document changed after the request was queued', async () => {
    await writeFile(join(root, 'draft.md'), 'hello', 'utf8')
    const stale = 'b'.repeat(64)
    const guard = createWriteDocumentGuard()
    await expect(
      guard({ workspaceRoot: root, documentPath: 'draft.md', expectedSha256: stale })
    ).resolves.toMatch(/changed after the request was queued/)
  })

  it('fails when the document no longer exists', async () => {
    const guard = createWriteDocumentGuard()
    await expect(
      guard({ workspaceRoot: root, documentPath: 'draft.md' })
    ).resolves.toMatch(/not found/)
  })

  it('fails when the path escapes the workspace', async () => {
    const guard = createWriteDocumentGuard()
    await expect(
      guard({ workspaceRoot: root, documentPath: '../outside.md' })
    ).resolves.toMatch(/escapes the workspace/)
  })
})
