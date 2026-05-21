import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix as pathPosix, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type {
  DeepseekUpdateInfo,
  DeepseekUpdateInstallResult
} from '../shared/deepseek-update'
import {
  getDeepseekTuiUpdatePackageRoot,
  getDeepseekTuiUpdateTempRoot,
  getManagedDeepseekPackage,
  resolveDeepseekExecutableFromPackageJson,
  setActiveDeepseekTuiUpdate
} from './resolve-deepseek-binary'

type NpmLatestMetadata = {
  version: string
  tarballUrl: string
  integrity: string | null
  registryUrl: string
}

type InstallPackageResult =
  | { ok: true; version: string; binaryPath: string }
  | Exclude<DeepseekUpdateInstallResult, { ok: true }>

const DEFAULT_REGISTRIES = [
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com'
]

function registryBaseUrls(): string[] {
  const urls: string[] = []
  const custom = process.env.DEEPSEEK_GUI_NPM_REGISTRY?.trim()
  if (custom) {
    const trimmed = custom.replace(/\/+$/, '')
    if (/\/deepseek-tui\/latest$/.test(trimmed)) {
      urls.push(trimmed.replace(/\/deepseek-tui\/latest$/, ''))
    } else if (/\/deepseek-tui$/.test(trimmed)) {
      urls.push(trimmed.replace(/\/deepseek-tui$/, ''))
    } else {
      urls.push(trimmed)
    }
  }
  for (const registry of DEFAULT_REGISTRIES) {
    urls.push(registry)
  }
  return [...new Set(urls)]
}

function registryLatestUrls(): string[] {
  return registryBaseUrls().map((registry) => `${registry}/deepseek-tui/latest`)
}

function tarballUrls(version: string, primaryUrl: string): string[] {
  return [
    primaryUrl,
    ...registryBaseUrls().map((registry) => `${registry}/deepseek-tui/-/deepseek-tui-${version}.tgz`)
  ].filter((url, index, urls) => urls.indexOf(url) === index)
}

function parseVersionParts(version: string): {
  main: [number, number, number]
  prerelease: string | null
} | null {
  const trimmed = version.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(trimmed)
  if (!match) return null
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null
  }
}

function compareVersions(a: string, b: string): number {
  const parsedA = parseVersionParts(a)
  const parsedB = parseVersionParts(b)
  if (!parsedA || !parsedB) return a.localeCompare(b, undefined, { numeric: true })

  for (let i = 0; i < 3; i += 1) {
    const diff = parsedA.main[i] - parsedB.main[i]
    if (diff !== 0) return diff
  }
  if (parsedA.prerelease === parsedB.prerelease) return 0
  if (!parsedA.prerelease) return 1
  if (!parsedB.prerelease) return -1
  return parsedA.prerelease.localeCompare(parsedB.prerelease, undefined, { numeric: true })
}

function updateAvailable(currentVersion: string | null, latestVersion: string): boolean {
  if (!currentVersion) return true
  return compareVersions(latestVersion, currentVersion) > 0
}

