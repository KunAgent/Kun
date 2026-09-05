import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import semver from 'semver'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'
import {
  acquireTuiUpdateLock,
  checkTuiUpdateKillPoint,
  clearTuiUpdateTransaction,
  tuiUpdateLogPath,
  tuiUpdateTransactionDir,
  writeTuiUpdateResult,
  writeTuiUpdateTransaction
} from './self-update-transaction.js'
import { reconcilePendingTuiUpdate } from './self-update-reconcile.js'
import {
  garbageCollectReleases,
  listReleaseBuildIds,
  pointerLauncherScript,
  readPointerBuildId,
  resolveStandaloneTuiLayout,
  TUI_RELEASE_METADATA_FILENAME,
  TUI_RELEASES_DIR,
  tuiPointerPath,
  tuiReleaseDirForBuildId,
  tuiReleasesDir,
  writeStandaloneReleasePointer
} from './self-update-layout.js'
import { scheduleWindowsGarbageCollection } from './self-update-windows.js'
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000
const FETCH_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1_000
const STANDALONE_TUI_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64'
])

export type StandaloneTuiReleaseMetadata = {
  schemaVersion: 1
  component: 'tui'
  version: string
  artifactVersion: string
  tag: string
  channel: 'stable' | 'frontier'
  target: string
  buildId: string
  commit: string
  updateEnabled: boolean
  updateManifestUrl: string
}

export type TuiUpdateArtifact = {
  target: string
  fileName: string
  size: number
  sha256: string
  url: string
}

export type TuiUpdateManifest = {
  schemaVersion: 1
  component: 'tui'
  version: string
  tag: string
  channel: 'stable' | 'frontier'
  buildId: string
  artifacts: TuiUpdateArtifact[]
}

export type TuiUpdateCheck = {
  current: StandaloneTuiReleaseMetadata
  latest: TuiUpdateManifest
  artifact: TuiUpdateArtifact
  available: boolean
}

type UpdateIo = {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  env?: Record<string, string | undefined>
  fetch?: typeof fetch
}

export const KUN_UPDATE_USAGE = `kun update [--check] [--yes]

Checks the stable R2 release shared by Kun GUI and standalone TUI.
The GUI-bundled TUI is updated with the GUI application and cannot update itself.
`

export function standaloneTuiTarget(
  platform = process.platform,
  arch = process.arch
): string | undefined {
  const target = `${platform}-${arch}`
  return STANDALONE_TUI_TARGETS.has(target) ? target : undefined
}

export function parseTuiUpdateManifest(
  value: unknown,
  current: StandaloneTuiReleaseMetadata
): TuiUpdateManifest {
  if (!isRecord(value)) throw new Error('latest-tui.json must contain an object')
  if (
    value.schemaVersion !== 1 ||
    value.component !== 'tui' ||
    value.channel !== 'stable' ||
    typeof value.version !== 'string' ||
    !semver.valid(value.version) ||
    typeof value.tag !== 'string' ||
    typeof value.buildId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.buildId) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error('latest-tui.json has an unsupported release contract')
  }
  if (current.channel !== 'stable' || !current.updateEnabled) {
    throw new Error('self-update is available only for stable standalone TUI releases')
  }
  const artifacts = value.artifacts.map((artifact) => parseArtifact(artifact))
  const targets = new Set(artifacts.map((artifact) => artifact.target))
  const expectedTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
  const expectedFiles = new Map([
    ['darwin-arm64', `Kun-TUI-${value.version}-mac-arm64.tar.gz`],
    ['darwin-x64', `Kun-TUI-${value.version}-mac-x64.tar.gz`],
    ['linux-arm64', `Kun-TUI-${value.version}-linux-arm64.tar.gz`],
    ['linux-x64', `Kun-TUI-${value.version}-linux-x64.tar.gz`],
    ['win32-x64', `Kun-TUI-${value.version}-win-x64.zip`]
  ])
  if (
    value.tag !== `v${value.version}` ||
    targets.size !== artifacts.length ||
    artifacts.length !== expectedTargets.length ||
    expectedTargets.some((target) => !targets.has(target)) ||
    artifacts.some((artifact) => artifact.fileName !== expectedFiles.get(artifact.target))
  ) {
    throw new Error('latest-tui.json does not describe one complete stable release')
  }
  return {
    schemaVersion: 1,
    component: 'tui',
    version: value.version,
    tag: value.tag,
    channel: 'stable',
    buildId: value.buildId,
    artifacts
  }
}

