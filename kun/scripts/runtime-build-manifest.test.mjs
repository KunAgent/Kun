import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  computeRuntimeBuildId,
  writeRuntimeBuildManifest
} from './write-runtime-build-manifest.mjs'

test('runtime build identity is stable for identical output and changes with emitted JavaScript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-build-manifest-'))
  try {
    const packageVersion = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ).version
    await writeFile(join(root, 'a.js'), 'export const a = 1\n', 'utf8')
    await writeFile(join(root, 'b.js'), 'export const b = 2\n', 'utf8')
    const first = await computeRuntimeBuildId(root)
    const second = await computeRuntimeBuildId(root)
    assert.equal(second, first)

    await writeFile(join(root, 'a.js'), 'export const a = 1\r\n', 'utf8')
    assert.equal(
      await computeRuntimeBuildId(root),
      first,
      'platform-native CRLF/LF output must share one build identity'
    )

    await writeFile(join(root, 'b.js'), 'export const b = 3\n', 'utf8')
    assert.notEqual(await computeRuntimeBuildId(root), first)

    const manifest = await writeRuntimeBuildManifest(root)
    assert.equal(manifest.buildId, await computeRuntimeBuildId(root))
    assert.equal(
      manifest.serviceVersion,
      process.env.KUN_APP_VERSION || process.env.KUN_RELEASE_VERSION || packageVersion
    )
    assert.equal(
      manifest.channel,
      process.env.KUN_UPDATE_CHANNEL || process.env.RELEASE_CHANNEL || 'stable'
    )
    assert.equal(
      manifest.artifactVersion,
      process.env.KUN_ARTIFACT_VERSION || manifest.serviceVersion
    )
    assert.equal(manifest.nodeVersion, process.versions.node)
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'runtime-build.json'), 'utf8')),
      manifest
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runtime build manifest rejects an output directory without JavaScript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-runtime-build-manifest-empty-'))
  try {
    await assert.rejects(computeRuntimeBuildId(root), /no emitted JavaScript/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
