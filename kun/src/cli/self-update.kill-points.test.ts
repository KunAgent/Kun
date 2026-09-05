import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  readStandaloneTuiRelease,
  standaloneTuiTarget,
  type StandaloneTuiReleaseMetadata
} from './self-update.js'
import { reconcilePendingTuiUpdate } from './self-update-reconcile.js'
import { pointerLauncherScript } from './self-update-layout.js'

const BUILD_ID = 'a'.repeat(64)
const NEW_BUILD_ID = 'c'.repeat(64)
const COMMIT = 'b'.repeat(40)

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const distEntry = resolve(repoRoot, 'kun', 'dist', 'cli', 'self-update.js')

const roots: string[] = []
const children: ChildProcess[] = []
let childScript = ''

beforeAll(async () => {
  if (!existsSync(distEntry)) {
    execFileSync('npm', ['--prefix', 'kun', 'run', 'build'], {
      cwd: repoRoot,
      stdio: 'inherit'
    })
  }
  childScript = join(tmpdir(), `kun-kill-point-child-${process.pid}.mjs`)
  await writeFile(
    childScript,
    `import { runSelfUpdateCommand } from ${JSON.stringify(pathToFileURL(distEntry).href)}\n` +
      "import { readFile } from 'node:fs/promises'\n" +
      "const manifest = JSON.parse(await readFile(process.env.TUI_TEST_MANIFEST, 'utf8'))\n" +
      'const archive = await readFile(process.env.TUI_TEST_ARCHIVE)\n' +
      "const fetchImpl = async (url) => String(url).endsWith('latest-tui.json')\n" +
      '  ? Response.json(manifest)\n' +
      '  : new Response(new Uint8Array(archive))\n' +
      "const code = await runSelfUpdateCommand(['--yes'], {\n" +
      "  stdout: { write: () => {} },\n" +
      "  stderr: { write: (chunk) => process.stderr.write(chunk) },\n" +
      '  env: process.env,\n' +
      '  fetch: fetchImpl\n' +
      '})\n' +
      'process.exit(code)\n',
    'utf8'
  )
}, 300_000)

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already exited.
    }
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function release(overrides: Partial<StandaloneTuiReleaseMetadata> = {}): StandaloneTuiReleaseMetadata {
  return {
    schemaVersion: 1,
    component: 'tui',
    version: '1.2.3',
    artifactVersion: '1.2.3',
    tag: 'v1.2.3',
    channel: 'stable',
    target: standaloneTuiTarget() ?? 'linux-x64',
    buildId: BUILD_ID,
    commit: COMMIT,
    updateEnabled: true,
    updateManifestUrl: 'https://downloads.example.test/latest-tui.json',
    ...overrides
  }
}

function latest() {
  const target = standaloneTuiTarget() as string
  return {
    schemaVersion: 1,
    component: 'tui',
    version: '1.2.4',
    tag: 'v1.2.4',
    channel: 'stable',
    buildId: NEW_BUILD_ID,
    artifacts: [
      { target: 'darwin-arm64', fileName: 'Kun-TUI-1.2.4-mac-arm64.tar.gz', size: 123, sha256: 'c'.repeat(64), url: 'https://downloads.example.test/a' },
      { target: 'darwin-x64', fileName: 'Kun-TUI-1.2.4-mac-x64.tar.gz', size: 123, sha256: 'c'.repeat(64), url: 'https://downloads.example.test/b' },
      { target: 'linux-arm64', fileName: 'Kun-TUI-1.2.4-linux-arm64.tar.gz', size: 123, sha256: 'c'.repeat(64), url: 'https://downloads.example.test/c' },
      { target: 'linux-x64', fileName: 'Kun-TUI-1.2.4-linux-x64.tar.gz', size: 123, sha256: 'c'.repeat(64), url: 'https://downloads.example.test/d' },
      { target: 'win32-x64', fileName: 'Kun-TUI-1.2.4-win-x64.zip', size: 123, sha256: 'c'.repeat(64), url: 'https://downloads.example.test/e' }
    ].map((artifact) => artifact.target === target
      ? { ...artifact, fileName: `Kun-TUI-1.2.4-${targetName(target)}` }
      : artifact)
  }
}

function targetName(target: string): string {
  if (target === 'darwin-arm64') return 'mac-arm64.tar.gz'
  if (target === 'darwin-x64') return 'mac-x64.tar.gz'
  if (target === 'linux-arm64') return 'linux-arm64.tar.gz'
  if (target === 'linux-x64') return 'linux-x64.tar.gz'
  throw new Error(`Unsupported Unix test target: ${target}`)
}

function fakeServeEntry(version: string): string {
  return "if (process.argv.includes('--version')) process.stdout.write('kun " + version + "\\n')\n"
}