export async function readStandaloneTuiRelease(
  env: Record<string, string | undefined> = process.env
): Promise<{ root: string; metadata: StandaloneTuiReleaseMetadata } | null> {
  const configuredRoot = env.KUN_STANDALONE_ROOT?.trim()
  if (!configuredRoot) return null
  const base = resolve(configuredRoot)
  const layout = await resolveStandaloneTuiLayout(base)
  if (!layout) return null
  try {
    const metadata = parseStandaloneRelease(
      JSON.parse(await readFile(join(layout.releaseDir, TUI_RELEASE_METADATA_FILENAME), 'utf8')) as unknown
    )
    return { root: base, metadata }
  } catch {
    return null
  }
}

export async function checkStandaloneTuiUpdate(
  input: {
    env?: Record<string, string | undefined>
    fetch?: typeof fetch
  } = {}
): Promise<TuiUpdateCheck | null> {
  const standalone = await readStandaloneTuiRelease(input.env ?? process.env)
  if (!standalone) return null
  const { metadata } = standalone
  if (!metadata.updateEnabled || metadata.channel !== 'stable') return null
  const runtimeTarget = standaloneTuiTarget()
  if (!runtimeTarget || metadata.target !== runtimeTarget) {
    throw new Error(`standalone release target ${metadata.target} does not match this host`)
  }
  const response = await (input.fetch ?? fetch)(metadata.updateManifestUrl, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`update manifest request failed with HTTP ${response.status}`)
  const latest = parseTuiUpdateManifest(await response.json(), metadata)
  const artifact = latest.artifacts.find((candidate) => candidate.target === metadata.target)
  if (!artifact) throw new Error(`latest release does not support ${metadata.target}`)
  return {
    current: metadata,
    latest,
    artifact,
    available: semver.gt(latest.version, metadata.version)
  }
}

