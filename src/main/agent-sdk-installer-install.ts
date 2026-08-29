import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fsyncSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  downloadArchive,
  extractExactBinary,
  fetchAllowlisted,
  fetchPackageMetadata,
  MAX_BINARY_BYTES
} from './agent-sdk-installer-network'
import {
  agentSdkRoot,
  legacyAgentSdkBinaryPath,
  manifestRelativePath,
  resolveActiveAgentSdkInstall,
  serializeActivePointer,
  serializeManifest,
  type AgentSdkInstallManifest
} from './agent-sdk-installer-storage'

export type AgentSdkInstallResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

export type InstallTarget = {
  userDataDir: string
  proxyUrl?: string
  version: string
  packageName: string
  expectedIntegrity: string | undefined
  binaryName: string
  platform: string
  arch: string
  onProgress?: (receivedBytes: number, totalBytes: number) => void
}

function boundedProbe(binaryPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        USERPROFILE: process.env.USERPROFILE ?? ''
      }
    })
    let output = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(output.trim())
    }
    const append = (chunk: Buffer): void => {
      if (output.length < 16 * 1024) output += chunk.toString('utf8', 0, 16 * 1024 - output.length)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`probe ${args.join(' ')} timed out`))
    }, 5_000)
    child.once('error', (error) => finish(error))
    child.once('exit', (code, signal) => {
      finish(code === 0 ? undefined : new Error(`probe ${args.join(' ')} failed (${signal ?? code})`))
    })
  })
}

export async function probeClaudeBinary(binaryPath: string): Promise<{ cliVersion: string; helpProbe: string }> {
  const versionOutput = await boundedProbe(binaryPath, ['--version'])
  if (!/Claude Code/i.test(versionOutput) || !/\d+\.\d+\.\d+/.test(versionOutput)) {
    throw new Error('binary version probe returned an unexpected response')
  }
  const helpOutput = await boundedProbe(binaryPath, ['--help'])
  if (!/Usage:\s*claude/i.test(helpOutput) || !/Claude Code/i.test(helpOutput)) {
    throw new Error('binary help probe returned an unexpected response')
  }
  return {
    cliVersion: versionOutput.slice(0, 256),
    helpProbe: helpOutput.match(/Usage:\s*claude[^\r\n]*/i)?.[0].slice(0, 256) ?? 'Usage: claude'
  }
}

function sha256File(path: string): { binarySha256: string; binarySize: number } {
  const fd = openSync(path, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_BINARY_BYTES) throw new Error('invalid binary size')
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < stat.size) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - position), position)
      if (count <= 0) throw new Error('unexpected end of binary')
      hash.update(buffer.subarray(0, count))
      position += count
    }
    return { binarySha256: hash.digest('hex'), binarySize: stat.size }
  } finally {
    closeSync(fd)
  }
}

function fsyncFile(path: string): void {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

function publishInstall(target: InstallTarget, manifest: AgentSdkInstallManifest, sourceBinary: string): string {
  const root = agentSdkRoot(target.userDataDir)
  const relativeManifest = manifestRelativePath(manifest)
  const finalDir = dirname(join(root, relativeManifest))
  const parent = dirname(finalDir)
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  const staging = join(parent, `.staging-${process.pid}-${Date.now()}-${manifest.binarySha256.slice(0, 12)}`)
  mkdirSync(staging, { mode: 0o700 })
  try {
    const stagedBinary = join(staging, manifest.binaryName)
    const stagedManifest = join(staging, 'manifest.json')
    copyFileSync(sourceBinary, stagedBinary)
    if (process.platform !== 'win32') chmodSync(stagedBinary, 0o755)
    writeFileSync(stagedManifest, serializeManifest(manifest), { flag: 'wx', mode: 0o600 })
    fsyncFile(stagedBinary)
    fsyncFile(stagedManifest)
    try {
      renameSync(staging, finalDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
      const quarantine = join(parent, `.replaced-${Date.now()}-${manifest.binarySha256.slice(0, 12)}`)
      renameSync(finalDir, quarantine)
      renameSync(staging, finalDir)
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  const manifestBytes = serializeManifest(manifest)
  const pointerTemp = join(root, `.active-${process.pid}-${Date.now()}.json`)
  writeFileSync(pointerTemp, serializeActivePointer(manifest, manifestBytes), { flag: 'wx', mode: 0o600 })
  fsyncFile(pointerTemp)
  renameSync(pointerTemp, join(root, 'active.json'))
  const installed = resolveActiveAgentSdkInstall({
    userDataDir: target.userDataDir,
    sdkVersion: target.version,
    packageName: target.packageName,
    platform: target.platform,
    arch: target.arch,
    binaryName: target.binaryName
  })
  if (!installed) throw new Error('published Agent SDK manifest failed validation')
  return installed.binaryPath
}

export async function installOrImportClaudeBinary(target: InstallTarget): Promise<AgentSdkInstallResult> {
  try {
    if (!target.expectedIntegrity) throw new Error(`no pinned integrity for ${target.packageName}`)
    const active = resolveActiveAgentSdkInstall({
      userDataDir: target.userDataDir,
      sdkVersion: target.version,
      packageName: target.packageName,
      platform: target.platform,
      arch: target.arch,
      binaryName: target.binaryName
    })
    if (active) return { ok: true, path: active.binaryPath }
    // Legacy binaries are deliberately unavailable: executing an unauthenticated legacy file to
    // "probe" it would itself cross the trust boundary. A fresh authenticated archive replaces it.
    void legacyAgentSdkBinaryPath(target.userDataDir, target.binaryName)
    const root = agentSdkRoot(target.userDataDir)
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const workDir = join(root, `.download-${process.pid}-${Date.now()}`)
    mkdirSync(workDir, { mode: 0o700 })
    try {
      const metadataUrl = `https://registry.npmjs.org/${target.packageName}/${target.version}`
      const metadata = await fetchPackageMetadata(
        metadataUrl,
        target.packageName,
        target.version,
        target.proxyUrl ?? ''
      )
      if (metadata.dist.integrity !== target.expectedIntegrity) {
        throw new Error('registry metadata integrity does not match the pinned SDK release')
      }
      const archiveResponse = await fetchAllowlisted(metadata.dist.tarball, target.proxyUrl ?? '')
      const archive = join(workDir, 'package.tgz')
      await downloadArchive(archiveResponse, archive, metadata, target.onProgress)
      const extracted = join(workDir, target.binaryName)
      await extractExactBinary(archive, `package/${target.binaryName}`, extracted)
      if (process.platform !== 'win32') chmodSync(extracted, 0o755)
      const probe = await probeClaudeBinary(extracted)
      const digest = sha256File(extracted)
      const manifest: AgentSdkInstallManifest = {
        schemaVersion: 1,
        sdkVersion: target.version,
        packageName: target.packageName,
        platform: target.platform,
        arch: target.arch,
        binaryName: target.binaryName,
        ...digest,
        ...probe,
        integrity: metadata.dist.integrity,
        ...(metadata.dist.shasum ? { shasum: metadata.dist.shasum.toLowerCase() } : {}),
        installedAt: new Date().toISOString()
      }
      return { ok: true, path: publishInstall(target, manifest, extracted) }
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
