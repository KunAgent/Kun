import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSelfUpdateCommand, type StandaloneTuiReleaseMetadata } from './self-update.js'
import {
  tuiUpdateLockPath,
  tuiUpdateTransactionPath
} from './self-update-transaction.js'

const BUILD_ID = 'a'.repeat(64)
const NEW_BUILD_ID = 'c'.repeat(64)
const COMMIT = 'b'.repeat(40)

const mocks = vi.hoisted(() => ({
  scheduleWindowsGarbageCollection: vi.fn()
}))

vi.mock('./self-update-windows.js', () => ({
  scheduleWindowsGarbageCollection: mocks.scheduleWindowsGarbageCollection
}))

const roots: string[] = []

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
const originalArchDescriptor = Object.getOwnPropertyDescriptor(process, 'arch')

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true })
  mocks.scheduleWindowsGarbageCollection.mockReset()
  mocks.scheduleWindowsGarbageCollection.mockResolvedValue({
    pid: 4242,
    startedAt: '2026-01-01T00:00:00.000Z'
  })
})

afterEach(async () => {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor)
  }
  if (originalArchDescriptor) {
    Object.defineProperty(process, 'arch', originalArchDescriptor)
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
    target: 'win32-x64',
    buildId: BUILD_ID,
    commit: COMMIT,
    updateEnabled: true,
    updateManifestUrl: 'https://downloads.example.test/latest-tui.json',
    ...overrides
  }
}

function latest() {
  const fileName = 'Kun-TUI-1.2.4-win-x64.zip'
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
      { target: 'win32-x64', fileName, size: 0, sha256: '0'.repeat(64), url: `https://downloads.example.test/${fileName}` }
    ]
  }
}

async function installFixture(): Promise<{ parent: string; root: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'kun-win-update-it-'))
  roots.push(parent)
  const root = join(parent, 'kun')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'release.json'), `${JSON.stringify(release())}\n`, 'utf8')
  return { parent, root }
}

async function updateArchive(parent: string): Promise<{ archive: string; bytes: Buffer }> {
  const stage = join(parent, 'next')
  const releaseDir = join(stage, 'kun', 'releases', NEW_BUILD_ID)
  const entry = join(releaseDir, 'app', 'kun', 'dist', 'cli')
  await mkdir(entry, { recursive: true })
  await mkdir(join(releaseDir, 'runtime'), { recursive: true })
  await copyFile(process.execPath, join(releaseDir, 'runtime', 'node.exe'))
  await writeFile(
    join(entry, 'serve-entry.js'),
    "if (process.argv.includes('--version')) process.stdout.write('kun 1.2.4\\n')\n",
    'utf8'
  )
  await writeFile(
    join(releaseDir, 'release.json'),
    `${JSON.stringify(release({ version: '1.2.4', artifactVersion: '1.2.4', tag: 'v1.2.4', buildId: NEW_BUILD_ID }))}\n`,
    'utf8'
  )
  const archive = join(parent, 'Kun-TUI-1.2.4-win-x64.zip')
  execFileSync('tar', ['-cf', archive, '-C', stage, 'kun'])
  const bytes = await readFile(archive)
  return { archive, bytes }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

describe('Windows unified standalone TUI update', () => {
  it('switches the pointer, writes the result, and schedules garbage collection', async () => {
    const { parent, root } = await installFixture()
    const { bytes } = await updateArchive(parent)
    const manifest = latest()
    const artifact = manifest.artifacts.find((candidate) => candidate.target === 'win32-x64')!
    artifact.size = bytes.length
    artifact.sha256 = createHash('sha256').update(bytes).digest('hex')

    let stdout = ''
    let stderr = ''
    const code = await runSelfUpdateCommand(['--yes'], {
      stdout: { write: (chunk) => { stdout += chunk } },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: { KUN_STANDALONE_ROOT: root },
      fetch: async (url) => String(url).endsWith('latest-tui.json')
        ? Response.json(manifest)
        : new Response(new Uint8Array(bytes))
    })

    expect(code).toBe(0)
    expect(stdout).toContain('1.2.4 installed')
    expect(stderr).toBe('')
    // The new release directory is in place and referenced by the pointer.
    expect(JSON.parse(await readFile(join(root, 'releases', NEW_BUILD_ID, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.4' })
    expect((await readFile(join(root, 'current'), 'utf8')).trim()).toBe(`releases/${NEW_BUILD_ID}`)
    // Legacy scattered files were moved into the old release dir during migration.
    const legacyEntries = (await readdir(root)).sort()
    expect(legacyEntries).toEqual(['bin', 'current', 'releases'])
    expect(JSON.parse(await readFile(join(root, 'releases', BUILD_ID, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3' })
    // The lock and transaction are released/cleared.
    expect(await exists(tuiUpdateLockPath(root))).toBe(false)
    expect(await exists(tuiUpdateTransactionPath(root))).toBe(false)
    // The detached GC was scheduled.
    expect(mocks.scheduleWindowsGarbageCollection).toHaveBeenCalledTimes(1)
  }, 120_000)
})
