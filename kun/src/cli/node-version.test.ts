import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'
import { MINIMUM_NODE_VERSION, nodeVersionStartupError } from './node-version.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function bootstrap(version: string, args: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'kun-node-startup-'))
  roots.push(root)
  for (const name of ['serve-entry', 'node-version']) {
    const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8')
    const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'node20' })
    await writeFile(join(root, `${name}.js`), code)
  }
  const marker = join(root, 'runtime-loaded')
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  await writeFile(join(root, 'version.mjs'), `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });`)
  await writeFile(join(root, 'serve-main.js'),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); process.stdout.write(JSON.stringify(process.argv.slice(2)));`)
  const result = spawnSync(process.execPath, ['--import', join(root, 'version.mjs'), join(root, 'serve-entry.js'), ...args],
    { encoding: 'utf8', timeout: 10_000 })
  expect(result.error).toBeUndefined()
  return { result, loaded: await readFile(marker, 'utf8').catch(() => null) }
}

describe('CLI Node version preflight', () => {
  it.each(['18.20.0', '20.18.0', '22.0.0', '22.18.0', 'invalid'])('rejects unsupported Node %s with actionable guidance', version => {
    const message = nodeVersionStartupError(version, '/old/node')
    expect(message).toContain(`>=${MINIMUM_NODE_VERSION}`)
    expect(message).toContain(version)
    expect(message).toContain('/old/node')
    expect(message).toContain('first in PATH')
  })

  it.each(['22.19.0', 'v22.19.1', '22.20.0', '23.0.0', '24.18.0', '26.0.0'])('accepts supported Node %s', version => {
    expect(nodeVersionStartupError(version, '/node')).toBeUndefined()
  })

  it('uses the package engine requirement as its minimum', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(manifest.engines.node).toBe(`>=${MINIMUM_NODE_VERSION}`)
  })

  it.each(['tui', 'serve', '--help', '--version'])('refuses %s before importing any runtime code on old Node', async command => {
    const { result, loaded } = await bootstrap('20.18.0', [command])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`Node.js >=${MINIMUM_NODE_VERSION}`)
    expect(result.stderr).not.toContain('node:sqlite')
    expect(result.stderr).not.toContain('ERR_UNKNOWN_BUILTIN_MODULE')
    expect(loaded).toBeNull()
  })

  it.each(['22.19.0', '24.18.0'])('delegates unchanged arguments to the dispatcher on Node %s', async version => {
    const args = ['tui', '--help']
    const { result, loaded } = await bootstrap(version, args)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual(args)
    expect(loaded).toBe('loaded')
  })
})
