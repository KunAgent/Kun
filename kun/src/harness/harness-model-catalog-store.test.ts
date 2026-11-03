import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { HarnessDefinition } from '../contracts/harness.js'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'

const opencode = BUILTIN_HARNESSES.find((entry) => entry.id === 'opencode')!
const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), 'kun-model-catalogs-')); dirs.push(dir)
  // Credential and config files of the engine resolve under this home.
  vi.stubEnv('XDG_DATA_HOME', join(dir, 'data'))
  vi.stubEnv('XDG_CONFIG_HOME', join(dir, 'config'))
  const command = join(dir, 'opencode')
  await writeFile(command, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return { dir, command, definition: { ...opencode, launch: { ...opencode.launch!, command } } as HarnessDefinition }
}

/** A fresh module graph stands in for a new Runtime process: module-level salts are regenerated. */
async function freshProcess() {
  vi.resetModules()
  return import('./harness-model-catalog-store.js')
}

it('derives the same identity in every process and a new one when the Agent changes', async () => {
  const { dir, command, definition } = await scratch()
  const identity = async (target = definition) => (await freshProcess()).harnessModelCatalogIdentity(target, [command])
  const first = await identity()
  expect(first).toMatch(/^[a-f0-9]{64}$/u)
  expect(await identity()).toBe(first)

  await writeFile(command, '#!/bin/sh\necho upgraded\nexit 0\n')
  const upgraded = await identity()
  expect(upgraded).not.toBe(first)

  await mkdir(join(dir, 'data', 'opencode'), { recursive: true })
  await writeFile(join(dir, 'data', 'opencode', 'auth.json'), '{"provider":{}}')
  const signedIn = await identity()
  expect(signedIn).not.toBe(upgraded)

  const proxy = process.env.HTTPS_PROXY
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:65530')
  expect(await identity()).not.toBe(signedIn)
  vi.stubEnv('HTTPS_PROXY', proxy)
  expect(await identity()).toBe(signedIn)

  expect(await identity({ ...definition, launch: { ...definition.launch!, args: ['acp', '--print-logs'] } })).not.toBe(signedIn)
  expect(await identity({ ...definition, launch: { ...definition.launch!, secretEnv: [{ name: 'OPENCODE_KEY', secretRef: 'secret-a' }] } }))
    .toBeUndefined()
})

it('keeps catalogs across a restart and drops the error of a degraded lookup', async () => {
  const { dir, command, definition } = await scratch()
  const path = join(dir, 'harness-model-catalogs.json')
  const start = async () => {
    const { HarnessModelCatalogStore, harnessModelCatalogIdentity } = await freshProcess()
    return new HarnessModelCatalogStore({ path, identity: (target) => harnessModelCatalogIdentity(target, [command]) })
  }
  const first = await start()
  expect(first.get(definition)).toBeUndefined()
  first.record(definition, { models: [], modelInfo: [] })
  first.record(definition, { models: ['opencode/big', 'opencode/small'], modelInfo: [{ id: 'opencode/big', isDefault: true }],
    agents: [{ id: 'build', name: 'build' }], defaultAgentId: 'build', error: { code: 'timeout' } })
  await first.flush()
  const file = JSON.parse(await readFile(path, 'utf8'))
  expect(file.version).toBe(1)
  expect(JSON.stringify(file)).not.toContain('timeout')

  const restarted = await start()
  expect(restarted.get(definition)).toEqual({ fetchedAt: expect.any(String), catalog: {
    models: ['opencode/big', 'opencode/small'], modelInfo: [{ id: 'opencode/big', isDefault: true }],
    agents: [{ id: 'build', name: 'build' }], defaultAgentId: 'build' } })
  expect(restarted.get({ ...definition, id: 'devin' })).toBeUndefined()

  await writeFile(command, '#!/bin/sh\necho upgraded\nexit 0\n')
  expect((await start()).get(definition)).toBeUndefined()
})

it('ignores an unreadable file and entries that fail validation', async () => {
  const { dir, command, definition } = await scratch()
  const path = join(dir, 'harness-model-catalogs.json')
  const { HarnessModelCatalogStore, harnessModelCatalogIdentity } = await freshProcess()
  const identity = harnessModelCatalogIdentity(definition, [command])!
  await writeFile(path, '{not json')
  expect(new HarnessModelCatalogStore({ path, identity: () => identity }).get(definition)).toBeUndefined()
  await writeFile(path, JSON.stringify({ version: 1, catalogs: [
    { harnessId: 'opencode', identity: 'not-a-digest', fetchedAt: 1, catalog: { models: ['a'], modelInfo: [] } },
    { harnessId: 'opencode', identity, fetchedAt: 1, catalog: { models: [], modelInfo: [] } }
  ] }))
  expect(new HarnessModelCatalogStore({ path, identity: () => identity }).get(definition)).toBeUndefined()
  await writeFile(path, JSON.stringify({ version: 1, catalogs: [
    { harnessId: 'opencode', identity, fetchedAt: 1, catalog: { models: ['a'], modelInfo: 'broken', settings: [{ kind: '?' }] } }
  ] }))
  expect(new HarnessModelCatalogStore({ path, identity: () => identity }).get(definition)?.catalog)
    .toEqual({ models: ['a'], modelInfo: [] })
})