async function writeReleaseDir(base: string, buildId: string, version: string): Promise<void> {
  const dir = join(base, 'releases', buildId)
  await mkdir(join(dir, 'runtime'), { recursive: true })
  await mkdir(join(dir, 'app', 'kun', 'dist', 'cli'), { recursive: true })
  await copyFile(process.execPath, join(dir, 'runtime', 'node'))
  await chmod(join(dir, 'runtime', 'node'), 0o755)
  await writeFile(join(dir, 'app', 'kun', 'dist', 'cli', 'serve-entry.js'), fakeServeEntry(version), 'utf8')
  await writeFile(
    join(dir, 'release.json'),
    `${JSON.stringify(release({ version, artifactVersion: version, tag: `v${version}`, buildId }))}\n`,
    'utf8'
  )
}

/** A fresh pointer-layout install at version 1.2.3. */
async function newLayoutInstall(parent: string): Promise<string> {
  const base = join(parent, 'kun')
  await mkdir(join(base, 'bin'), { recursive: true })
  await writeFile(join(base, 'bin', 'kun'), pointerLauncherScript(process.platform), { mode: 0o755 })
  await writeFile(join(base, 'current'), `releases/${BUILD_ID}\n`, 'utf8')
  await writeReleaseDir(base, BUILD_ID, '1.2.3')
  return base
}

/** A legacy-layout install at version 1.2.3. */
async function legacyInstall(parent: string): Promise<string> {
  const base = join(parent, 'kun')
  await mkdir(join(base, 'runtime'), { recursive: true })
  await mkdir(join(base, 'app', 'kun', 'dist', 'cli'), { recursive: true })
  await copyFile(process.execPath, join(base, 'runtime', 'node'))
  await chmod(join(base, 'runtime', 'node'), 0o755)
  await writeFile(join(base, 'app', 'kun', 'dist', 'cli', 'serve-entry.js'), fakeServeEntry('1.2.3'), 'utf8')
  await writeFile(join(base, 'release.json'), `${JSON.stringify(release())}\n`, 'utf8')
  return base
}

async function updateArchive(parent: string): Promise<{ archive: string; manifest: string }> {
  const stage = join(parent, 'next')
  await writeReleaseDir(join(stage, 'kun'), NEW_BUILD_ID, '1.2.4')
  const archive = join(parent, 'Kun-TUI-1.2.4.tar.gz')
  execFileSync('tar', ['-czf', archive, '-C', stage, 'kun'])
  const archiveBytes = await readFile(archive)
  const manifest = latest()
  const target = standaloneTuiTarget() as string
  const artifact = manifest.artifacts.find((candidate) => candidate.target === target) as {
    size: number
    sha256: string
  }
  artifact.size = archiveBytes.length
  artifact.sha256 = createHash('sha256').update(archiveBytes).digest('hex')
  const manifestPath = join(parent, 'latest-tui.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8')
  return { archive, manifest: manifestPath }
}

async function runUpdateChild(base: string, archive: string, manifest: string, killPoint: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [childScript], {
    env: {
      ...process.env,
      KUN_STANDALONE_ROOT: base,
      KUN_TUI_UPDATE_KILL_POINT: killPoint,
      TUI_TEST_MANIFEST: manifest,
      TUI_TEST_ARCHIVE: archive
    },
    stdio: ['ignore', 'ignore', 'inherit']
  })
  children.push(child)
  return child
}

async function childExit(child: ChildProcess): Promise<{ signal: string | null; code: number | null }> {
  const [code, signal] = await once(child, 'exit')
  return { signal: signal as string | null, code: code as number | null }
}

async function assertInstallUsable(base: string): Promise<void> {
  const standalone = await readStandaloneTuiRelease({ KUN_STANDALONE_ROOT: base })
  expect(standalone).not.toBeNull()
  const report = await reconcilePendingTuiUpdate(base)
  if (report) expect(report.kind).not.toBe('busy')
}

describe.runIf(process.platform !== 'win32')('standalone TUI self-update kill points', () => {
  for (const killPoint of ['after-stage-verify', 'after-release-move', 'after-transaction', 'after-pointer-swap']) {
    it(`keeps a pointer-layout install usable when killed at ${killPoint}`, async () => {
      const parent = await mkdtemp(join(tmpdir(), 'kun-kill-point-'))
      roots.push(parent)
      const base = await newLayoutInstall(parent)
      const { archive, manifest } = await updateArchive(parent)

      const child = await runUpdateChild(base, archive, manifest, killPoint)
      const exit = await childExit(child)
      expect(exit.signal).toBe('SIGKILL')

      await assertInstallUsable(base)
    }, 120_000)
  }

  for (const killPoint of ['after-launcher-swap', 'after-legacy-move']) {
    it(`keeps a legacy install usable when killed at ${killPoint}`, async () => {
      const parent = await mkdtemp(join(tmpdir(), 'kun-kill-point-legacy-'))
      roots.push(parent)
      const base = await legacyInstall(parent)
      const { archive, manifest } = await updateArchive(parent)

      const child = await runUpdateChild(base, archive, manifest, killPoint)
      const exit = await childExit(child)
      expect(exit.signal).toBe('SIGKILL')

      await assertInstallUsable(base)
    }, 120_000)
  }
})
