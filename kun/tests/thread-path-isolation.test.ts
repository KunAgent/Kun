import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isPathBelowDirectory } from '../src/adapters/file/path-containment.js'
import { FileThreadStore } from '../src/adapters/file/file-thread-store.js'
import { HybridThreadStore } from '../src/adapters/hybrid/hybrid-thread-store.js'
import { Router } from '../src/server/router.js'

describe('thread path isolation', () => {
  const cleanup: string[] = []

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })

  it('does not decode an encoded path separator in a route parameter', () => {
    const router = new Router()
    router.add('DELETE', '/v1/threads/:id', () => new Response())

    expect(router.match('DELETE', '/v1/threads/..%2F..%2Fvictim')).toBeUndefined()
    expect(router.match('DELETE', '/v1/threads/%')).toBeUndefined()
  })

  it('accepts Windows descendants without accepting sibling or drive escapes', () => {
    const root = 'C:\\Users\\runner\\Kun\\threads'

    expect(isPathBelowDirectory(root, `${root}\\thr_valid`, win32)).toBe(true)
    expect(isPathBelowDirectory(root, 'c:\\users\\RUNNER\\Kun\\threads\\thr_case', win32))
      .toBe(true)
    expect(isPathBelowDirectory(root, root, win32)).toBe(false)
    expect(isPathBelowDirectory(root, 'C:\\Users\\runner\\Kun\\threads-old\\thr_sibling', win32))
      .toBe(false)
    expect(isPathBelowDirectory(root, 'C:\\Users\\runner\\Kun\\outside', win32)).toBe(false)
    expect(isPathBelowDirectory(root, 'D:\\Kun\\threads\\thr_other_drive', win32)).toBe(false)
  })

  it('does not let the file store delete outside its threads directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-file-thread-store-'))
    cleanup.push(dataDir)
    const victim = join(dirname(dataDir), `kun-victim-${Date.now()}`)
    cleanup.push(victim)
    await mkdir(victim)
    const store = new FileThreadStore({ dataDir })

    await expect(store.delete('../../' + victim.split('/').pop())).resolves.toBe(false)
    await expect(stat(victim)).resolves.toBeTruthy()
    await expect(store.get('../victim')).resolves.toBeNull()
  })

  it('does not let the hybrid store delete outside its threads directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-hybrid-thread-store-'))
    cleanup.push(dataDir)
    const victim = join(dirname(dataDir), `kun-victim-${Date.now()}`)
    cleanup.push(victim)
    await mkdir(victim)
    const store = new HybridThreadStore({ dataDir })

    try {
      await expect(store.delete('../../' + victim.split('/').pop())).resolves.toBe(false)
      await expect(stat(victim)).resolves.toBeTruthy()
      await expect(store.get('../victim')).resolves.toBeNull()
    } finally {
      await store.shutdown()
    }
  })
})
