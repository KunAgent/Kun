import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SdkDownloadState } from '../shared/kun-gui-api'
import { installOrImportClaudeBinary, type AgentSdkInstallResult } from './agent-sdk-installer-install'
import { resolveActiveAgentSdkInstall } from './agent-sdk-installer-storage'

export type { SdkDownloadState } from '../shared/kun-gui-api'
export type { AgentSdkInstallResult } from './agent-sdk-installer-install'

export const AGENT_SDK_VERSION = '0.3.220'
export const AGENT_SDK_INTEGRITY_BY_PACKAGE: Readonly<Record<string, string>> = Object.freeze({
  '@anthropic-ai/claude-agent-sdk-darwin-arm64': 'sha512-7VxlbEosK7DODiOnsjoVd0DSJzbnaPrM2jelMHI0y8zx1UnLS3WC6EFUXbvy74F2sXqEznh2tzn7EKWInaRN6Q==',
  '@anthropic-ai/claude-agent-sdk-darwin-x64': 'sha512-X9RwDsSmbF6ultKZroaip+DL8WRgC64gHbrAwrRlAFSPNZV7zmJyP2ur8rW7KrxqmtuehdMMkw8+SAC/6hD2PA==',
  '@anthropic-ai/claude-agent-sdk-linux-arm64': 'sha512-WkROPwWskqhKR9XgnmseHQ6rLi9zM9qt57IWoToIjL/eXOqDWipp7JXZ1L5ud+LrA42dunHPZfBwD/vXZ+A7LA==',
  '@anthropic-ai/claude-agent-sdk-linux-x64': 'sha512-tkTJFnpR9VifvWX2fmkCAPkT6+8Wk/gVu8B5jsVekKZPiZoWRHmMXO30BnZn+f0TZhgYP+82PSX3S8crH1kn+w==',
  '@anthropic-ai/claude-agent-sdk-win32-arm64': 'sha512-rIwgq0UwQExWl6KrHUyC4w5KwpL9l6nd95aUTx6RitexaAuEw//xtfTVLnuE4hDDQZFkzEwpdKc3nxDWoGcUbA==',
  '@anthropic-ai/claude-agent-sdk-win32-x64': 'sha512-MuOuXhbr66HlGaWXD2f3w0k2PsvmnbkwcUZ0dAe2poFLdl72GC2dapwwOBefxm9QmoNqk9+jmv/dSKGOVWyvLw=='
})

export function claudeBinaryName(): string {
  return process.platform === 'win32' ? 'claude.exe' : 'claude'
}

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
  return arch && platform ? `@anthropic-ai/claude-agent-sdk-${platform}-${arch}` : undefined
}

function activeInstall(userDataDir: string, readBinaryHash?: (path: string) => string | undefined): ReturnType<typeof resolveActiveAgentSdkInstall> {
  return resolveActiveAgentSdkInstall({
    userDataDir,
    sdkVersion: AGENT_SDK_VERSION,
    packageName: platformBinaryPackage(),
    platform: process.platform,
    arch: process.arch,
    binaryName: claudeBinaryName(),
    readBinaryHash
  })
}

/** Compatibility API: returns the active path, or the historical unmanaged location when unavailable. */
export function agentSdkBinaryPath(userDataDir: string): string {
  return activeInstall(userDataDir)?.binaryPath ?? join(userDataDir, 'agent-sdk', claudeBinaryName())
}

function bundledClaudeBinary(kunDirs: readonly string[]): string | undefined {
  const pkg = platformBinaryPackage()
  if (!pkg) return undefined
  for (const dir of kunDirs) {
    const candidate = join(dir, 'node_modules', pkg, claudeBinaryName())
    const packageJson = join(dir, 'node_modules', pkg, 'package.json')
    if (existsSync(candidate) && readBundledPackageVersion(packageJson) === AGENT_SDK_VERSION) return candidate
  }
  return undefined
}

function readBundledPackageVersion(packageJson: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(packageJson, 'utf8')) as unknown
    return value && typeof value === 'object' && (value as { version?: unknown }).version === AGENT_SDK_VERSION
      ? AGENT_SDK_VERSION
      : undefined
  } catch {
    return undefined
  }
}

