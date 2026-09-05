import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installLiveProcessLog } from './live-process-log.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('live process log', () => {
  it('rotates with copy-truncate while the inherited append fd stays open', () => {
    const fixture = createFixture()
    const handle = installLiveProcessLog({
      logPath: fixture.path,
      stdout: fixture.stream,
      stderr: fixture.stream,
      options: { maxFileBytes: 32, maxArchives: 2, maintenanceIntervalMs: 0 }
    })
    try {
      fixture.stream.write('a'.repeat(20))
      fixture.stream.write('b'.repeat(20))
      expect(readFileSync(`${fixture.path}.1`, 'utf8')).toBe('a'.repeat(20))
      expect(readFileSync(fixture.path, 'utf8')).toBe('b'.repeat(20))
    } finally {
      handle.close()
      closeSync(fixture.fd)
    }
  })

  it('bounds archive count during repeated live rotation', () => {
    const fixture = createFixture()
    const handle = installLiveProcessLog({
      logPath: fixture.path,
      stdout: fixture.stream,
      stderr: fixture.stream,
      options: { maxFileBytes: 24, maxArchives: 2, maintenanceIntervalMs: 0 }
    })
    try {
      for (const value of ['a', 'b', 'c', 'd']) fixture.stream.write(value.repeat(16))
      expect(readFileSync(fixture.path, 'utf8')).toBe('d'.repeat(16))
      expect(readFileSync(`${fixture.path}.1`, 'utf8')).toBe('c'.repeat(16))
      expect(readFileSync(`${fixture.path}.2`, 'utf8')).toBe('b'.repeat(16))
      expect(() => readFileSync(`${fixture.path}.3`, 'utf8')).toThrow()
    } finally {
      handle.close()
      closeSync(fixture.fd)
    }
  })

  it('truncates a single oversized chunk with an explicit marker', () => {
    const fixture = createFixture()
    const handle = installLiveProcessLog({
      logPath: fixture.path,
      stdout: fixture.stream,
      stderr: fixture.stream,
      options: { maxFileBytes: 48, maintenanceIntervalMs: 0 }
    })
    try {
      fixture.stream.write('z'.repeat(200))
      const output = readFileSync(fixture.path, 'utf8')
      expect(Buffer.byteLength(output)).toBe(48)
      expect(output).toContain('[kun log chunk truncated]')
    } finally {
      handle.close()
      closeSync(fixture.fd)
    }
  })

  it('bounds an oversized active file during startup maintenance', () => {
    const fixture = createFixture('x'.repeat(100))
    const handle = installLiveProcessLog({
      logPath: fixture.path,
      stdout: fixture.stream,
      stderr: fixture.stream,
      options: { maxFileBytes: 32, maxArchives: 2, maintenanceIntervalMs: 0 }
    })
    try {
      expect(readFileSync(fixture.path, 'utf8')).toBe('')
      expect(readFileSync(`${fixture.path}.1`, 'utf8')).toBe('x'.repeat(32))
    } finally {
      handle.close()
      closeSync(fixture.fd)
    }
  })
})

function createFixture(initial = ''): {
  path: string
  fd: number
  stream: { write: NodeJS.WriteStream['write'] }
} {
  const root = mkdtempSync(join(tmpdir(), 'kun-live-log-'))
  roots.push(root)
  const path = join(root, 'runtime.log')
  writeFileSync(path, initial)
  const fd = openSync(path, 'a')
  const stream = {
    write: ((chunk: string | Uint8Array, encoding?: BufferEncoding): boolean => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)
      writeSync(fd, buffer)
      return true
    }) as NodeJS.WriteStream['write']
  }
  return { path, fd, stream }
}