async function fetchLatestMetadata(): Promise<NpmLatestMetadata> {
  const errors: string[] = []

  for (const registryUrl of registryLatestUrls()) {
    try {
      const res = await fetch(registryUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000)
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const raw = (await res.json()) as {
        version?: unknown
        dist?: { tarball?: unknown; integrity?: unknown }
      }
      if (typeof raw.version !== 'string' || !raw.version.trim()) {
        throw new Error('registry response is missing version')
      }
      if (typeof raw.dist?.tarball !== 'string' || !raw.dist.tarball.trim()) {
        throw new Error('registry response is missing tarball')
      }
      return {
        version: raw.version.trim(),
        tarballUrl: raw.dist.tarball.trim(),
        integrity: typeof raw.dist.integrity === 'string' ? raw.dist.integrity.trim() : null,
        registryUrl
      }
    } catch (e) {
      errors.push(`${registryUrl}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  throw new Error(errors.join('; ') || 'Could not query npm registry.')
}

export async function checkDeepseekTuiUpdate(userBinaryPath: string): Promise<DeepseekUpdateInfo> {
  let managedPackage
  try {
    managedPackage = getManagedDeepseekPackage(userBinaryPath)
  } catch (e) {
    return {
      ok: false,
      managed: true,
      currentVersion: null,
      message: e instanceof Error ? e.message : String(e)
    }
  }

  if (!managedPackage) {
    return {
      ok: true,
      managed: false,
      reason: 'custom_binary',
      binaryPath: userBinaryPath.trim(),
      updateAvailable: false
    }
  }

  try {
    const latest = await fetchLatestMetadata()
    return {
      ok: true,
      managed: true,
      currentVersion: managedPackage.version,
      currentSource: managedPackage.source,
      latestVersion: latest.version,
      updateAvailable: updateAvailable(managedPackage.version, latest.version),
      registryUrl: latest.registryUrl,
      tarballUrl: latest.tarballUrl,
      integrity: latest.integrity
    }
  } catch (e) {
    return {
      ok: false,
      managed: true,
      currentVersion: managedPackage.version,
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) {
    throw new Error(`Download failed with HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

async function downloadTarball(version: string, primaryUrl: string): Promise<Buffer> {
  const errors: string[] = []
  for (const url of tarballUrls(version, primaryUrl)) {
    try {
      return await downloadUrl(url)
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(errors.join('; ') || 'Could not download deepseek-tui package.')
}

function verifyIntegrity(buffer: Buffer, integrity: string | null): void {
  if (!integrity) return
  const sha512 = integrity
    .split(/\s+/)
    .map((part) => part.trim())
    .find((part) => part.startsWith('sha512-'))
  if (!sha512) return
  const expected = sha512.slice('sha512-'.length)
  const actual = createHash('sha512').update(buffer).digest('base64')
  if (actual !== expected) {
    throw new Error('Downloaded package failed npm integrity verification.')
  }
}

function tarString(buffer: Buffer, start: number, length: number): string {
  const end = buffer.indexOf(0, start)
  const sliceEnd = end === -1 || end > start + length ? start + length : end
  return buffer.subarray(start, sliceEnd).toString('utf8').trim()
}

function tarOctal(buffer: Buffer, start: number, length: number): number {
  const raw = tarString(buffer, start, length).replace(/\0/g, '').trim()
  if (!raw) return 0
  return Number.parseInt(raw, 8)
}

function isZeroBlock(buffer: Buffer): boolean {
  for (const byte of buffer) {
    if (byte !== 0) return false
  }
  return true
}

function safePackagePath(name: string): string | null {
  const withoutPrefix = name.replace(/^package\/?/, '')
  if (!withoutPrefix) return null
  if (withoutPrefix.includes('\\')) {
    throw new Error(`Unsafe path in npm package: ${name}`)
  }
  const normalized = pathPosix.normalize(withoutPrefix)
  if (
    normalized === '.' ||
    pathPosix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Unsafe path in npm package: ${name}`)
  }
  return normalized.split('/').join(sep)
}

async function extractNpmTarball(tgz: Buffer, packageRoot: string): Promise<void> {
  const tar = gunzipSync(tgz)
  let offset = 0

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (isZeroBlock(header)) break

    const name = tarString(header, 0, 100)
    const mode = tarOctal(header, 100, 8)
    const size = tarOctal(header, 124, 12)
    const type = tarString(header, 156, 1)
    const prefix = tarString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name

    offset += 512
    const body = tar.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512

    const relativePath = safePackagePath(fullName)
    if (!relativePath) continue

    const target = join(packageRoot, relativePath)
    if (type === '5') {
      await mkdir(target, { recursive: true })
      continue
    }
    if (type && type !== '0') {
      continue
    }

    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)
    if (mode & 0o111 && process.platform !== 'win32') {
      await chmod(target, mode & 0o777)
    }
  }
}

async function readExtractedVersion(packageJsonPath: string): Promise<string> {
  const parsed = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: unknown }
  if (typeof parsed.version !== 'string' || !parsed.version.trim()) {
    throw new Error('Extracted package.json is missing a version.')
  }
  return parsed.version.trim()
}

export async function installDeepseekTuiUpdatePackage(
  userBinaryPath: string
): Promise<InstallPackageResult> {
  const info = await checkDeepseekTuiUpdate(userBinaryPath)
  if (!info.ok) {
    return { ok: false, reason: 'check_failed', message: info.message }
  }
  if (!info.managed) {
    return {
      ok: false,
      reason: 'custom_binary',
      message: 'Automatic updates are only available for the managed deepseek-tui runtime.'
    }
  }
  if (!info.updateAvailable) {
    return {
      ok: false,
      reason: 'up_to_date',
      message: `deepseek-tui ${info.currentVersion ?? info.latestVersion} is already up to date.`
    }
  }

  const tempVersionRoot = join(getDeepseekTuiUpdateTempRoot(), `${info.latestVersion}-${randomUUID()}`)
  const tempPackageRoot = join(tempVersionRoot, 'node_modules', 'deepseek-tui')
  const targetPackageRoot = getDeepseekTuiUpdatePackageRoot(info.latestVersion)
  const targetPackageJson = join(targetPackageRoot, 'package.json')
  let stage: 'download' | 'install' = 'download'

  try {
    await rm(tempVersionRoot, { recursive: true, force: true })
    await mkdir(tempPackageRoot, { recursive: true })

    const tarball = await downloadTarball(info.latestVersion, info.tarballUrl)
    verifyIntegrity(tarball, info.integrity)
    stage = 'install'
    await extractNpmTarball(tarball, tempPackageRoot)

    const extractedVersion = await readExtractedVersion(join(tempPackageRoot, 'package.json'))
    if (extractedVersion !== info.latestVersion) {
      throw new Error(
        `Downloaded package version mismatch: expected ${info.latestVersion}, got ${extractedVersion}.`
      )
    }

    await rm(targetPackageRoot, { recursive: true, force: true })
    await mkdir(dirname(targetPackageRoot), { recursive: true })
    await rename(tempPackageRoot, targetPackageRoot)
    await rm(tempVersionRoot, { recursive: true, force: true })

    const binaryPath = await resolveDeepseekExecutableFromPackageJson(targetPackageJson)
    setActiveDeepseekTuiUpdate(info.latestVersion)
    return { ok: true, version: info.latestVersion, binaryPath }
  } catch (e) {
    await rm(tempVersionRoot, { recursive: true, force: true }).catch(() => undefined)
    return {
      ok: false,
      reason: stage === 'download' ? 'download_failed' : 'install_failed',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}
