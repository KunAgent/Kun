import { createHash, timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

export const AGENT_SDK_MANIFEST_SCHEMA = 1
export const MAX_AGENT_SDK_BINARY_BYTES = 300 * 1024 * 1024
const MAX_JSON_BYTES = 16 * 1024

export type AgentSdkInstallManifest = {
  schemaVersion: 1
  sdkVersion: string
  packageName: string
  platform: string
  arch: string
  binaryName: string
  binarySize: number
  binarySha256: string
  cliVersion: string
  helpProbe: string
  integrity: string
  shasum?: string
  installedAt: string
}

type ActivePointer = {
  schemaVersion: 1
  manifestPath: string
  manifestSha256: string
}

export type ValidAgentSdkInstall = {
  manifest: AgentSdkInstallManifest
  binaryPath: string
  manifestPath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function parseManifest(value: unknown): AgentSdkInstallManifest | undefined {
  if (!isRecord(value)) return undefined
  const required = [
    'schemaVersion', 'sdkVersion', 'packageName', 'platform', 'arch', 'binaryName',
    'binarySize', 'binarySha256', 'cliVersion', 'helpProbe', 'integrity', 'installedAt'
  ] as const
  if (!hasExactKeys(value, required, ['shasum'])) return undefined
  if (value.schemaVersion !== AGENT_SDK_MANIFEST_SCHEMA) return undefined
  if (!boundedString(value.sdkVersion, 64) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.sdkVersion)) return undefined
  if (!boundedString(value.packageName, 160) || !/^@anthropic-ai\/claude-agent-sdk-[a-z0-9-]+$/.test(value.packageName)) return undefined
  if (!boundedString(value.platform, 16) || !boundedString(value.arch, 16)) return undefined
  if (value.binaryName !== 'claude' && value.binaryName !== 'claude.exe') return undefined
  if (!Number.isSafeInteger(value.binarySize) || (value.binarySize as number) <= 0 || (value.binarySize as number) > MAX_AGENT_SDK_BINARY_BYTES) return undefined
  if (!boundedString(value.binarySha256, 64) || !/^[a-f0-9]{64}$/.test(value.binarySha256)) return undefined
  if (!boundedString(value.cliVersion, 256) || !boundedString(value.helpProbe, 256)) return undefined
  if (!boundedString(value.integrity, 256) || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity)) return undefined
  if (value.shasum !== undefined && (typeof value.shasum !== 'string' || !/^[a-f0-9]{40}$/.test(value.shasum))) return undefined
  if (!boundedString(value.installedAt, 64) || !Number.isFinite(Date.parse(value.installedAt))) return undefined
  return value as AgentSdkInstallManifest
}

function parsePointer(value: unknown): ActivePointer | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'manifestPath', 'manifestSha256'])) return undefined
  if (value.schemaVersion !== AGENT_SDK_MANIFEST_SCHEMA) return undefined
  if (!boundedString(value.manifestPath, 512) || isAbsolute(value.manifestPath) || value.manifestPath.includes('\\')) return undefined
  if (!boundedString(value.manifestSha256, 64) || !/^[a-f0-9]{64}$/.test(value.manifestSha256)) return undefined
  return value as ActivePointer
}

function readBoundedFile(path: string): Buffer | undefined {
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_JSON_BYTES) return undefined
    return readFileSync(path)
  } catch {
    return undefined
  }
}

