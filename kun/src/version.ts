import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type KunBuildMetadata = {
  version: 1
  buildId?: string
  serviceVersion: string
  channel: 'stable' | 'frontier'
  artifactVersion: string
  nodeVersion: string
}

type PackageManifest = {
  version?: unknown
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const ARTIFACT_VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]*$/
// Daily frontier builds stamp this so updaters never rank them above a stable release.
const DAILY_DEV_VERSION = /^0\.0\.0-dev-\d{8}-\d{4}$/

export const DEFAULT_KUN_CHANNEL = 'stable' as const

export const KUN_PACKAGE_VERSION = packageVersion()
export const KUN_BUILD_METADATA = loadBuildMetadata()
export const KUN_VERSION = KUN_BUILD_METADATA.serviceVersion
export const KUN_RELEASE_CHANNEL = KUN_BUILD_METADATA.channel

/**
 * Version an `engines.kun` range is checked against. A daily dev build is cut from develop, so it
 * counts as the release line in kun/package.json instead of 0.0.0. Every other version, stable or
 * prerelease, is checked as-is.
 */
export function kunEngineVersion(kunVersion: string, releaseLineVersion = KUN_PACKAGE_VERSION): string {
  return DAILY_DEV_VERSION.test(kunVersion) ? releaseLineVersion : kunVersion
}

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require('../package.json') as PackageManifest
    return typeof manifest.version === 'string' && SEMVER.test(manifest.version)
      ? manifest.version
      : '0.1.0'
  } catch {
    return '0.1.0'
  }
}

function loadBuildMetadata(): KunBuildMetadata {
  try {
    const manifestPath = fileURLToPath(new URL('./runtime-build.json', import.meta.url))
    const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
    const serviceVersion = typeof value.serviceVersion === 'string' && SEMVER.test(value.serviceVersion)
      ? value.serviceVersion
      : KUN_PACKAGE_VERSION
    const channel = value.channel === 'frontier' ? 'frontier' : DEFAULT_KUN_CHANNEL
    const artifactVersion = typeof value.artifactVersion === 'string' &&
      ARTIFACT_VERSION.test(value.artifactVersion)
      ? value.artifactVersion
      : serviceVersion
    const nodeVersion = typeof value.nodeVersion === 'string' && SEMVER.test(value.nodeVersion)
      ? value.nodeVersion
      : process.versions.node
    return {
      version: 1,
      ...(typeof value.buildId === 'string' ? { buildId: value.buildId } : {}),
      serviceVersion,
      channel,
      artifactVersion,
      nodeVersion
    }
  } catch {
    return {
      version: 1,
      serviceVersion: KUN_PACKAGE_VERSION,
      channel: DEFAULT_KUN_CHANNEL,
      artifactVersion: KUN_PACKAGE_VERSION,
      nodeVersion: process.versions.node
    }
  }
}