export function resolveClaudeBinary(userDataDir: string, kunDirs: readonly string[]): string | undefined {
  return activeInstall(userDataDir)?.binaryPath ?? bundledClaudeBinary(kunDirs)
}

export function agentSdkStatus(
  userDataDir: string,
  kunDirs: readonly string[]
): { installed: boolean; path?: string } {
  const path = resolveClaudeBinary(userDataDir, kunDirs)
  return path ? { installed: true, path } : { installed: false }
}

export async function installClaudeBinary(options: {
  userDataDir: string
  proxyUrl?: string
  version?: string
  onProgress?: (receivedBytes: number, totalBytes: number) => void
}): Promise<AgentSdkInstallResult> {
  const pkg = platformBinaryPackage()
  if (!pkg) return { ok: false, message: `unsupported platform: ${process.platform}/${process.arch}` }
  const version = options.version ?? AGENT_SDK_VERSION
  if (version !== AGENT_SDK_VERSION) {
    return { ok: false, message: `refusing unpinned Agent SDK version: ${version}` }
  }
  return installOrImportClaudeBinary({
    ...options,
    version,
    packageName: pkg,
    expectedIntegrity: AGENT_SDK_INTEGRITY_BY_PACKAGE[pkg],
    binaryName: claudeBinaryName(),
    platform: process.platform,
    arch: process.arch
  })
}

let activeState: SdkDownloadState | null = null

export type StartAgentSdkInstallOptions = {
  userDataDir: string
  proxyUrl?: string
  version?: string
  restartRuntime: () => Promise<void>
}

type StartAgentSdkInstallDependencies = {
  installBinary: typeof installClaudeBinary
  hasDownloadedBinary: (userDataDir: string) => boolean
}

function hasDownloadedClaudeBinary(userDataDir: string): boolean {
  return Boolean(activeInstall(userDataDir))
}

function restartFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return detail
    ? `Claude runtime downloaded, but Kun could not restart: ${detail}`
    : 'Claude runtime downloaded, but Kun could not restart. Try again.'
}

export function agentSdkDownloadState(): SdkDownloadState | null {
  return activeState
}

export function startAgentSdkInstall(
  options: StartAgentSdkInstallOptions,
  onState?: (state: SdkDownloadState) => void,
  dependencies: Partial<StartAgentSdkInstallDependencies> = {}
): SdkDownloadState {
  if (activeState?.status === 'downloading' || activeState?.status === 'restarting') return activeState
  const installBinary = dependencies.installBinary ?? installClaudeBinary
  const hasDownloadedBinary = dependencies.hasDownloadedBinary ?? hasDownloadedClaudeBinary
  const emit = (state: SdkDownloadState): void => {
    activeState = state
    onState?.(state)
  }
  const restart = async (receivedBytes: number, totalBytes: number): Promise<void> => {
    emit({ status: 'restarting', receivedBytes, totalBytes })
    try {
      await options.restartRuntime()
      emit({ status: 'done', receivedBytes, totalBytes })
    } catch (error) {
      emit({ status: 'error', receivedBytes, totalBytes, message: restartFailureMessage(error) })
    }
  }
  if (hasDownloadedBinary(options.userDataDir)) {
    void restart(0, 0)
    return activeState as SdkDownloadState
  }
  emit({ status: 'downloading', receivedBytes: 0, totalBytes: 0 })
  void installBinary({
    userDataDir: options.userDataDir,
    proxyUrl: options.proxyUrl,
    version: options.version,
    onProgress: (receivedBytes, totalBytes) => emit({ status: 'downloading', receivedBytes, totalBytes })
  }).then(async (result) => {
    const received = activeState?.receivedBytes ?? 0
    const total = activeState?.totalBytes ?? 0
    if (!result.ok) {
      emit({ status: 'error', receivedBytes: received, totalBytes: total, message: result.message })
      return
    }
    await restart(received, total)
  }).catch((error) => {
    emit({
      status: 'error',
      receivedBytes: activeState?.receivedBytes ?? 0,
      totalBytes: activeState?.totalBytes ?? 0,
      message: error instanceof Error ? error.message : String(error)
    })
  })
  return activeState as SdkDownloadState
}