export function sha256FileSync(path: string, maximumBytes = MAX_AGENT_SDK_BINARY_BYTES): string | undefined {
  let fd: number | undefined
  try {
    const before = lstatSync(path)
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximumBytes) return undefined
    fd = openSync(path, 'r')
    const opened = fstatSync(fd)
    if (!opened.isFile() || opened.size !== before.size) return undefined
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(1024 * 1024)
    let offset = 0
    while (offset < opened.size) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, opened.size - offset), offset)
      if (count <= 0) return undefined
      hash.update(chunk.subarray(0, count))
      offset += count
    }
    const after = fstatSync(fd)
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return undefined
    return hash.digest('hex')
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function safeChild(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child.length > 0 && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function hasNoSymlinkComponents(root: string, candidate: string): boolean {
  if (!safeChild(root, candidate)) return false
  try {
    const rootStat = lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false
    let current = root
    for (const component of relative(root, candidate).split(sep)) {
      current = join(current, component)
      if (lstatSync(current).isSymbolicLink()) return false
    }
    return true
  } catch {
    return false
  }
}

export function agentSdkRoot(userDataDir: string): string {
  return join(userDataDir, 'agent-sdk')
}

export function legacyAgentSdkBinaryPath(userDataDir: string, binaryName: string): string {
  return join(agentSdkRoot(userDataDir), binaryName)
}

export function manifestRelativePath(manifest: AgentSdkInstallManifest): string {
  return join(
    'versions',
    manifest.sdkVersion,
    `${manifest.platform}-${manifest.arch}`,
    manifest.binarySha256,
    'manifest.json'
  )
}

export function serializeManifest(manifest: AgentSdkInstallManifest): Buffer {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
}

export function serializeActivePointer(manifest: AgentSdkInstallManifest, manifestBytes: Buffer): Buffer {
  const pointer: ActivePointer = {
    schemaVersion: AGENT_SDK_MANIFEST_SCHEMA,
    manifestPath: manifestRelativePath(manifest).split(sep).join('/'),
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex')
  }
  return Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`)
}

export function resolveActiveAgentSdkInstall(options: {
  userDataDir: string
  sdkVersion: string
  packageName: string | undefined
  platform: string
  arch: string
  binaryName: string
  readBinaryHash?: (path: string) => string | undefined
}): ValidAgentSdkInstall | undefined {
  if (!options.packageName) return undefined
  const root = agentSdkRoot(options.userDataDir)
  const pointerBytes = readBoundedFile(join(root, 'active.json'))
  if (!pointerBytes) return undefined
  let pointer: ActivePointer | undefined
  try {
    pointer = parsePointer(JSON.parse(pointerBytes.toString('utf8')))
  } catch {
    return undefined
  }
  if (!pointer) return undefined
  const manifestPath = join(root, ...pointer.manifestPath.split('/'))
  if (!hasNoSymlinkComponents(root, manifestPath)) return undefined
  const manifestBytes = readBoundedFile(manifestPath)
  if (!manifestBytes) return undefined
  const actualManifestHash = createHash('sha256').update(manifestBytes).digest()
  const expectedManifestHash = Buffer.from(pointer.manifestSha256, 'hex')
  if (actualManifestHash.length !== expectedManifestHash.length || !timingSafeEqual(actualManifestHash, expectedManifestHash)) return undefined
  let manifest: AgentSdkInstallManifest | undefined
  try {
    manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')))
  } catch {
    return undefined
  }
  if (!manifest) return undefined
  if (
    manifest.sdkVersion !== options.sdkVersion || manifest.packageName !== options.packageName ||
    manifest.platform !== options.platform || manifest.arch !== options.arch ||
    manifest.binaryName !== options.binaryName ||
    pointer.manifestPath !== manifestRelativePath(manifest).split(sep).join('/')
  ) return undefined
  const binaryPath = join(dirname(manifestPath), manifest.binaryName)
  if (!hasNoSymlinkComponents(root, binaryPath)) return undefined
  let stat
  try {
    stat = lstatSync(binaryPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== manifest.binarySize) return undefined
  } catch {
    return undefined
  }
  const binaryHash = readBinaryHashCached({
    pointer,
    manifest,
    binaryPath,
    stat,
    readBinaryHash: options.readBinaryHash ?? sha256FileSync
  })
  if (!binaryHash) return undefined
  return { manifest, binaryPath, manifestPath }
}

type BinaryHashCacheInput = {
  pointer: ActivePointer
  manifest: AgentSdkInstallManifest
  binaryPath: string
  stat: { ino: number; mtimeMs: number; size: number }
  readBinaryHash: (path: string) => string | undefined
}

let binaryHashCacheKey: string | undefined

function readBinaryHashCached(input: BinaryHashCacheInput): string | undefined {
  const key = JSON.stringify({
    pointerManifestPath: input.pointer.manifestPath,
    pointerManifestSha256: input.pointer.manifestSha256,
    manifestSha256: input.manifest.binarySha256,
    binaryPath: input.binaryPath,
    ino: input.stat.ino,
    mtimeMs: input.stat.mtimeMs,
    size: input.stat.size
  })
  if (binaryHashCacheKey === key) return input.manifest.binarySha256
  const actualBinaryHash = input.readBinaryHash(input.binaryPath)
  if (!actualBinaryHash || actualBinaryHash !== input.manifest.binarySha256) return undefined
  binaryHashCacheKey = key
  return actualBinaryHash
}

export function isUnmanagedLegacyBinaryPresent(userDataDir: string, binaryName: string): boolean {
  return existsSync(legacyAgentSdkBinaryPath(userDataDir, binaryName))
}
