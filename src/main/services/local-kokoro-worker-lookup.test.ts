import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveKokoroWorkerEntry } from './local-kokoro-worker-lookup'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kun-kokoro-worker-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true })
})

const WORKER = 'local-kokoro-worker-entry.js'

describe('resolveKokoroWorkerEntry', () => {
  it('finds the entry beside the calling module', () => {
    const root = fixture()
    writeFileSync(join(root, WORKER), '// worker')
    const from = pathToFileURL(join(root, 'main.js')).href

    expect(resolveKokoroWorkerEntry(from)).toBe(pathToFileURL(join(root, WORKER)).href)
  })

  // Rollup may place this module in a shared chunk directory one level down.
  it('finds the entry one level up when bundled into a chunk', () => {
    const root = fixture()
    mkdirSync(join(root, 'chunks'))
    writeFileSync(join(root, WORKER), '// worker')
    const from = pathToFileURL(join(root, 'chunks', 'entry.js')).href

    expect(resolveKokoroWorkerEntry(from)).toBe(pathToFileURL(join(root, WORKER)).href)
  })

  // Packaged builds unpack the entry; the worker loader needs the real file.
  it('prefers the unpacked copy over the archive path', () => {
    const root = fixture()
    const packed = join(root, 'app.asar', 'out', 'main')
    const unpacked = join(root, 'app.asar.unpacked', 'out', 'main')
    mkdirSync(packed, { recursive: true })
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(join(packed, WORKER), '// archive copy')
    writeFileSync(join(unpacked, WORKER), '// unpacked copy')
    const from = pathToFileURL(join(packed, 'entry.js')).href

    expect(resolveKokoroWorkerEntry(from)).toBe(pathToFileURL(join(unpacked, WORKER)).href)
  })

  // The integration test imports the service from source, where the worker
  // exists only as build output.
  it('finds the built entry when running from source', () => {
    const root = fixture()
    const built = join(root, 'out', 'main')
    mkdirSync(built, { recursive: true })
    mkdirSync(join(root, 'src', 'main', 'services'), { recursive: true })
    writeFileSync(join(built, WORKER), '// worker')
    const from = pathToFileURL(join(root, 'src', 'main', 'services', 'service.ts')).href

    expect(resolveKokoroWorkerEntry(from)).toBe(pathToFileURL(join(built, WORKER)).href)
  })

  it('explains itself when the entry is missing', () => {
    const from = pathToFileURL(join(fixture(), 'main.js')).href

    expect(() => resolveKokoroWorkerEntry(from)).toThrow(/Kokoro speech worker is missing/)
  })
})
