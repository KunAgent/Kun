import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import {
  PRODUCT_NAME,
  artifactVersionForTag,
  channelBasePath,
  normalizeTag,
  positiveInt,
  readChannel,
  readConfig,
  requireFlag,
  runConcurrently
} from './publish-r2-support.mjs'

// Archived releases kept per channel, newest upload first. The published tag is always kept.
export const DEFAULT_KEEP_RELEASES = { stable: 3, frontier: 2 }
// electron-updater downloads the installed version's blockmap from the same latest/ directory
// for differential updates, so recent old-version blockmaps outlive their installers.
export const DEFAULT_KEEP_BLOCKMAPS = 10

const RELEASE_TAG = /^(?:v\d+\.\d+\.\d+|dev-\d{8}\.\d{4})$/
const GUI_ARTIFACT = /^Kun-(\d+\.\d+\.\d+|\d{8}\.\d{4})-(?:mac|win|linux)-[^/]+$/

function groupObjects(objects, idFor) {
  const groups = new Map()
  const unrecognized = []
  for (const object of objects) {
    const id = idFor(object)
    if (!id) {
      unrecognized.push(object.key)
      continue
    }
    const group = groups.get(id) ?? { id, newest: 0, bytes: 0, objects: [] }
    group.newest = Math.max(group.newest, object.lastModified)
    group.bytes += object.size
    group.objects.push(object)
    groups.set(id, group)
  }
  const ordered = [...groups.values()].sort((a, b) =>
    b.newest - a.newest || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  )
  return { ordered, unrecognized }
}

function sumBytes(objects) {
  return objects.reduce((total, object) => total + object.size, 0)
}

export function planReleaseArchivePrune({ prefix, objects, keep, protectedTags }) {
  const { ordered, unrecognized } = groupObjects(objects, (object) => {
    if (!object.key.startsWith(prefix)) return null
    const [tag, ...rest] = object.key.slice(prefix.length).split('/')
    return RELEASE_TAG.test(tag) && rest.length > 0 ? tag : null
  })
  const kept = new Set(ordered.slice(0, keep).map((group) => group.id))
  for (const tag of protectedTags) kept.add(tag)
  const deleted = ordered.filter((group) => !kept.has(group.id))
  return {
    keptTags: ordered.filter((group) => kept.has(group.id)).map((group) => group.id),
    deletedTags: deleted.map((group) => ({ tag: group.id, bytes: group.bytes })),
    deleteKeys: deleted.flatMap((group) => group.objects.map((object) => object.key)),
    deleteBytes: sumBytes(deleted.flatMap((group) => group.objects)),
    unrecognized
  }
}

export function planLatestPrune({ prefix, objects, currentVersion, keepBlockmaps }) {
  // latest.json, latest*.yml, and anything that is not a versioned GUI artifact stay untouched.
  const { ordered } = groupObjects(objects, (object) => {
    if (!object.key.startsWith(prefix)) return null
    return object.key.slice(prefix.length).match(GUI_ARTIFACT)?.[1] ?? null
  })
  const blockmapVersions = new Set(ordered.slice(0, keepBlockmaps).map((group) => group.id))
  const deleted = ordered
    .filter((group) => group.id !== currentVersion)
    .flatMap((group) => group.objects.filter((object) =>
      !(object.key.endsWith('.blockmap') && blockmapVersions.has(group.id))
    ))
  return {
    deletedVersions: [...new Set(ordered
      .filter((group) => group.id !== currentVersion)
      .map((group) => group.id))],
    deleteKeys: deleted.map((object) => object.key),
    deleteBytes: sumBytes(deleted)
  }
}

export function readKeepCount(flags, name, fallback, minimum) {
  if (!flags.has(name)) return fallback
  const raw = String(flags.get(name)).trim()
  const value = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`--${name} must be an integer >= ${minimum}, got: ${raw}`)
  }
  return value
}

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

