import { readFileSync } from 'node:fs'

export type NpmDistribution = { name: string; version: string; windowsPackage?: string }

/** Read only the installation's manifest; environment flags cannot change its channel. */
export function readNpmDistribution(manifestUrl = new URL('../../package.json', import.meta.url)): NpmDistribution | undefined {
  try {
    const value = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
      name?: unknown; version?: unknown; kunNpm?: { kind?: unknown; windowsPackage?: unknown }
    }
    if (value.kunNpm?.kind !== 'npm' || typeof value.name !== 'string' || typeof value.version !== 'string') return undefined
    return { name: value.name, version: value.version,
      ...(typeof value.kunNpm.windowsPackage === 'string' ? { windowsPackage: value.kunNpm.windowsPackage } : {}) }
  } catch { return undefined }
}

export function isNpmDistribution(): boolean { return Boolean(readNpmDistribution()) }

export function npmUpdateGuidance(distribution: NpmDistribution): string {
  return `This is the npm distribution (${distribution.name}@${distribution.version}).\n` +
    `Global installation: npm install -g ${distribution.name}@<version>\n` +
    `Project installation: npm install ${distribution.name}@<version>\n` +
    'Exit the owned Kun session before updating. User data is kept separately from this package.\n'
}
