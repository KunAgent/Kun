/**
 * Official Antigravity CLI provisioning and model discovery.
 *
 * This is the whole-turn Antigravity subscription transport. It intentionally
 * remains separate from Kun's Gemini CLI API provider, which reuses the
 * official Gemini CLI OAuth login and Code Assist request contract.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import extractZip from 'extract-zip'
import { fetchWithOptionalProxy } from './proxy-fetch'
import type {
  AntigravityReasoningEffort,
  AntigravitySubscriptionModelCatalog,
  SdkDownloadState
} from '../shared/kun-gui-api'

export const ANTIGRAVITY_CLI_VERSION = '1.1.5'
const RELEASE_BASE =
  `https://github.com/google-antigravity/antigravity-cli/releases/download/${ANTIGRAVITY_CLI_VERSION}`

type AntigravityAsset = {
  name: string
  sha256: string
  archiveKind: 'tar.gz' | 'zip'
  binaryName: string
}

const ASSETS: Record<string, AntigravityAsset> = {
  'linux-arm64': {
    name: 'agy_cli_linux_arm64.tar.gz',
    sha256: 'd61ace663d7efee9dfd8f4f881e6f1021eff904a0688a91cd4d84359ee76f044',
    archiveKind: 'tar.gz',
    binaryName: 'antigravity'
  },
  'linux-x64': {
    name: 'agy_cli_linux_x64.tar.gz',
    sha256: '1d586501b8a13d146e8aa3c7f00634f50c6034e2c428ea7d013377d36315a69a',
    archiveKind: 'tar.gz',
    binaryName: 'antigravity'
  },
  'darwin-arm64': {
    name: 'agy_cli_mac_arm64.tar.gz',
    sha256: '04254cb335c4f056308e1a7f188365f58d5c688d5af162921eac4bdda736ba55',
    archiveKind: 'tar.gz',
    binaryName: 'antigravity'
  },
  'darwin-x64': {
    name: 'agy_cli_mac_x64.tar.gz',
    sha256: '57727fcf8048860bbcfddbb404a2df9aa26557238c4e7d21feb7d646525f478b',
    archiveKind: 'tar.gz',
    binaryName: 'antigravity'
  },
  'win32-arm64': {
    name: 'agy_cli_windows_arm64.zip',
    sha256: '593600eac43071e02010f1ee002ea861df1c35c3a547b1f38c59714b79e53653',
    archiveKind: 'zip',
    binaryName: 'antigravity.exe'
  },
  'win32-x64': {
    name: 'agy_cli_windows_x64.zip',
    sha256: '0e37447c3d63284d5404e7e6679e099b7e8a6bdd800a56cee70d0283398eebed',
    archiveKind: 'zip',
    binaryName: 'antigravity.exe'
  }
}

export function antigravityCliAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): AntigravityAsset | undefined {
  return ASSETS[`${platform}-${arch}`]
}

export function antigravityCliBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'agy.exe' : 'agy'
}

export function antigravityCliBinaryPath(userDataDir: string): string {
  return join(userDataDir, 'antigravity-cli', antigravityCliBinaryName())
}

export function resolveAntigravityCliBinary(userDataDir: string): string | undefined {
  const candidates = [
    antigravityCliBinaryPath(userDataDir),
    join(homedir(), '.local', 'bin', antigravityCliBinaryName()),
    ...(process.platform === 'darwin'
      ? [
          join('/opt/homebrew/bin', antigravityCliBinaryName()),
          join('/usr/local/bin', antigravityCliBinaryName())
        ]
      : process.platform === 'win32'
        ? []
        : [join('/usr/local/bin', antigravityCliBinaryName()), join('/usr/bin', antigravityCliBinaryName())])
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
  })
}

export type AntigravityInstallResult =
  | { ok: true; path: string }
  | { ok: false; message: string }

export async function installAntigravityCli(options: {
  userDataDir: string
  proxyUrl?: string
  onProgress?: (receivedBytes: number, totalBytes: number) => void
}): Promise<AntigravityInstallResult> {
  const asset = antigravityCliAsset()
  if (!asset) {
    return { ok: false, message: `unsupported platform: ${process.platform}/${process.arch}` }
  }
  const destDir = join(options.userDataDir, 'antigravity-cli')
  const destination = antigravityCliBinaryPath(options.userDataDir)
  const archivePath = join(tmpdir(), `kun-antigravity-cli-${process.pid}-${Date.now()}.${asset.archiveKind}`)
  const extractDir = join(tmpdir(), `kun-antigravity-cli-extract-${process.pid}-${Date.now()}`)
  try {
    const response = await fetchWithOptionalProxy(
      `${RELEASE_BASE}/${asset.name}`,
      {},
      options.proxyUrl ?? ''
    )
    if (!response.ok || !response.body) {
      throw new Error(`download ${asset.name}: HTTP ${response.status}`)
    }
    const totalBytes = Number(response.headers.get('content-length')) || 0
    let receivedBytes = 0
    const hash = createHash('sha256')
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        receivedBytes += chunk.length
        hash.update(chunk)
        options.onProgress?.(receivedBytes, totalBytes)
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      verifier,
      createWriteStream(archivePath)
    )
    const actualHash = hash.digest('hex')
    if (actualHash !== asset.sha256) {
      throw new Error(`download checksum mismatch for ${asset.name}`)
    }

    mkdirSync(destDir, { recursive: true })
    mkdirSync(extractDir, { recursive: true })
    if (asset.archiveKind === 'zip') {
      await extractZip(archivePath, { dir: extractDir })
    } else {
      await runTar(['-xzf', archivePath, '-C', extractDir])
    }
    const extracted = join(extractDir, asset.binaryName)
    if (!existsSync(extracted) || statSync(extracted).size === 0) {
      throw new Error(`${asset.binaryName} was not found in ${basename(asset.name)}`)
    }
    rmSync(destination, { force: true })
    copyFileSync(extracted, destination)
    if (process.platform !== 'win32') chmodSync(destination, 0o755)
    return { ok: true, path: destination }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    rmSync(archivePath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}

const ANTIGRAVITY_MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i
const ANTIGRAVITY_MODEL_ID_MAX_LENGTH = 128
const ANTIGRAVITY_EFFORT_ORDER: readonly AntigravityReasoningEffort[] = [
  'low',
  'medium',
  'high'
]

export function parseAntigravityModels(stdout: string): AntigravitySubscriptionModelCatalog {
  const models = new Map<string, Set<AntigravityReasoningEffort>>()
  for (const line of stdout.split(/\r?\n/)) {
    const [rawModel = ''] = line.trim().split(/\s+/, 1)
    if (
      !rawModel
      || rawModel.length > ANTIGRAVITY_MODEL_ID_MAX_LENGTH
      || !ANTIGRAVITY_MODEL_ID_PATTERN.test(rawModel)
    ) {
      continue
    }
    const effortMatch = rawModel.match(/-(low|medium|high)$/i)
    const effort = effortMatch?.[1]?.toLowerCase() as AntigravityReasoningEffort | undefined
    const modelId = effort ? rawModel.slice(0, -(effort.length + 1)) : rawModel
    if (!ANTIGRAVITY_MODEL_ID_PATTERN.test(modelId)) continue
    const supportedEfforts = models.get(modelId) ?? new Set<AntigravityReasoningEffort>()
    supportedEfforts.add(effort ?? 'medium')
    models.set(modelId, supportedEfforts)
  }
  return {
    models: [...models].map(([id, effortSet]) => {
      const supportedEfforts = ANTIGRAVITY_EFFORT_ORDER.filter((effort) => effortSet.has(effort))
      return {
        id,
        supportedEfforts,
        defaultEffort: supportedEfforts.includes('medium')
          ? 'medium'
          : supportedEfforts.includes('high')
            ? 'high'
            : 'low'
      }
    })
  }
}

export function fetchAntigravityModels(options: {
  binaryPath: string
  timeoutMs?: number
  spawnFn?: typeof spawn
}): Promise<AntigravitySubscriptionModelCatalog> {
  return new Promise((resolve, reject) => {
    const spawnFn = options.spawnFn ?? spawn
    const child = spawnFn(options.binaryPath, ['models'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else {
        const catalog = parseAntigravityModels(stdout)
        if (catalog.models.length === 0) {
          reject(new Error(stderr.trim() || 'Antigravity CLI returned no subscription models'))
        } else {
          resolve(catalog)
        }
      }
    }
    const timer = setTimeout(() => {
      child.kill()
      done(new Error('Antigravity CLI model discovery timed out'))
    }, options.timeoutMs ?? 60_000)
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout = `${stdout}${chunk}`.slice(-256 * 1024)
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024)
    })
    child.on('error', (error) => done(error))
    child.on('exit', (code) => {
      if (code !== 0) {
        done(new Error(stderr.trim() || `Antigravity CLI exited with code ${code}`))
      } else {
        done()
      }
    })
  })
}

let activeState: SdkDownloadState | null = null

export function antigravityCliDownloadState(): SdkDownloadState | null {
  return activeState
}

export function startAntigravityCliInstall(
  options: { userDataDir: string; proxyUrl?: string },
  onState?: (state: SdkDownloadState) => void
): SdkDownloadState {
  if (activeState?.status === 'downloading') return activeState
  const emit = (state: SdkDownloadState): void => {
    activeState = state
    onState?.(state)
  }
  emit({ status: 'downloading', receivedBytes: 0, totalBytes: 0 })
  void installAntigravityCli({
    ...options,
    onProgress: (receivedBytes, totalBytes) =>
      emit({ status: 'downloading', receivedBytes, totalBytes })
  }).then((result) => {
    const receivedBytes = activeState?.receivedBytes ?? 0
    const totalBytes = activeState?.totalBytes ?? 0
    emit(result.ok
      ? { status: 'done', receivedBytes, totalBytes }
      : { status: 'error', receivedBytes, totalBytes, message: result.message })
  })
  return activeState as SdkDownloadState
}
