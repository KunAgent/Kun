#!/usr/bin/env node
// Real production download smoke; isolated cache, no account session or user data.
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const accessToken = process.env.KUN_ART_ACCESS_TOKEN
if (!accessToken) throw new Error('Set KUN_ART_ACCESS_TOKEN to an application access token; artwork downloads require sign-in.')
const temp = await mkdtemp(join(tmpdir(), 'kun-art-smoke-'))
try {
  const modulePath = join(temp, 'service.mjs')
  await build({ stdin: { contents: `export * from './src/main/art-assets/service.ts'; export * from './src/main/art-assets/storage.ts'; export * from './kun/src/contracts/kun-art-catalog.ts'`,
    resolveDir: resolve(import.meta.dirname, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' })
  const { ArtAssetService, ArtStorage, installArtCatalog } = await import(pathToFileURL(modulePath).href)
  let downloads = 0, offline = false
  const options = { storage: new ArtStorage(join(temp, 'cache')), appVersion: '0.3.10',
    fetch: (url, options) => {
      if (offline) throw new Error('offline test')
      if (url.includes('/objects/')) downloads++
      return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` }, credentials: 'omit', cache: 'no-store' })
    },
    failed: code => console.log('failure:', code),
    activate: async manifest => installArtCatalog(manifest?.catalog ?? null),
    changed: state => { if (state.phase !== 'downloading' || state.completed % 100 === 0) console.log(state.phase, state.completed, state.total) }
  }
  const service = new ArtAssetService(options)
  const state = await service.check()
  assert.equal(state.phase, 'ready'); assert.ok(state.manifest)
  const count = downloads
  const unchanged = await service.check(); assert.equal(unchanged.phase, 'ready'); assert.equal(downloads, count)
  offline = true
  const restart = new ArtAssetService(options)
  assert.equal((await restart.getState()).manifest.releaseId, state.manifest.releaseId)
  const path = Object.keys(state.manifest.files)[0]
  assert.ok((await restart.resource(`kun-asset://${state.manifest.releaseId}/${path}`)).length > 0)
  assert.equal((await restart.check()).manifest.releaseId, state.manifest.releaseId)
  const rollback = await restart.rollback(); assert.equal(rollback.manifest, null); assert.equal(rollback.held, true)
  assert.equal((await new ArtAssetService(options).getState()).held, true)
  console.log(JSON.stringify({ ok: true, releaseId: state.manifest.releaseId, downloaded: count, unchangedDownloads: 0,
    signedFilesVerified: Object.keys(state.manifest.files).length, offlineRestore: true, rollback: true }))
  service.dispose(); restart.dispose()
} finally { await rm(temp, { recursive: true, force: true }) }
