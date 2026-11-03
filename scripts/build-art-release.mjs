#!/usr/bin/env node
import { build } from 'esbuild'
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
const args = new Map(process.argv.slice(2).reduce((all, x, i, xs) => x.startsWith('--') ? [...all, [x.slice(2), xs[i + 1]]] : all, []))
for (const name of ['release', 'key', 'out', 'catalog']) if (!args.get(name)) throw new Error(`Missing --${name}`)
const releaseId = args.get('release')
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(releaseId)) throw new Error('Invalid release id')
const root = resolve(import.meta.dirname, '..'), dir = resolve(root, 'src/asset/img/kun-avatar')
const output = resolve(args.get('out')), temp = await mkdtemp(join(tmpdir(), 'kun-art-build-'))
const hash = data => createHash('sha256').update(data).digest('hex')
try {
  const bundle = join(temp, 'catalog.mjs')
  await build({ stdin: { contents: `export * from './kun/src/contracts/kun-art-catalog.ts'; export * from './kun/src/contracts/kun-art-schema.ts'`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' })
  const { readArtCatalog, parseArtManifest } = await import(pathToFileURL(bundle).href)
  const index = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  const assets = {}, files = {}
  await mkdir(join(output, 'objects'), { recursive: true })
  for (const family of index.assetManifests) {
    if (!/^manifests\/[a-z-]+\.json$/.test(family)) throw new Error('Invalid family')
    const rows = JSON.parse(await readFile(join(dir, family), 'utf8'))
    for (const [key, row] of Object.entries(rows)) {
      if (assets[key]) throw new Error('Duplicate layer')
      assets[key] = { webp: row.webp }
      for (const path of Object.values(row.webp)) {
        if (!/^(96|128|256|512)\/[a-z0-9/.-]+\.webp$/.test(path) || path.includes('..')) throw new Error('Invalid path')
        const bytes = await readFile(join(dir, path)), meta = await sharp(bytes).metadata()
        if (meta.format !== 'webp' || meta.pages > 1) throw new Error('Only static WebP is supported')
        await sharp(bytes, { limitInputPixels: 1024 * 1024 }).raw().toBuffer()
        const sha256 = hash(bytes)
        files[path] = { sha256, size: bytes.length, width: meta.width, height: meta.height }
        await writeFile(join(output, 'objects', `${sha256}.webp`), bytes)
      }
    }
  }
  const economy = JSON.parse(await readFile(args.get('catalog'), 'utf8'))
  const manifest = parseArtManifest({ schemaVersion: 1, rendererVersion: 1, releaseId,
    minAppVersion: args.get('min-app') ?? '0.3.10', catalogVersion: economy.version,
    canvas: index.canvas, anchors: { faceBox: index.anchors.faceBox, compactFaceBox: index.anchors.compactFaceBox },
    catalog: readArtCatalog(), assets, files })
  const payload = Buffer.from(JSON.stringify(manifest))
  const privateKey = createPrivateKey(await readFile(args.get('key')))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Expected Ed25519 key')
  const envelope = Buffer.from(JSON.stringify({ payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') }))
  await writeFile(join(output, `${releaseId}.json`), envelope)
  const descriptor = { releaseId, minAppVersion: manifest.minAppVersion, schemaVersion: 1, rendererVersion: 1,
    catalogVersion: manifest.catalogVersion, sha256: hash(envelope), size: envelope.length }
  await writeFile(join(output, 'descriptor.json'), JSON.stringify(descriptor, null, 2) + '\n')
  console.log(JSON.stringify({ ...descriptor, files: Object.keys(files).length, downloadBytes: Object.values(files).reduce((n, f) => n + f.size, 0) }))
} finally { await rm(temp, { recursive: true, force: true }) }
