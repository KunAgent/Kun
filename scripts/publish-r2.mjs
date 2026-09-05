#!/usr/bin/env node
import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLATFORMS,
  PLATFORM_SPECS,
  PRODUCT_NAME,
  ROOT,
  artifactVersionForTag,
  cacheControlFor,
  channelBasePath,
  classifyDownload,
  collectRequiredSidecarAssets,
  contentType,
  hashFile,
  joinUrl,
  normalizeTag,
  parseUpdateYml,
  positiveInt,
  readArgs,
  readChannel,
  readConfig,
  releaseVersionForTag,
  requireFlag,
  runConcurrently,
  usage
} from './publish-r2-support.mjs'

export {
  artifactVersionForTag,
  collectRequiredSidecarAssets,
  releaseVersionForTag
} from './publish-r2-support.mjs'

export async function collectPlatformRelease({ distDir, platform, tag, channel, config }) {
  const spec = PLATFORM_SPECS[platform]
  if (!spec) throw new Error(`Unsupported platform: ${platform}`)

  const entries = await readdir(distDir)
  const updateFiles = spec.updateFiles ?? [spec.updateFile]
  const updateDocuments = await Promise.all(updateFiles.map(async (fileName) => ({
    fileName,
    metadata: parseUpdateYml(await readFile(join(distDir, fileName), 'utf8'))
  })))
  const releaseVersion = releaseVersionForTag(tag)
  for (const document of updateDocuments) {
    if (document.metadata.version !== releaseVersion) {
      throw new Error(
        `${document.fileName} version ${document.metadata.version} does not match ${tag}. Rebuild with KUN_APP_VERSION=${releaseVersion} (legacy DEEPSEEK_GUI_APP_VERSION is also accepted).`
      )
    }
  }

  const referenced = new Set(updateDocuments.flatMap(({ metadata }) =>
    metadata.files.map((file) => basename(file.url))
  ))
  const sidecarAssets = collectRequiredSidecarAssets({
    entries,
    platform,
    tagVersion: artifactVersionForTag(tag)
  })
  const assets = entries.filter((name) => spec.assetPattern.test(name))
  for (const name of referenced) {
    if (!entries.includes(name)) {
      throw new Error(`${spec.updateFile} references ${name}, but it was not found in ${distDir}`)
    }
  }

  const fileNames = Array.from(new Set([...updateFiles, ...assets, ...referenced])).sort()
  const files = []
  const downloadByName = new Map(updateDocuments.flatMap(({ metadata }) =>
    metadata.files.map((file) => [basename(file.url), file])
  ))

  for (const fileName of fileNames) {
    const path = join(distDir, fileName)
    const info = await stat(path)
    if (!info.isFile()) continue
    const basePath = channelBasePath(config.prefix, channel)
    const archiveKey = `${basePath}/releases/${tag}/${fileName}`
    const sha256 = await hashFile(path, 'sha256', 'hex')
    const sha512 = await hashFile(path, 'sha512', 'base64')
    files.push({
      fileName,
      path,
      key: archiveKey,
      size: info.size,
      sha256,
      sha512,
      contentType: contentType(fileName),
      updateMetadata: updateFiles.includes(fileName),
      // deb is outside electron-updater metadata but is still a public installer.
      downloadable: downloadByName.has(fileName) || fileName.endsWith('.deb')
    })
  }

  const filesByName = new Map(files.map((file) => [file.fileName, file]))
  const updateDownloads = [...downloadByName.values()].map((file) => {
    const fileName = basename(file.url)
    const local = filesByName.get(fileName)
    if (!local) throw new Error(`Missing collected file: ${fileName}`)
    return {
      ...classifyDownload(fileName, platform),
      fileName,
      size: local.size,
      sha256: local.sha256,
      sha512: file.sha512 || local.sha512,
      blockMapSize: file.blockMapSize,
      archiveUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'releases', tag, fileName),
      latestUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'latest', fileName)
    }
  })
  const sidecarDownloads = sidecarAssets
    .filter((fileName) => !downloadByName.has(fileName))
    .sort()
    .map((fileName) => {
      const local = filesByName.get(fileName)
      if (!local) throw new Error(`Missing collected file: ${fileName}`)
      return {
        ...classifyDownload(fileName, platform),
        fileName,
        size: local.size,
        sha256: local.sha256,
        sha512: local.sha512,
        archiveUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'releases', tag, fileName),
        latestUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'latest', fileName)
      }
    })
  const downloads = [...updateDownloads, ...sidecarDownloads]

  return {
    schemaVersion: 1,
    productName: PRODUCT_NAME,
    tag,
    channel,
    platform,
    version: releaseVersion,
    releaseDate: updateDocuments.map(({ metadata }) => metadata.releaseDate).filter(Boolean).sort().at(-1),
    generatedAt: new Date().toISOString(),
    updateMetadata: {
      fileName: spec.updateFile,
      archiveUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'releases', tag, spec.updateFile),
      latestUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'latest', spec.updateFile),
      alternates: updateFiles.slice(1).map((fileName) => ({
        fileName,
        archiveUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'releases', tag, fileName),
        latestUrl: joinUrl(config.publicBaseUrl, config.prefix, 'channels', channel, 'latest', fileName)
      }))
    },
    files,
    downloads
  }
}

