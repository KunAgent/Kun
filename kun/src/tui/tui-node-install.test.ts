import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { downloadTuiNode, nodePlatformTarget, userTuiNodeRoot } from './tui-node.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe.skipIf(process.platform === 'win32')('TUI Node installation', () => {
  async function fixture(valid: boolean) {
    const home = await mkdtemp(join(tmpdir(), 'kun-node-install-test-'))
    directories.push(home)
    const target = nodePlatformTarget()!
    const root = userTuiNodeRoot({ KUN_HOME: home })
    const source = join(home, 'source')
    await mkdir(join(source, target.dir, 'bin'), { recursive: true })
    await writeFile(join(source, target.binary), valid ? '#!/bin/sh\necho 26.12.0\n' : '#!/bin/sh\nexit 1\n')
    const archive = join(home, target.archive)
    expect(spawnSync('tar', ['-czf', archive, '-C', source, target.dir]).status).toBe(0)
    const bytes = await readFile(archive)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).endsWith('SHASUMS256.txt')) return new Response(`${hash}  ${target.archive}\n`)
      const response = new Response(bytes)
      const arrayBuffer = response.arrayBuffer.bind(response)
      response.arrayBuffer = async () => {
        // Exercise the real installer boundary: no staging may live on tmpdir's mount.
        expect((await readdir(root)).some((name) => name.startsWith('.install-'))).toBe(true)
        return arrayBuffer()
      }
      return response
    }) as typeof fetch
    await mkdir(join(root, target.dir, 'bin'), { recursive: true })
    await writeFile(join(root, target.binary), 'previous interpreter')
    return { home, root, target, fetchImpl }
  }

  it('stages and validates beside the install before replacing the old interpreter', async () => {
    const f = await fixture(true)
    const result = await downloadTuiNode({ KUN_HOME: f.home }, f.fetchImpl)
    expect(result).toEqual({ path: join(f.root, f.target.binary), source: 'cache', version: '26.12.0' })
    expect(await readdir(f.root)).toEqual([f.target.dir])
    expect(await readFile(result.path, 'utf8')).toContain('26.12.0')
  })

  it('preserves the previous install when the downloaded interpreter cannot run', async () => {
    const f = await fixture(false)
    await expect(downloadTuiNode({ KUN_HOME: f.home }, f.fetchImpl)).rejects.toThrow('did not start')
    expect(await readFile(join(f.root, f.target.binary), 'utf8')).toBe('previous interpreter')
    expect(await readdir(f.root)).toEqual([f.target.dir])
  })
})
