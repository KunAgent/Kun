/**
 * On-demand provisioning of the Agent SDK's Claude Code binary.
 *
 * The SDK ships a ~222MB per-platform binary as an optional dependency. We do
 * NOT bundle it into the installer (see electron-builder config — only the small
 * SDK JS is packaged). Instead it's downloaded on first use, straight from the
 * npm registry tarball (no `npm` needed on the user's machine), extracted into a
 * writable user-data dir, and the runtime is pointed at it via
 * `pathToClaudeCodeExecutable`.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, chmodSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchWithOptionalProxy } from './proxy-fetch'

// Keep in sync with kun/package.json's @anthropic-ai/claude-agent-sdk version.
export const AGENT_SDK_VERSION = '0.3.193'
const REGISTRY = 'https://registry.npmjs.org'

export function claudeBinaryName(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude'
}

/** The per-platform binary package, e.g. @anthropic-ai/claude-agent-sdk-darwin-arm64. */
export function platformBinaryPackage(): string | undefined {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  const platform =
    process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'win32'
        ? 'win32'
        : process.platform === 'linux'
          ? 'linux'
          : undefined
  if (!arch || !platform) return undefined
  return `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
}

/** Where the on-demand binary is downloaded to. */
export function agentSdkBinaryPath(userDataDir: string): string {
  return join(userDataDir, 'agent-sdk', claudeBinaryName())
}

/**
 * Resolve the Claude Code binary: the on-demand download first, then a bundled
 * copy in kun's node_modules (present in dev / if ever bundled). Returns the
 * first that exists, or undefined → needs downloading.
 */
export function resolveClaudeBinary(userDataDir: string, kunDirs: readonly string[]): string | undefined {
  const downloaded = agentSdkBinaryPath(userDataDir)
  if (existsSync(downloaded)) return downloaded
  const pkg = platformBinaryPackage()
  if (pkg) {
    const bin = claudeBinaryName()
    for (const dir of kunDirs) {
      const candidate = join(dir, 'node_modules', pkg, bin)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

export function agentSdkStatus(
  userDataDir: string,
  kunDirs: readonly string[]
): { installed: boolean; path?: string } {
  const path = resolveClaudeBinary(userDataDir, kunDirs)
  return path ? { installed: true, path } : { installed: false }
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
  })
}

export type AgentSdkInstallResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

/**
 * Download the platform binary tarball from the npm registry and extract the
 * `claude` executable into the user-data dir. `proxyUrl` routes through the
 * model proxy (npm/registry is region-restricted for some users).
 */
export async function installClaudeBinary(options: {
  userDataDir: string
  proxyUrl?: string
  version?: string
}): Promise<AgentSdkInstallResult> {
  const pkg = platformBinaryPackage()
  if (!pkg) return { ok: false, message: `unsupported platform: ${process.platform}/${process.arch}` }
  const version = options.version ?? AGENT_SDK_VERSION
  const proxyUrl = options.proxyUrl ?? ''
  const destDir = join(options.userDataDir, 'agent-sdk')
  const binPath = join(destDir, claudeBinaryName())
  const tgz = join(tmpdir(), `kun-agent-sdk-${process.pid}.tgz`)
  try {
    // 1. registry metadata → exact tarball url
    const metaRes = await fetchWithOptionalProxy(`${REGISTRY}/${pkg}/${version}`, {}, proxyUrl)
    if (!metaRes.ok) throw new Error(`registry ${pkg}@${version}: ${metaRes.status}`)
    const meta = (await metaRes.json()) as { dist?: { tarball?: string } }
    const tarball = meta.dist?.tarball
    if (!tarball) throw new Error(`no tarball for ${pkg}@${version}`)

    // 2. stream the (~222MB) tarball to a temp file
    const res = await fetchWithOptionalProxy(tarball, {}, proxyUrl)
    if (!res.ok || !res.body) throw new Error(`download ${tarball}: ${res.status}`)
    mkdirSync(destDir, { recursive: true })
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tgz))

    // 3. extract just the binary (tarball root is `package/`)
    await runTar(['-xzf', tgz, '-C', destDir, '--strip-components=1', `package/${claudeBinaryName()}`])
    if (!existsSync(binPath) || statSync(binPath).size === 0) {
      throw new Error('binary not found in tarball')
    }
    if (process.platform !== 'win32') chmodSync(binPath, 0o755)
    return { ok: true, path: binPath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(tgz, { force: true })
  }
}