async function putObject({ config, key, body, contentType: type, cacheControl, contentLength, dryRun }) {
  if (dryRun) {
    console.log(`[dry-run] put s3://${config.bucket || '<bucket>'}/${key}`)
    return
  }
  const input = {
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: type,
    CacheControl: cacheControl
  }
  if (typeof contentLength === 'number') input.ContentLength = contentLength
  await config.client.send(new PutObjectCommand(input))
}

async function copyObject({ config, fromKey, toKey, type, dryRun }) {
  if (dryRun) {
    console.log(`[dry-run] copy s3://${config.bucket}/${fromKey} -> s3://${config.bucket}/${toKey}`)
    return
  }
  const copySource = `${config.bucket}/${fromKey}`
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  await config.client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      Key: toKey,
      CopySource: copySource,
      ContentType: type,
      CacheControl: cacheControlFor(toKey),
      MetadataDirective: 'REPLACE'
    })
  )
}

async function uploadPlatform({ flags, dryRun }) {
  const platform = requireFlag(flags, 'platform')
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`--platform must be one of: ${PLATFORMS.join(', ')}`)
  }
  const tag = normalizeTag(requireFlag(flags, 'tag'))
  const channel = readChannel(flags)
  const distDir = resolve(flags.get('dist') || 'dist')
  const config = readConfig({ dryRun })
  const release = await collectPlatformRelease({ distDir, platform, tag, channel, config })

  console.log(
    `Uploading ${PRODUCT_NAME} ${release.version} ${platform} assets to R2 ${channel} archive ${tag}`
  )
  const uploadConcurrency = positiveInt(
    process.env.R2_UPLOAD_CONCURRENCY || process.env.RELEASE_UPLOAD_CONCURRENCY,
    4
  )
  console.log(`Using R2 upload concurrency: ${uploadConcurrency}`)
  await runConcurrently(release.files, uploadConcurrency, async (file) => {
    await putObject({
      config,
      key: file.key,
      body: createReadStream(file.path),
      contentType: file.contentType,
      cacheControl: cacheControlFor(file.key),
      contentLength: file.size,
      dryRun
    })
    console.log(`  ${file.fileName}`)
  })

  const manifestKey = `${channelBasePath(config.prefix, channel)}/releases/${tag}/release-${platform}.json`
  const manifest = JSON.stringify(
    {
      ...release,
      files: release.files.map(({ path: _path, ...file }) => file)
    },
    null,
    2
  )
  await putObject({
    config,
    key: manifestKey,
    body: manifest,
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=31536000, immutable',
    dryRun
  })
  console.log(`  release-${platform}.json`)
}

