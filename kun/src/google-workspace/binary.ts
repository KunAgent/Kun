import { createHash } from 'node:crypto'
import { readFile, lstat, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOOGLE_WORKSPACE_VERSION } from './types.js'

export type GoogleWorkspaceBinary = { path: string; version: string }
export function googleWorkspaceBundleRoot(moduleUrl = import.meta.url): string {
  const appRoot = resolve(dirname(fileURLToPath(moduleUrl)), '../../..')
  return basename(appRoot) === 'app.asar.unpacked'
    ? join(dirname(appRoot), 'google-workspace')
    : join(appRoot, 'resources', 'google-workspace')
}
/** Only the shipped bundle is accepted. No PATH, user configuration or env override. */
export async function resolveGoogleWorkspaceBinary(
  root = googleWorkspaceBundleRoot(), platform = process.platform, arch = process.arch,
  packaged = basename(resolve(dirname(fileURLToPath(import.meta.url)), '../../..')) === 'app.asar.unpacked'
): Promise<GoogleWorkspaceBinary> {
  const manifest = await readBundleMetadata(join(root, 'manifest.json'))
  if (manifest.schemaVersion !== 1 || manifest.version !== GOOGLE_WORKSPACE_VERSION || manifest.releaseTag !== `v${GOOGLE_WORKSPACE_VERSION}`) {
    throw new Error('Bundled Google Workspace manifest version mismatch')
  }
  const assets = manifest.assets && typeof manifest.assets === 'object' ? manifest.assets as Record<string, Record<string, unknown>> : {}
  const asset = assets[`${platform}-${arch}`]
  if (!asset || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) || (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 64 * 1024 * 1024)) {
    throw new Error('Google Workspace is not bundled for this platform')
  }
  const binaryDir = packaged ? root : join(root, 'current')
  const selected = await readBundleMetadata(join(binaryDir, 'selected.json'))
  if (selected.schemaVersion !== 1 || selected.releaseTag !== manifest.releaseTag || selected.asset !== asset.name || selected.version !== GOOGLE_WORKSPACE_VERSION || selected.platform !== platform ||
      selected.arch !== arch || selected.sha256 !== asset.sha256 || selected.size !== asset.size) {
    throw new Error('Bundled Google Workspace selection mismatch')
  }
  const path = join(binaryDir, platform === 'win32' ? 'gws.exe' : 'gws')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      await realpath(path) !== path) throw new Error('Unsafe bundled Google Workspace executable')
  const expectedSize = packaged && selected.packagedSha256 ? selected.packagedSize : asset.size
  if (typeof expectedSize !== 'number' || expectedSize <= 0 || expectedSize > 64 * 1024 * 1024 || info.size !== expectedSize) {
    throw new Error('Bundled Google Workspace checksum mismatch')
  }
  const hash = createHash('sha256').update(await readFile(path)).digest('hex')
  const expected = packaged && typeof selected.packagedSha256 === 'string'
    ? selected.packagedSha256 : asset.sha256
  if (!/^[a-f0-9]{64}$/.test(expected) || hash !== expected ||
      info.size !== (packaged && selected.packagedSha256 ? selected.packagedSize : asset.size)) {
    throw new Error('Bundled Google Workspace checksum mismatch')
  }
  return { path, version: GOOGLE_WORKSPACE_VERSION }
}

async function readBundleMetadata(path: string): Promise<Record<string, unknown>> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64 * 1024 || await realpath(path) !== path) {
    throw new Error('Unsafe Google Workspace bundle metadata')
  }
  return JSON.parse(await readFile(path, 'utf8'))
}
