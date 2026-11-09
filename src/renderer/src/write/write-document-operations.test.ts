import { describe, expect, it, vi } from 'vitest'
import { enqueueWriteDocumentOperation, relocateQueuedWriteDocumentOperations } from './write-document-operations'
import { enqueueWriteWorkspaceSave, flushWriteWorkspaceSaveQueue } from './write-save-coordinator'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('Work document operations at absolute roots', () => {
  it.each([
    { root: 'C:\\', canonical: 'C:/', child: 'C:/notes.md' },
    { root: 'D:\\', canonical: 'D:/', child: 'D:/notes.md' },
    { root: '/', canonical: '/', child: '/notes.md' },
    { root: '\\\\server\\share\\', canonical: '//server/share', child: '//server/share/notes.md' },
    { root: '\\\\?\\C:\\', canonical: '//?/C:/', child: '//?/C:/notes.md' }
  ])('preserves $root and serializes its descendant across separator spellings', async ({ root, canonical, child }) => {
    const blocked = gate()
    const parentAction = vi.fn(async (path: string) => { await blocked.promise; return path })
    const childAction = vi.fn(async (path: string) => path)
    const parent = enqueueWriteDocumentOperation(root, root, parentAction)
    const descendant = enqueueWriteDocumentOperation(canonical, child, childAction)
    try {
      await vi.waitFor(() => expect(parentAction).toHaveBeenCalledWith(canonical))
      expect(childAction).not.toHaveBeenCalled()
    } finally { blocked.resolve() }
    await expect(parent).resolves.toBe(canonical)
    await expect(descendant).resolves.toBe(child)
  })

  it.each(['C:', 'D:/', ''])('does not merge C:/ with the distinct workspace %j', async (otherRoot) => {
    const blocked = gate()
    const first = enqueueWriteDocumentOperation('C:\\', 'C:/notes.md', async () => blocked.promise)
    const independent = vi.fn(async (path: string) => path)
    try {
      await expect(enqueueWriteDocumentOperation(otherRoot, 'C:/notes.md', independent)).resolves.toBe('C:/notes.md')
      expect(independent).toHaveBeenCalledOnce()
    } finally { blocked.resolve(); await first }
  })

  it.each(['C:/', '/'])('flushes pending disk writes below the absolute root %s', async (root) => {
    const blocked = gate()
    const path = `${root}folder/notes.md`
    const writer = vi.fn(async () => { await blocked.promise; return { ok: true as const, path, savedAt: '2026-11-08T00:00:00Z' } })
    const saving = enqueueWriteWorkspaceSave({ workspaceRoot: root, path, content: 'draft' }, writer)
    await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce())
    let flushed = false
    const flushing = flushWriteWorkspaceSaveQueue(root, root, true).then(() => { flushed = true })
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(flushed).toBe(false)
    } finally { blocked.resolve(); await saving; await flushing }
    expect(flushed).toBe(true)
  })

  it('redirects queued root descendants without dropping or doubling the separating slash', async () => {
    const blocked = gate()
    const first = enqueueWriteDocumentOperation('C:/', 'C:/', async () => blocked.promise)
    const next = enqueueWriteDocumentOperation('C:\\', 'C:/folder/notes.md', async (path) => path)
    relocateQueuedWriteDocumentOperations('C:/', 'C:/', 'D:/renamed')
    blocked.resolve()
    await first
    await expect(next).resolves.toBe('D:/renamed/folder/notes.md')
  })
})