export async function checkStandaloneTuiUpdateOnce(
  input: {
    env?: Record<string, string | undefined>
    fetch?: typeof fetch
    dataDir: string
    now?: number
  }
): Promise<TuiUpdateCheck | null> {
  const standalone = await readStandaloneTuiRelease(input.env ?? process.env)
  if (
    !standalone ||
    standalone.metadata.channel !== 'stable' ||
    !standalone.metadata.updateEnabled
  ) return null
  const statePath = join(input.dataDir, 'tui-update-check.json')
  const now = input.now ?? Date.now()
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8')) as { checkedAt?: unknown }
    if (
      typeof state.checkedAt === 'string' &&
      now - Date.parse(state.checkedAt) < UPDATE_CHECK_INTERVAL_MS
    ) return null
  } catch {
    // Missing or invalid state means a check is due.
  }
  const result = await checkStandaloneTuiUpdate(input)
  await withRuntimeDataDirAncillaryWriter(input.dataDir, async () => {
    await mkdir(input.dataDir, { recursive: true, mode: 0o700 })
    await writeFile(
      statePath,
      `${JSON.stringify({
        checkedAt: new Date(now).toISOString(),
        currentVersion: result?.current.version,
        latestVersion: result?.latest.version,
        available: result?.available ?? false
      }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    )
  })
  return result
}

export async function runSelfUpdateCommand(
  argv: readonly string[],
  io: UpdateIo
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout.write(KUN_UPDATE_USAGE)
    return 0
  }
  const unknown = argv.filter((argument) => argument !== '--check' && argument !== '--yes')
  if (unknown.length) {
    io.stderr.write(`kun update: unknown option ${unknown[0]}\n`)
    return 64
  }
  if (argv.includes('--check') && argv.includes('--yes')) {
    io.stderr.write('kun update: --check and --yes are mutually exclusive\n')
    return 64
  }
  const standalone = await readStandaloneTuiRelease(io.env ?? process.env)
  if (!standalone) {
    io.stderr.write(
      'kun update: this TUI is bundled with Kun GUI or is not a managed standalone archive; update the GUI application instead.\n'
    )
    return 69
  }
  if (!standalone.metadata.updateEnabled || standalone.metadata.channel !== 'stable') {
    io.stderr.write('kun update: Daily/frontier TUI builds do not support self-update.\n')
    return 69
  }
  const pending = await reconcilePendingTuiUpdate(standalone.root)
  if (pending?.kind === 'activated') {
    io.stdout.write(
      `Kun ${pending.targetVersion} is now active (updated from ${pending.previousVersion}).\n`
    )
    return 0
  }
  if (pending?.kind === 'failed') {
    io.stderr.write(`kun update: ${pending.message}\n`)
    return 70
  }
  if (pending?.kind === 'busy') {
    io.stderr.write(
      `kun update: another update is already in progress (process ${pending.pid}); ` +
      'wait for it to finish and run again.\n'
    )
    return 70
  }
  try {
    const check = await checkStandaloneTuiUpdate({
      env: io.env,
      fetch: io.fetch
    })
    if (!check) {
      io.stderr.write('kun update: standalone release metadata is unavailable.\n')
      return 69
    }
    if (!check.available) {
      io.stdout.write(`Kun ${check.current.version} is up to date.\n`)
      return 0
    }
    io.stdout.write(`Kun ${check.latest.version} is available (current ${check.current.version}).\n`)
    if (argv.includes('--check')) return 10
    if (!argv.includes('--yes')) {
      io.stdout.write('Run `kun update --yes` to download and install this joint GUI/TUI release.\n')
      return 10
    }
    await installStandaloneTuiUpdate(standalone.root, check, io)
    return 0
  } catch (error) {
    io.stderr.write(`kun update: ${error instanceof Error ? error.message : String(error)}\n`)
    return 70
  }
}

async function installStandaloneTuiUpdate(
  currentRoot: string,
  check: TuiUpdateCheck,
  io: UpdateIo
): Promise<void> {
  await access(currentRoot)
  await access(dirname(currentRoot))
  const stagingRoot = await mkdtemp(join(dirname(currentRoot), '.kun-update-'))
  const archivePath = join(stagingRoot, check.artifact.fileName)
  try {
    await downloadFile(check.artifact.url, archivePath, io.fetch ?? fetch)
    const details = await stat(archivePath)
    if (details.size !== check.artifact.size) throw new Error('downloaded update size does not match manifest')
    const digest = await sha256File(archivePath)
    if (digest !== check.artifact.sha256) throw new Error('downloaded update SHA-256 does not match manifest')
    validateArchiveEntries(archivePath)
    execFileSync('tar', ['-xf', archivePath, '-C', stagingRoot], { stdio: 'ignore' })
    const nextBase = join(stagingRoot, 'kun')
    await normalizeFlatStagingArchive(nextBase, check.latest.buildId)
    const nextReleaseDir = join(nextBase, 'releases', check.latest.buildId)
    const nextRelease = parseStandaloneRelease(
      JSON.parse(await readFile(join(nextReleaseDir, TUI_RELEASE_METADATA_FILENAME), 'utf8')) as unknown
    )
    if (
      nextRelease.version !== check.latest.version ||
      nextRelease.target !== check.current.target ||
      nextRelease.buildId !== check.latest.buildId
    ) {
      throw new Error('downloaded update metadata does not match latest-tui.json')
    }
    await smokeNewRelease(nextReleaseDir, check.latest.version)
    checkTuiUpdateKillPoint('after-stage-verify')

    const lock = await acquireTuiUpdateLock(currentRoot)
    try {
      // A concurrent updater may have finished while we downloaded; do not
      // activate twice.
      const installed = await readStandaloneTuiRelease({ KUN_STANDALONE_ROOT: currentRoot })
      if (installed && semver.gte(installed.metadata.version, check.latest.version)) {
        io.stdout.write(`Kun ${installed.metadata.version} is up to date.\n`)
        return
      }
      const base = resolve(currentRoot)
      const layout = await resolveStandaloneTuiLayout(base)
      const newBuildId = check.latest.buildId
      const fromBuildId = layout?.kind === 'legacy'
        ? (installed?.metadata.buildId ?? check.current.buildId)
        : basename(layout?.releaseDir ?? base)
      const fromReleaseDir = tuiReleaseDirForBuildId(base, fromBuildId)
      const toReleaseDir = tuiReleaseDirForBuildId(base, newBuildId)
      if (resolve(fromReleaseDir) === resolve(toReleaseDir)) {
        throw new Error(
          `Release ${check.latest.version} reuses buildId ${newBuildId} ` +
          `from installed version ${installed?.metadata.version ?? check.current.version}`
        )
      }

      // A legacy install needs the stable pointer launcher before any move, so
      // the base directory (and therefore the PATH entry) never disappears.
      if (layout?.kind === 'legacy') {
        await migrateLegacyLauncher(base, process.platform)
      }

      // The immutable release directory is moved into place before the
      // transaction is written; the pointer still points at the previous
      // release, so a crash here leaves a working install.
      await mkdir(tuiReleasesDir(base), { recursive: true })
      await rm(toReleaseDir, { recursive: true, force: true })
      await rename(nextReleaseDir, toReleaseDir)
      checkTuiUpdateKillPoint('after-release-move')

      await writeTuiUpdateTransaction(base, {
        previousVersion: check.current.version,
        targetVersion: check.latest.version,
        buildId: newBuildId,
        stagingRoot,
        backupRoot: `${base}.previous`,
        fromReleaseDir,
        toReleaseDir,
        pointerPath: tuiPointerPath(base)
      })
      checkTuiUpdateKillPoint('after-transaction')

      // The single atomic step that changes which version `kun` runs.
      await writeStandaloneReleasePointer(base, newBuildId)
      checkTuiUpdateKillPoint('after-pointer-swap')

      if (layout?.kind === 'legacy') {
        await moveLegacyScatteredEntries(base, fromReleaseDir)
        checkTuiUpdateKillPoint('after-legacy-move')
      }
      await verifyActivatedRelease(base, check)

      await writeTuiUpdateResult(base, {
        status: 'succeeded',
        previousVersion: check.current.version,
        targetVersion: check.latest.version
      })
      await clearTuiUpdateTransaction(base)

      const keep = [newBuildId, fromBuildId]
      if (process.platform === 'win32') {
        const obsolete = await obsoleteReleaseDirs(base, keep)
        await scheduleWindowsGarbageCollection({
          base,
          obsoleteReleaseDirs: obsolete,
          transactionDir: tuiUpdateTransactionDir(base),
          logPath: tuiUpdateLogPath(base)
        }).catch(() => undefined)
      } else {
        await garbageCollectReleases(base, keep).catch(() => undefined)
      }

      io.stdout.write(`Kun ${check.latest.version} installed. The next \`kun\` invocation uses it.\n`)
    } finally {
      await lock.release().catch(() => undefined)
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Normalize a legacy flat archive (release.json, runtime/, app/ directly under
 * kun/) into the immutable pointer shape so the shared install path handles it.
 * The incoming `bin` launcher is discarded: a legacy base receives the stable
 * pointer launcher from migrateLegacyLauncher, and a pointer base keeps its
 * existing launcher. Returns true when the archive was normalized.
 */
async function normalizeFlatStagingArchive(nextBase: string, buildId: string): Promise<boolean> {
  const releaseDir = tuiReleaseDirForBuildId(nextBase, buildId)
  if (await stat(releaseDir).then(() => true).catch(() => false)) return false
  if (!(await stat(join(nextBase, TUI_RELEASE_METADATA_FILENAME)).then(() => true).catch(() => false))) {
    return false
  }
  await mkdir(releaseDir, { recursive: true })
  const reserved = new Set(['bin', TUI_RELEASES_DIR])
  for (const entry of await readdir(nextBase, { withFileTypes: true })) {
    if (reserved.has(entry.name)) continue
    await rename(join(nextBase, entry.name), join(releaseDir, entry.name))
  }
  return true
}

/** Replace a legacy-layout launcher with the stable pointer-following launcher. */
async function migrateLegacyLauncher(base: string, platform: NodeJS.Platform): Promise<void> {
  const binDir = join(base, 'bin')
  await mkdir(binDir, { recursive: true })
  const launcherPath = join(binDir, platform === 'win32' ? 'kun.cmd' : 'kun')
  const temporary = `${launcherPath}.tmp-${process.pid}`
  await writeFile(temporary, pointerLauncherScript(platform), { mode: 0o755 })
  if (platform !== 'win32') await chmod(temporary, 0o755)
  await rename(temporary, launcherPath)
  checkTuiUpdateKillPoint('after-launcher-swap')
}

/** Move a legacy install's scattered top-level files into its immutable release dir. */
async function moveLegacyScatteredEntries(base: string, fromReleaseDir: string): Promise<void> {
  await mkdir(fromReleaseDir, { recursive: true })
  const reserved = new Set(['bin', 'current', 'releases'])
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (reserved.has(entry.name)) continue
    await rename(join(base, entry.name), join(fromReleaseDir, entry.name))
  }
}

async function verifyActivatedRelease(base: string, check: TuiUpdateCheck): Promise<void> {
  const activeBuildId = await readPointerBuildId(base)
  if (activeBuildId !== check.latest.buildId) {
    throw new Error('activated standalone TUI pointer does not match the target build')
  }
  const activeReleaseDir = tuiReleaseDirForBuildId(base, activeBuildId)
  const active = parseStandaloneRelease(
    JSON.parse(await readFile(join(activeReleaseDir, TUI_RELEASE_METADATA_FILENAME), 'utf8')) as unknown
  )
  if (
    active.version !== check.latest.version ||
    active.artifactVersion !== check.latest.version ||
    active.buildId !== check.latest.buildId ||
    active.target !== check.current.target
  ) {
    throw new Error('activated standalone TUI metadata does not match the target release')
  }
  await smokeNewRelease(activeReleaseDir, check.latest.version)
}

async function obsoleteReleaseDirs(base: string, keep: readonly string[]): Promise<string[]> {
  const keepSet = new Set(keep)
  return (await listReleaseBuildIds(base))
    .filter((buildId) => !keepSet.has(buildId))
    .map((buildId) => tuiReleaseDirForBuildId(base, buildId))
}

function parseStandaloneRelease(value: unknown): StandaloneTuiReleaseMetadata {
  if (!isRecord(value)) throw new Error('release.json must contain an object')
  const version = typeof value.version === 'string' ? value.version : ''
  const artifactVersion = typeof value.artifactVersion === 'string'
    ? value.artifactVersion
    : ''
  const channelContractMatches = value.channel === 'stable'
    ? value.updateEnabled === true &&
      value.tag === `v${version}` &&
      artifactVersion === version
    : value.channel === 'frontier' &&
      value.updateEnabled === false &&
      value.tag === `dev-${artifactVersion}` &&
      version === `0.0.0-dev-${artifactVersion.replace('.', '-')}`
  if (
    value.schemaVersion !== 1 ||
    value.component !== 'tui' ||
    typeof value.version !== 'string' ||
    !semver.valid(value.version) ||
    typeof value.artifactVersion !== 'string' ||
    typeof value.tag !== 'string' ||
    (value.channel !== 'stable' && value.channel !== 'frontier') ||
    typeof value.target !== 'string' ||
    !STANDALONE_TUI_TARGETS.has(value.target) ||
    typeof value.buildId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.buildId) ||
    typeof value.commit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.commit) ||
    typeof value.updateEnabled !== 'boolean' ||
    typeof value.updateManifestUrl !== 'string' ||
    !isHttpsUrl(value.updateManifestUrl) ||
    !channelContractMatches
  ) {
    throw new Error('release.json has an unsupported standalone TUI contract')
  }
  return {
    schemaVersion: 1,
    component: 'tui',
    version: value.version,
    artifactVersion: value.artifactVersion,
    tag: value.tag,
    channel: value.channel,
    target: value.target,
    buildId: value.buildId,
    commit: value.commit,
    updateEnabled: value.updateEnabled,
    updateManifestUrl: value.updateManifestUrl
  }
}