async function listReleaseKeys(config, tag, channel) {
  const prefix = `${channelBasePath(config.prefix, channel)}/releases/${tag}/`
  const keys = []
  let ContinuationToken
  do {
    const res = await config.client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken
      })
    )
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key)
    }
    ContinuationToken = res.NextContinuationToken
  } while (ContinuationToken)
  return keys
}

async function getJson(config, key) {
  const res = await config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
  const text = await res.Body.transformToString()
  return JSON.parse(text)
}

export function validatePromotionContract({
  tag,
  channel,
  platforms,
  platformManifests,
  requireAllPlatforms
}) {
  const expectedVersion = releaseVersionForTag(tag)
  const platformSet = new Set(platforms)
  if (
    requireAllPlatforms &&
    (
      platformSet.size !== PLATFORMS.length ||
      PLATFORMS.some((platform) => !platformSet.has(platform))
    )
  ) {
    throw new Error('GUI promotion requires mac, win, and linux platform manifests')
  }
  const manifestPlatforms = new Set()
  for (const manifest of platformManifests) {
    if (
      manifest?.version !== expectedVersion ||
      manifest?.tag !== tag ||
      manifest?.channel !== channel ||
      !PLATFORMS.includes(manifest?.platform) ||
      manifestPlatforms.has(manifest.platform) ||
      !Array.isArray(manifest?.files) ||
      !Array.isArray(manifest?.downloads) ||
      manifest.files.some((file) => /^Kun-TUI-/.test(file?.fileName ?? ''))
    ) {
      throw new Error('GUI platform manifest is incompatible with the requested release')
    }
    if (manifest.platform === 'linux') {
      const requiredLinuxFiles = new Set([
        `Kun-${artifactVersionForTag(tag)}-linux-x86_64.AppImage`,
        `Kun-${artifactVersionForTag(tag)}-linux-amd64.deb`,
        `Kun-${artifactVersionForTag(tag)}-linux-arm64.AppImage`,
        `Kun-${artifactVersionForTag(tag)}-linux-arm64.deb`,
        'latest-linux.yml',
        'latest-linux-arm64.yml'
      ])
      for (const file of manifest.files) requiredLinuxFiles.delete(file?.fileName)
      const alternateMetadata = manifest.updateMetadata?.alternates ?? []
      const hasArmMetadata = alternateMetadata.some((entry) => (
        entry?.fileName === 'latest-linux-arm64.yml'
      ))
      if (requiredLinuxFiles.size !== 0 || !hasArmMetadata) {
        throw new Error(
          `Linux GUI manifest is missing required x64/ARM64 release files: ${[...requiredLinuxFiles].join(', ') || 'ARM64 update metadata'}`
        )
      }
    }
    manifestPlatforms.add(manifest.platform)
  }
  if (manifestPlatforms.size !== platformSet.size ||
      [...platformSet].some((platform) => !manifestPlatforms.has(platform))) {
    throw new Error('GUI platform manifests do not match the requested promotion targets')
  }
  return expectedVersion
}

