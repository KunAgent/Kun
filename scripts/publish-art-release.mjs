#!/usr/bin/env node
// Uploads only immutable art objects. Registry promotion is a separate audited SQL transaction.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parseEnv } from 'node:util'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { HttpsProxyAgent } from 'https-proxy-agent'
const [directory, credentialsPath] = process.argv.slice(2)
if (!directory || !credentialsPath) throw new Error('usage: node scripts/publish-art-release.mjs <build-directory> <credentials.env>')
const env = parseEnv(await readFile(credentialsPath, 'utf8'))
const endpoint = new URL(env.S3_ENDPOINT)
if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('Expected R2 endpoint')
const client = new S3Client({ endpoint: endpoint.origin, region: 'auto', credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  ...(process.env.HTTPS_PROXY ? { requestHandler: new NodeHttpHandler({ httpsAgent: new HttpsProxyAgent(process.env.HTTPS_PROXY) }) } : {}) })
const descriptor = JSON.parse(await readFile(join(directory, 'descriptor.json'), 'utf8'))
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(descriptor.releaseId)) throw new Error('Invalid release')
const hash = b => createHash('sha256').update(b).digest('hex')
const tasks = (await readdir(join(directory, 'objects'))).map(name => ({ name: `objects/${name}`, key: `kun-art/v1/objects/${name}` }))
tasks.push({ name: `${descriptor.releaseId}.json`, key: `kun-art/v1/releases/${descriptor.releaseId}.json` })
let complete = 0
async function get(key) {
  try { return Buffer.from(await (await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))).Body.transformToByteArray()) }
  catch (error) { if (error.$metadata?.httpStatusCode === 404) return null; throw error }
}
async function upload(task) {
  const bytes = await readFile(join(directory, task.name)), existing = await get(task.key)
  if (existing && hash(existing) !== hash(bytes)) throw new Error('Immutable object collision')
  if (!existing) {
    await client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: task.key, Body: bytes,
      ContentType: task.name.endsWith('.webp') ? 'image/webp' : 'application/json', CacheControl: 'public,max-age=31536000,immutable', IfNoneMatch: '*' }))
    const stored = await get(task.key)
    if (!stored || hash(stored) !== hash(bytes)) throw new Error('Read-back verification failed')
  }
  complete++
  if (complete % 50 === 0 || complete === tasks.length) console.log(`Verified ${complete}/${tasks.length}`)
}
let next = 0
await Promise.all(Array.from({ length: 6 }, async () => { while (next < tasks.length) await upload(tasks[next++]) }))
const manifest = await readFile(join(directory, `${descriptor.releaseId}.json`))
if (hash(manifest) !== descriptor.sha256 || manifest.length !== descriptor.size) throw new Error('Descriptor mismatch')
const json = JSON.stringify(descriptor).replaceAll("'", "''")
await writeFile(join(directory, 'register.sql'), `-- All objects uploaded and read-back verified. Registers a draft; does not promote.\ninsert into art.releases (id, descriptor) values ('${descriptor.releaseId}', '${json}'::jsonb);\n`)
console.log('Upload verified. Apply register.sql, then promote with art.promote(channel, release_id).')
