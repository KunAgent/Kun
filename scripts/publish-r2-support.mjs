import { S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PRODUCT_NAME = 'Kun'
export const DEFAULT_RELEASE_PREFIX = 'deepseek-gui'
export const DEFAULT_RELEASE_CHANNEL = 'frontier'
export const PLATFORMS = ['mac', 'win', 'linux']
export const RELEASE_CHANNELS = ['frontier', 'stable']
export const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
export const ROOT = resolve(SCRIPT_DIR, '..')

export const PLATFORM_SPECS = {
  mac: {
    updateFile: 'latest-mac.yml',
    assetPattern: /^Kun-.+-mac-(arm64|x64)\.(dmg|zip)(\.blockmap)?$/
  },
  win: {
    updateFile: 'latest.yml',
    assetPattern: /^Kun-.+-win-x64\.exe(\.blockmap)?$/
  },
  linux: {
    updateFile: 'latest-linux.yml',
    updateFiles: ['latest-linux.yml', 'latest-linux-arm64.yml'],
    // Auto-update stays on AppImage; deb is a Debian-family installer sidecar.
    assetPattern: /^Kun-.+-linux-(?:(?:x86_64|arm64)\.AppImage(\.blockmap)?|(?:amd64|arm64)\.deb)$/
  }
}

export function usage() {
  console.log(`Usage:
  node scripts/publish-r2.mjs upload --platform mac|win|linux --tag vX.Y.Z [--channel frontier|stable] [--dry-run]
  node scripts/publish-r2.mjs promote --tag vX.Y.Z [--channel frontier|stable] [--platforms mac,win,linux] [--require-all-platforms] [--dry-run]

If --platforms is omitted, promote uses the platform manifests already uploaded for that tag.
If --channel is omitted, the default channel is frontier.
Stable and Daily CI require all three GUI platform manifests before latest promotion.

Environment:
  KUN_RELEASE_ENV=scripts/release.local.env (legacy DEEPSEEK_GUI_RELEASE_ENV is also accepted)
  RELEASE_CHANNEL=frontier|stable
  R2_BUCKET or S3_BUCKET
  R2_ENDPOINT or S3_ENDPOINT
  R2_ACCESS_KEY_ID or S3_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY or S3_SECRET_ACCESS_KEY
  R2_PUBLIC_BASE_URL
  R2_RELEASE_PREFIX=deepseek-gui
`)
}

export function parseEnvFile(content) {
  const values = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values.set(match[1], value)
  }
  return values
}

export function loadLocalEnv() {
  const configured = process.env.KUN_RELEASE_ENV?.trim() || process.env.DEEPSEEK_GUI_RELEASE_ENV?.trim()
  const candidates = [
    configured,
    join(ROOT, 'scripts', 'release.local.env'),
    join(ROOT, 'release.local.env')
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const values = parseEnvFile(readFileSync(candidate, 'utf8'))
    for (const [key, value] of values) {
      if (!process.env[key]) process.env[key] = value
    }
    console.log(`Loaded local release config: ${candidate}`)
    return candidate
  }
  return null
}

export function readArgs(argv) {
  const flags = new Map()
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (
      name === 'dry-run' ||
      name === 'help' ||
      name === 'h' ||
      name === 'stable' ||
      name === 'frontier' ||
      name === 'require-all-platforms'
    ) {
      flags.set(name, true)
      continue
    }
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${name}`)
    }
    flags.set(name, value)
    i += 1
  }
  return { command: positionals[0], flags }
}

export function requireFlag(flags, name) {
  const value = flags.get(name)
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required flag --${name}`)
  }
  return value.trim()
}

export function normalizeTag(raw) {
  const tag = raw.trim()
  if (!/^v\d+\.\d+\.\d+$/.test(tag) && !/^dev-\d{8}\.\d{4}$/.test(tag)) {
    throw new Error(`Tag must look like vX.Y.Z or dev-YYYYMMDD.HHMM, got: ${raw}`)
  }
  return tag
}