function parseArtifact(value: unknown): TuiUpdateArtifact {
  if (
    !isRecord(value) ||
    typeof value.target !== 'string' ||
    typeof value.fileName !== 'string' ||
    value.fileName.includes('/') ||
    value.fileName.includes('\\') ||
    !Number.isSafeInteger(value.size) ||
    Number(value.size) <= 0 ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.url !== 'string' ||
    !isHttpsUrl(value.url)
  ) {
    throw new Error('latest-tui.json contains an invalid artifact')
  }
  return {
    target: value.target,
    fileName: value.fileName,
    size: Number(value.size),
    sha256: value.sha256,
    url: value.url
  }
}

async function downloadFile(url: string, destination: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok || !response.body) {
    throw new Error(`update download failed with HTTP ${response.status}`)
  }
  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destination, { mode: 0o600 })
  )
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function validateArchiveEntries(path: string): void {
  const entries = execFileSync('tar', ['-tf', path], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  }).split(/\r?\n/).filter(Boolean)
  if (!entries.length) throw new Error('downloaded update archive is empty')
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    if (
      normalized.startsWith('/') ||
      !normalized.startsWith('kun/') ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`downloaded update contains an unsafe path: ${entry}`)
    }
  }
}

async function smokeNewRelease(root: string, expectedVersion: string): Promise<void> {
  const node = join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
  const entry = join(root, 'app', 'kun', 'dist', 'cli', 'serve-entry.js')
  const output = execFileSync(node, [entry, '--version'], {
    encoding: 'utf8',
    env: { ...process.env, KUN_STANDALONE_ROOT: root },
    timeout: 15_000
  }).trim()
  if (output !== `kun ${expectedVersion}`) {
    throw new Error(`downloaded update smoke returned ${JSON.stringify(output)}`)
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
