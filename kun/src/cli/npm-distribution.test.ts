import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { npmUpdateGuidance, readNpmDistribution } from './npm-distribution.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('npm distribution identity', () => {
  it('recognizes only the installed manifest channel, not a source package or environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-npm-identity-'))
    roots.push(root)
    const manifest = pathToFileURL(join(root, 'package.json'))
    expect(readNpmDistribution(manifest)).toBeUndefined()
    await writeFile(manifest, JSON.stringify({ name: 'kun', version: '0.4.5', private: true }))
    expect(readNpmDistribution(manifest)).toBeUndefined()
    const expected = { name: '@kun/agent', version: '0.4.5', windowsPackage: '@kun/agent-win32-x64' }
    await writeFile(manifest, JSON.stringify({ ...expected, kunNpm: { kind: 'npm', windowsPackage: expected.windowsPackage } }))
    expect(readNpmDistribution(manifest)).toEqual(expected)
  })

  it('guides both npm installation forms without invoking an archive updater', () => {
    const text = npmUpdateGuidance({ name: '@fixture/kun', version: '1.2.3' })
    expect(text).toContain('npm install -g @fixture/kun@<version>')
    expect(text).toContain('npm install @fixture/kun@<version>')
    expect(text).not.toContain('Kun.app')
  })
})