export function releaseVersionForTag(tag) {
  if (tag.startsWith('v')) return tag.slice(1)
  const dev = tag.match(/^dev-(\d{8})\.(\d{4})$/)
  if (dev) return `0.0.0-dev-${dev[1]}-${dev[2]}`
  throw new Error(`Unsupported release tag: ${tag}`)
}

export function artifactVersionForTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag.slice('dev-'.length)
}

export function normalizeChannel(raw) {
  const channel = String(raw || '').trim() || DEFAULT_RELEASE_CHANNEL
  if (!RELEASE_CHANNELS.includes(channel)) {
    throw new Error(`Release channel must be one of: ${RELEASE_CHANNELS.join(', ')}`)
  }
  return channel
}

export function readChannel(flags) {
  if (flags.has('stable') && flags.has('frontier')) {
    throw new Error('Use only one of --stable or --frontier.')
  }
  if (flags.has('stable')) return 'stable'
  if (flags.has('frontier')) return 'frontier'
  return normalizeChannel(
    flags.get('channel') ||
      process.env.RELEASE_CHANNEL ||
      process.env.KUN_UPDATE_CHANNEL ||
      process.env.DEEPSEEK_GUI_UPDATE_CHANNEL ||
      DEFAULT_RELEASE_CHANNEL
  )
}

export function positiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw || '').trim(), 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export async function runConcurrently(items, limit, worker) {
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        await worker(item)
      }
    })
  )
}

export function normalizeBaseUrl(raw) {
  return raw.trim().replace(/\/+$/, '')
}

export function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '')
}

export function joinUrl(base, ...parts) {
  return [normalizeBaseUrl(base), ...parts.map((p) => trimSlashes(p)).filter(Boolean)].join('/')
}

export function channelBasePath(prefix, channel) {
  return `${prefix}/channels/${channel}`
}

export function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

export function normalizeS3Endpoint(rawEndpoint, bucket) {
  const value = rawEndpoint.trim()
  if (!value) return ''
  const url = new URL(value)
  const normalizedBucket = bucket.trim()
  const path = url.pathname.replace(/\/+$/, '')
  if (normalizedBucket && path === `/${normalizedBucket}`) {
    url.pathname = ''
  }
  return url.toString().replace(/\/+$/, '')
}

