import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSelfUpdateCommand, standaloneTuiTarget } from './self-update.js'
import { tuiUpdateResultPath } from './self-update-transaction.js'
import type { StandaloneTuiReleaseMetadata } from './self-update.js'

const BUILD_ID = 'a'.repeat(64)
const NEW_BUILD_ID = 'c'.repeat(64)
const COMMIT = 'b'.repeat(40)

const roots: string[] = []

afterEach(async () => {
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

function latest(buildId = NEW_BUILD_ID) {
  const fileName = 'Kun-TUI-1.2.4-win-x64.zip'
  return {
    schemaVersion: 1,
    component: 'tui',
    version: '1.2.4',
    tag: 'v1.2.4',
    channel: 'stable',
    buildId,
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

async function updateArchive(
  parent: string,
  buildId = NEW_BUILD_ID
): Promise<{ archive: string; bytes: Buffer }> {
  const stage = join(parent, 'next')
  const releaseDir = join(stage, 'kun', 'releases', buildId)
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
    `${JSON.stringify(release({
      version: '1.2.4', artifactVersion: '1.2.4', tag: 'v1.2.4', buildId
    }))}\n`,
    'utf8'
  )
  const archive = join(parent, 'Kun-TUI-1.2.4-win-x64.zip')
  execFileSync('tar', ['-cf', archive, '-C', stage, 'kun'])
  const bytes = await readFile(archive)
  return { archive, bytes }
}

describe.runIf(process.platform === 'win32')('Windows standalone TUI update', () => {
  it('switches the pointer immediately and activates the new release', async () => {
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
    // The pointer is switched in-process; no second launch is required.
    expect((await readFile(join(root, 'current'), 'utf8')).trim()).toBe(`releases/${NEW_BUILD_ID}`)
    expect(JSON.parse(await readFile(join(root, 'releases', NEW_BUILD_ID, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.4' })
    // The update result is written and cleared in-process (no detached swap).
    await expect(stat(tuiUpdateResultPath(root))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 180_000)

  it('fails closed when a newer version reuses the installed build id', async () => {
    const { parent, root } = await installFixture()
    const { bytes } = await updateArchive(parent, BUILD_ID)
    const manifest = latest(BUILD_ID)
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

    expect(code).toBe(70)
    expect(stdout).not.toContain('installed')
    expect(stderr).toContain('reuses buildId')
    expect(JSON.parse(await readFile(join(root, 'release.json'), 'utf8')))
      .toMatchObject({ version: '1.2.3', buildId: BUILD_ID })
    await expect(stat(join(root, 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 180_000)
})

// Keep the import exercised on all platforms so unused-import checks do not
// flag the Windows-only fixture above when skipped elsewhere.
void standaloneTuiTarget