async function promoteRelease({ flags, dryRun }) {
  const tag = normalizeTag(requireFlag(flags, 'tag'))
  const channel = readChannel(flags)
  const requestedPlatforms = flags.has('platforms')
  const platforms = String(flags.get('platforms') || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  for (const platform of platforms) {
    if (!PLATFORMS.includes(platform)) throw new Error(`Unsupported platform in --platforms: ${platform}`)
  }

  const config = readConfig({ dryRun: false })
  const releaseKeys = await listReleaseKeys(config, tag, channel)
  if (!releaseKeys.length) throw new Error(`No archived R2 objects found for ${tag}`)

  if (!requestedPlatforms) {
    for (const platform of PLATFORMS) {
      const key = `${channelBasePath(config.prefix, channel)}/releases/${tag}/release-${platform}.json`
      if (releaseKeys.includes(key)) platforms.push(platform)
    }
  }
  if (!platforms.length) {
    throw new Error(
      `No platform manifests found for ${tag}. Run upload for at least one platform before promoting.`
    )
  }

  const platformManifests = []
  for (const platform of platforms) {
    const key = `${channelBasePath(config.prefix, channel)}/releases/${tag}/release-${platform}.json`
    if (!releaseKeys.includes(key)) {
      throw new Error(`Missing ${key}. Run upload for ${platform} before promoting.`)
    }
    platformManifests.push(await getJson(config, key))
  }
  const version = validatePromotionContract({
    tag,
    channel,
    platforms,
    platformManifests,
    requireAllPlatforms: flags.has('require-all-platforms')
  })
  const allFiles = new Map()
  for (const manifest of platformManifests) {
    for (const file of manifest.files) {
      allFiles.set(file.fileName, file)
    }
  }

  const latestTargets = [{ basePath: channelBasePath(config.prefix, channel), label: `${channel} latest` }]
  if (channel === 'stable') {
    latestTargets.push({ basePath: config.prefix, label: 'legacy stable latest' })
  }

  console.log(`Promoting ${PRODUCT_NAME} ${tag} to R2 ${channel} latest (${platforms.join(', ')})`)
  for (const target of latestTargets) {
    console.log(`Target: ${target.label}`)
    for (const file of allFiles.values()) {
      const toKey = `${target.basePath}/latest/${file.fileName}`
      await copyObject({
        config,
        fromKey: file.key,
        toKey,
        type: file.contentType,
        dryRun
      })
      console.log(`  ${file.fileName}`)
    }
  }

  const releaseDates = platformManifests
    .map((manifest) => manifest.releaseDate)
    .filter(Boolean)
    .sort()
  const releaseDate = releaseDates[releaseDates.length - 1] ?? new Date().toISOString()

  for (const target of latestTargets) {
    const downloads = platformManifests.flatMap((manifest) =>
      manifest.downloads.map((download) => ({
        ...download,
        url: joinUrl(config.publicBaseUrl, target.basePath, 'latest', download.fileName)
      }))
    )

    const latestManifest = {
      schemaVersion: 1,
      productName: PRODUCT_NAME,
      channel,
      version,
      tag,
      releaseDate,
      generatedAt: new Date().toISOString(),
      githubReleaseUrl: `https://github.com/KunAgent/Kun/releases/tag/${tag}`,
      updateBaseUrl: joinUrl(config.publicBaseUrl, target.basePath, 'latest') + '/',
      updateMetadata: Object.fromEntries(
        platformManifests.map((manifest) => [
          manifest.platform,
          {
            fileName: manifest.updateMetadata.fileName,
            url: joinUrl(config.publicBaseUrl, target.basePath, 'latest', manifest.updateMetadata.fileName),
            ...(Array.isArray(manifest.updateMetadata.alternates) && manifest.updateMetadata.alternates.length > 0
              ? {
                  alternates: manifest.updateMetadata.alternates.map((entry) => ({
                    fileName: entry.fileName,
                    url: joinUrl(config.publicBaseUrl, target.basePath, 'latest', entry.fileName)
                  }))
                }
              : {})
          }
        ])
      ),
      downloads,
      components: {
        gui: {
          version,
          platforms: platformManifests.map((manifest) => manifest.platform),
          downloads
        }
      }
    }

    const latestKey = `${target.basePath}/latest/latest.json`
    await putObject({
      config,
      key: latestKey,
      body: JSON.stringify(latestManifest, null, 2),
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=60, must-revalidate',
      dryRun
    })
    console.log(`  ${target.label}/latest.json`)
    console.log(`Latest manifest: ${joinUrl(config.publicBaseUrl, target.basePath, 'latest', 'latest.json')}`)
  }
}

async function main() {
  const { command, flags } = readArgs(process.argv.slice(2))
  if (flags.has('help') || flags.has('h') || !command) {
    usage()
    return
  }
  const dryRun = flags.has('dry-run')

  if (command === 'upload') {
    await uploadPlatform({ flags, dryRun })
    return
  }
  if (command === 'promote') {
    await promoteRelease({ flags, dryRun })
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[publish-r2] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