export function readConfig({ dryRun = false } = {}) {
  loadLocalEnv()
  const accountId = firstEnv('R2_ACCOUNT_ID')
  const bucket = firstEnv('R2_BUCKET', 'S3_BUCKET')
  const accessKeyId = firstEnv('R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
  const secretAccessKey = firstEnv(
    'R2_SECRET_ACCESS_KEY',
    'S3_SECRET_ACCESS_KEY',
    'AWS_SECRET_ACCESS_KEY'
  )
  const endpoint = normalizeS3Endpoint(firstEnv('R2_ENDPOINT', 'S3_ENDPOINT'), bucket)
  const publicBaseUrl = firstEnv('R2_PUBLIC_BASE_URL', 'PUBLIC_DOWNLOAD_BASE_URL')
  const prefix = trimSlashes(firstEnv('R2_RELEASE_PREFIX') || DEFAULT_RELEASE_PREFIX)

  if (!publicBaseUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is required so manifests can contain public download URLs.')
  }
  if (!dryRun && /(^|\.)downloads\.example\.com$/i.test(new URL(publicBaseUrl).hostname)) {
    throw new Error('Replace the placeholder R2_PUBLIC_BASE_URL with your real R2 custom domain.')
  }

  if (!dryRun) {
    const missing = []
    if (!endpoint && !accountId) missing.push('R2_ENDPOINT or R2_ACCOUNT_ID')
    if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID or S3_ACCESS_KEY_ID')
    if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY or S3_SECRET_ACCESS_KEY')
    if (!bucket) missing.push('R2_BUCKET or S3_BUCKET')
    if (missing.length) throw new Error(`Missing environment variable(s): ${missing.join(', ')}`)
  }

  const resolvedEndpoint = endpoint || `https://${accountId}.r2.cloudflarestorage.com`
  const client = dryRun
    ? null
    : new S3Client({
        region: 'auto',
        endpoint: resolvedEndpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true
      })

  return { bucket, publicBaseUrl: normalizeBaseUrl(publicBaseUrl), prefix, client }
}

export function quoteScalar(value) {
  const trimmed = value.trim()
  return trimmed.replace(/^['"]|['"]$/g, '')
}

export function parseUpdateYml(source) {
  const version = quoteScalar(source.match(/^version:\s*(.+)$/m)?.[1] ?? '')
  const releaseDate = quoteScalar(source.match(/^releaseDate:\s*(.+)$/m)?.[1] ?? '')
  const files = []
  let current = null

  for (const line of source.split(/\r?\n/)) {
    const url = line.match(/^\s*-\s+url:\s*(.+)$/)
    if (url) {
      current = { url: quoteScalar(url[1]), sha512: '', size: 0 }
      files.push(current)
      continue
    }
    if (!current) continue
    const prop = line.match(/^\s+(sha512|size|blockMapSize):\s*(.+)$/)
    if (!prop) continue
    const [, key, value] = prop
    current[key] = key === 'sha512' ? quoteScalar(value) : Number.parseInt(value, 10) || 0
  }

  if (!version) throw new Error('Update metadata is missing version.')
  if (!files.length) throw new Error('Update metadata is missing files.')
  return { version, releaseDate, files }
}

export async function hashFile(path, algorithm, encoding) {
  const hash = createHash(algorithm)
  await new Promise((resolvePromise, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolvePromise)
  })
  return hash.digest(encoding)
}

export function contentType(fileName) {
  if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return 'text/yaml; charset=utf-8'
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8'
  if (fileName.endsWith('.zip')) return 'application/zip'
  if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) return 'application/gzip'
  if (fileName.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (fileName.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable'
  if (fileName.endsWith('.deb')) return 'application/vnd.debian.binary-package'
  return 'application/octet-stream'
}

export function cacheControlFor(key) {
  if (/\/latest\/latest(?:-[\w]+)?\.(?:json|yml)$/.test(key)) {
    return 'public, max-age=60, must-revalidate'
  }
  if (/\/latest\/.+\.(?:dmg|zip|exe|AppImage|deb|blockmap)$/.test(key)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=31536000, immutable'
}

export function classifyDownload(fileName, platform) {
  const extension = fileName.endsWith('.AppImage')
    ? 'AppImage'
    : fileName.endsWith('.deb')
      ? 'deb'
      : fileName.endsWith('.dmg')
        ? 'dmg'
        : fileName.endsWith('.zip')
          ? 'zip'
          : fileName.endsWith('.exe')
            ? 'exe'
            : 'bin'

  if (platform === 'mac') {
    const arch = fileName.includes('-arm64.') ? 'arm64' : 'x64'
    return {
      platform,
      arch,
      format: extension,
      label: arch === 'arm64' ? `macOS Apple Silicon ${extension.toUpperCase()}` : `macOS Intel ${extension.toUpperCase()}`
    }
  }
  if (platform === 'win') {
    return { platform, arch: 'x64', format: extension, label: 'Windows x64 installer' }
  }
  if (extension === 'deb') {
    const arch = fileName.includes('-arm64.') ? 'arm64' : 'x64'
    return { platform, arch, format: extension, label: `Linux ${arch} deb` }
  }
  const arch = fileName.includes('-arm64.') ? 'arm64' : 'x64'
  return { platform, arch, format: extension, label: `Linux ${arch} AppImage` }
}

export function collectRequiredSidecarAssets({ entries, platform, tagVersion }) {
  if (platform !== 'linux') return []

  const expected = [
    `Kun-${tagVersion}-linux-amd64.deb`,
    `Kun-${tagVersion}-linux-arm64.deb`
  ]
  const candidates = entries.filter((name) => /^Kun-.+-linux-(?:amd64|arm64)\.deb$/.test(name)).sort()
  if (candidates.length !== expected.length || candidates.some((name, index) => name !== expected[index])) {
    throw new Error(
      `Expected Linux deb sidecars ${expected.join(', ')}, ` +
      `found ${candidates.length}: ${candidates.join(', ') || '(none)'}`
    )
  }
  return candidates
}