async function listObjects(config, prefix) {
  const objects = []
  let ContinuationToken
  do {
    const res = await config.client.send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken })
    )
    for (const item of res.Contents ?? []) {
      if (!item.Key) continue
      objects.push({
        key: item.Key,
        size: item.Size ?? 0,
        lastModified: item.LastModified ? new Date(item.LastModified).getTime() : 0
      })
    }
    ContinuationToken = res.NextContinuationToken
  } while (ContinuationToken)
  return objects
}

async function readPublishedTag(config, basePath) {
  const key = `${basePath}/latest/latest.json`
  try {
    const res = await config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
    return normalizeTag(String(JSON.parse(await res.Body.transformToString())?.tag ?? ''))
  } catch (error) {
    throw new Error(
      `Refusing to prune: cannot read the published tag from ${key} (${error instanceof Error ? error.message : String(error)})`
    )
  }
}

export async function pruneReleases({ flags, dryRun }) {
  const channel = readChannel(flags)
  const keep = readKeepCount(flags, 'keep', DEFAULT_KEEP_RELEASES[channel], 1)
  const keepBlockmaps = readKeepCount(flags, 'keep-blockmaps', DEFAULT_KEEP_BLOCKMAPS, 0)
  const config = readConfig({ dryRun: false })
  const basePath = channelBasePath(config.prefix, channel)
  const latestBases = channel === 'stable' ? [basePath, config.prefix] : [basePath]

  const publishedTags = new Map()
  for (const latestBase of latestBases) {
    publishedTags.set(latestBase, await readPublishedTag(config, latestBase))
  }
  if (flags.has('tag')) {
    const tag = normalizeTag(requireFlag(flags, 'tag'))
    if (publishedTags.get(basePath) !== tag) {
      throw new Error(
        `Refusing to prune: ${channel} latest points at ${publishedTags.get(basePath)}, expected ${tag}`
      )
    }
  }

  console.log(
    `Pruning ${PRODUCT_NAME} ${channel} releases on R2 ` +
      `(keep ${keep} archived release(s), blockmaps for ${keepBlockmaps} version(s))`
  )
  const releasesPrefix = `${basePath}/releases/`
  const archive = planReleaseArchivePrune({
    prefix: releasesPrefix,
    objects: await listObjects(config, releasesPrefix),
    keep,
    protectedTags: new Set(publishedTags.values())
  })
  console.log(`${releasesPrefix}: keeping ${archive.keptTags.join(', ') || '(none)'}`)
  for (const { tag, bytes } of archive.deletedTags) {
    console.log(`  delete ${tag} (${formatBytes(bytes)})`)
  }
  if (archive.unrecognized.length) {
    console.log(`  left ${archive.unrecognized.length} unrecognized object(s) untouched`)
  }

  const deleteKeys = [...archive.deleteKeys]
  let deleteBytes = archive.deleteBytes
  for (const [latestBase, tag] of publishedTags) {
    const latestPrefix = `${latestBase}/latest/`
    const latest = planLatestPrune({
      prefix: latestPrefix,
      objects: await listObjects(config, latestPrefix),
      currentVersion: artifactVersionForTag(tag),
      keepBlockmaps
    })
    console.log(
      `${latestPrefix}: published ${tag}; deleting ${latest.deleteKeys.length} old artifact file(s) ` +
        `(${formatBytes(latest.deleteBytes)}) from ${latest.deletedVersions.length} older version(s)`
    )
    deleteKeys.push(...latest.deleteKeys)
    deleteBytes += latest.deleteBytes
  }

  if (dryRun) {
    for (const key of deleteKeys) console.log(`[dry-run] delete s3://${config.bucket}/${key}`)
    console.log(`[dry-run] Would delete ${deleteKeys.length} object(s), freeing ${formatBytes(deleteBytes)}`)
    return
  }
  const concurrency = positiveInt(process.env.R2_DELETE_CONCURRENCY, 8)
  await runConcurrently(deleteKeys, concurrency, async (key) => {
    await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
  })
  console.log(`Deleted ${deleteKeys.length} object(s), freed ${formatBytes(deleteBytes)}`)
}
