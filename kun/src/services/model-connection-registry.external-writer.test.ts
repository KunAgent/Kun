import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionCredentialStore } from './extension-credential-store.js'
import { ModelConnectionRegistry } from './model-connection-registry.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function connection(id: string, expectedRevision: number, select: boolean) {
  return {
    expectedRevision,
    id,
    name: id,
    kind: 'http' as const,
    authType: 'api-key' as const,
    baseUrl: 'https://api.deepseek.com',
    endpointFormat: 'chat_completions' as const,
    credential: `${id}-secret`,
    models: ['deepseek-chat'],
    selectedModel: 'deepseek-chat',
    probe: false,
    select
  }
}

describe('ModelConnectionRegistry external writers', () => {
  it('catches up on a revision written by another registry instance before gating dispatch', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-model-connections-external-'))
    roots.push(dataDir)
    const applied: Array<number | undefined> = []
    const runtime = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' }),
      inspectCredentialSource: async () => 'ready',
      onChanged: (connections) => { applied.push(connections.registryRevision) }
    })
    const first = await runtime.connect(connection('deepseek', 0, true))
    await runtime.assertActiveConfiguration()

    // Electron Main owns a second registry on the same file (OAuth refresh).
    const main = new ModelConnectionRegistry({
      dataDir,
      credentials: new ExtensionCredentialStore({ dataDir, profileId: 'test' })
    })
    const external = await main.connect(connection('other', first.revision, false))
    expect(external.revision).toBeGreaterThan(first.revision)

    await expect(runtime.assertActiveConfiguration()).resolves.toBeUndefined()
    expect(applied.at(-1)).toBe(external.revision)
    // An explicit stale snapshot revision is still refused.
    await expect(runtime.assertActiveConfiguration(first.revision)).rejects.toThrow(/not active/)
  })
})
