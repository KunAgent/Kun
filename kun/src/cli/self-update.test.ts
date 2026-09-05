import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkStandaloneTuiUpdate,
  checkStandaloneTuiUpdateOnce,
  parseTuiUpdateManifest,
  runSelfUpdateCommand,
  standaloneTuiTarget,
  type StandaloneTuiReleaseMetadata
} from './self-update.js'
import { pointerLauncherScript } from './self-update-layout.js'
import { acquireRuntimeDataDirMigrationLock } from '../server/runtime-data-dir-migration-lock.js'

const roots: string[] = []
const BUILD_ID = 'a'.repeat(64)
const NEW_BUILD_ID = 'c'.repeat(64)
const COMMIT = 'b'.repeat(40)
const HOST_TARGET = standaloneTuiTarget() ?? 'linux-x64'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('standalone TUI self-update', () => {
  it('maps only the release target matrix', () => {
    expect(standaloneTuiTarget('darwin', 'arm64')).toBe('darwin-arm64')
    expect(standaloneTuiTarget('darwin', 'x64')).toBe('darwin-x64')
    expect(standaloneTuiTarget('linux', 'x64')).toBe('linux-x64')
    expect(standaloneTuiTarget('linux', 'arm64')).toBe('linux-arm64')
    expect(standaloneTuiTarget('win32', 'x64')).toBe('win32-x64')
    expect(standaloneTuiTarget('linux', 'arm')).toBeUndefined()
  })

  it('keeps literal Windows separators in the pointer launcher', () => {
    const launcher = pointerLauncherScript('win32')
    expect(launcher).toContain(String.raw`%~dp0..\current`)
    expect(launcher).toContain(String.raw`%~dp0..\%RELEASE%\runtime\node.exe`)
    expect(launcher).toContain(String.raw`%%D\release.json`)
    expect(launcher).toContain(String.raw`RELEASE=releases\%%~nxD`)
  })

  it('accepts a stable manifest only when it matches the shared release contract', () => {
    const current = release()
    const manifest = parseTuiUpdateManifest(latest(), current)
    expect(manifest.version).toBe('1.2.4')
    expect(manifest.artifacts).toHaveLength(5)
    expect(() => parseTuiUpdateManifest(
      { ...latest(), channel: 'frontier' },
      current
    )).toThrow(/unsupported release contract/)
  })

  it('reports a newer GUI-shared stable version for the installed target', async () => {
    const root = await standaloneRoot(release())
    const result = await checkStandaloneTuiUpdate({
      env: { KUN_STANDALONE_ROOT: root },
      fetch: async () => Response.json(latest())
    })
    expect(result).toMatchObject({
      available: true,
      current: { version: '1.2.3' },
      latest: { version: '1.2.4' },
      artifact: { target: HOST_TARGET }
    })
  })

  it('does not expose self-update from the GUI-bundled TUI', async () => {
    let stderr = ''
    const code = await runSelfUpdateCommand(['--check'], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: {}
    })
    expect(code).toBe(69)
    expect(stderr).toContain('bundled with Kun GUI')
  })

  it('does not write standalone update state for the GUI-bundled TUI', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-gui-update-state-test-'))
    roots.push(dataDir)
    await expect(checkStandaloneTuiUpdateOnce({
      env: {},
      dataDir,
      fetch: async () => {
        throw new Error('GUI-bundled TUI must not fetch standalone updates')
      }
    })).resolves.toBeNull()
    await expect(readFile(join(dataDir, 'tui-update-check.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not recreate a missing migration target for update-check persistence', async () => {
    const root = await standaloneRoot(release())
    const dataDir = join(root, 'missing', 'data')
    const migration = await acquireRuntimeDataDirMigrationLock(dataDir)
    try {
      await expect(checkStandaloneTuiUpdateOnce({
        env: { KUN_STANDALONE_ROOT: root },
        dataDir,
        fetch: async () => Response.json(latest())
      })).rejects.toThrow(/migration is active/)
      await expect(stat(dataDir)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await migration.release()
    }
  })

  it('requires explicit confirmation before downloading an available update', async () => {
    const root = await standaloneRoot(release())
    let stdout = ''
    let requests = 0
    const code = await runSelfUpdateCommand([], {
      stdout: { write: (chunk) => { stdout += chunk } },
      stderr: { write: () => undefined },
      env: { KUN_STANDALONE_ROOT: root },
      fetch: async () => {
        requests += 1
        return Response.json(latest())
      }
    })
    expect(code).toBe(10)
    expect(stdout).toContain('kun update --yes')
    expect(requests).toBe(1)
  })

  it.skipIf(process.platform === 'win32')(
    'installs an authenticated archive and keeps a rollback copy after confirmation',
    async () => {
      const target = standaloneTuiTarget()
      expect(target).toBeTruthy()
      const parent = await mkdtemp(join(tmpdir(), 'kun-self-update-install-'))
      roots.push(parent)
      const currentRoot = join(parent, 'kun')
      await mkdir(currentRoot)
      await writeFile(
        join(currentRoot, 'release.json'),
        `${JSON.stringify(release({ target }))}\n`,
        'utf8'
      )
      const archive = await updateArchive(parent, target!)
      const bytes = await readFile(archive)
      const next = latest()
      const selected = next.artifacts.find((artifact) => artifact.target === target)!
      selected.size = bytes.length
      selected.sha256 = createHash('sha256').update(bytes).digest('hex')
      let output = ''
      const code = await runSelfUpdateCommand(['--yes'], {
        stdout: { write: (chunk) => { output += chunk } },
        stderr: { write: () => undefined },
        env: { KUN_STANDALONE_ROOT: currentRoot },
        fetch: async (url) => String(url).endsWith('latest-tui.json')
          ? Response.json(next)
          : new Response(bytes)
      })
      expect(code).toBe(0)
      expect(output).toContain('1.2.4 installed')
      // The new release is referenced by the pointer and immutable under releases/.
      expect((await readFile(join(currentRoot, 'current'), 'utf8')).trim())
        .toBe(`releases/${NEW_BUILD_ID}`)
      expect(JSON.parse(await readFile(join(currentRoot, 'releases', NEW_BUILD_ID, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.4', target })
      // The previous release was migrated into its own immutable directory.
      expect(JSON.parse(await readFile(join(currentRoot, 'releases', BUILD_ID, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.3', target })
      // The cross-process update lock is always released after a swap.
      await expect(stat(join(parent, '.kun.kun-tui-update.lock')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    },
    30_000
  )

  it.skipIf(process.platform === 'win32')(
    'fails closed before mutating a legacy install when a newer version reuses its build id',
    async () => {
      const target = standaloneTuiTarget()!
      const currentRoot = await standaloneRoot(release({ target }))
      const archive = await updateArchive(dirname(currentRoot), target, BUILD_ID)
      const bytes = await readFile(archive)
      const next = { ...latest(), buildId: BUILD_ID }
      const selected = next.artifacts.find((artifact) => artifact.target === target)!
      selected.size = bytes.length
      selected.sha256 = createHash('sha256').update(bytes).digest('hex')
      let stdout = ''
      let stderr = ''

      const code = await runSelfUpdateCommand(['--yes'], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: (chunk) => { stderr += chunk } },
        env: { KUN_STANDALONE_ROOT: currentRoot },
        fetch: async (url) => String(url).endsWith('latest-tui.json')
          ? Response.json(next)
          : new Response(bytes)
      })

      expect(code).toBe(70)
      expect(stdout).not.toContain('installed')
      expect(stderr).toContain('reuses buildId')
      expect(JSON.parse(await readFile(join(currentRoot, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.3', buildId: BUILD_ID })
      await expect(stat(join(currentRoot, 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
    30_000
  )

  it.skipIf(process.platform === 'win32')(
    'installs a flat archive into a legacy install and migrates it to the pointer layout',
    async () => {
      const target = standaloneTuiTarget()!
      const currentRoot = await standaloneRoot(release({ target }))
      const archive = await updateFlatArchive(dirname(currentRoot), target)
      const bytes = await readFile(archive)
      const next = latest()
      const selected = next.artifacts.find((artifact) => artifact.target === target)!
      selected.size = bytes.length
      selected.sha256 = createHash('sha256').update(bytes).digest('hex')
      let output = ''
      const code = await runSelfUpdateCommand(['--yes'], {
        stdout: { write: (chunk) => { output += chunk } },
        stderr: { write: () => undefined },
        env: { KUN_STANDALONE_ROOT: currentRoot },
        fetch: async (url) => String(url).endsWith('latest-tui.json')
          ? Response.json(next)
          : new Response(bytes)
      })
      expect(code).toBe(0)
      expect(output).toContain('1.2.4 installed')
      expect((await readFile(join(currentRoot, 'current'), 'utf8')).trim()).toBe(`releases/${NEW_BUILD_ID}`)
      expect(JSON.parse(await readFile(join(currentRoot, 'releases', NEW_BUILD_ID, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.4', target })
      expect(JSON.parse(await readFile(join(currentRoot, 'releases', BUILD_ID, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.3', target })
    },
    30_000
  )

  it.skipIf(process.platform === 'win32')(
    'installs a flat archive over a pointer install by switching the pointer only',
    async () => {
      const target = standaloneTuiTarget()!
      const parent = await mkdtemp(join(tmpdir(), 'kun-self-update-flat-pointer-'))
      roots.push(parent)
      const currentRoot = await pointerRoot(parent, release({ target }))
      const archive = await updateFlatArchive(parent, target)
      const bytes = await readFile(archive)
      const next = latest()
      const selected = next.artifacts.find((artifact) => artifact.target === target)!
      selected.size = bytes.length
      selected.sha256 = createHash('sha256').update(bytes).digest('hex')
      let output = ''
      const code = await runSelfUpdateCommand(['--yes'], {
        stdout: { write: (chunk) => { output += chunk } },
        stderr: { write: () => undefined },
        env: { KUN_STANDALONE_ROOT: currentRoot },
        fetch: async (url) => String(url).endsWith('latest-tui.json')
          ? Response.json(next)
          : new Response(bytes)
      })
      expect(code).toBe(0)
      expect(output).toContain('1.2.4 installed')
      expect((await readFile(join(currentRoot, 'current'), 'utf8')).trim()).toBe(`releases/${NEW_BUILD_ID}`)
      expect(JSON.parse(await readFile(join(currentRoot, 'releases', NEW_BUILD_ID, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.4', target })
      expect(JSON.parse(await readFile(join(currentRoot, 'releases', BUILD_ID, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.3', target })
    },
    30_000
  )

  it.skipIf(process.platform === 'win32')(
    'fails closed before mutating a legacy install when a flat archive mismatches the manifest',
    async () => {
      const target = standaloneTuiTarget()!
      const currentRoot = await standaloneRoot(release({ target }))
      const archive = await updateFlatArchive(dirname(currentRoot), target, 'd'.repeat(64))
      const bytes = await readFile(archive)
      const next = latest()
      const selected = next.artifacts.find((artifact) => artifact.target === target)!
      selected.size = bytes.length
      selected.sha256 = createHash('sha256').update(bytes).digest('hex')
      let stdout = ''
      let stderr = ''
      const code = await runSelfUpdateCommand(['--yes'], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: (chunk) => { stderr += chunk } },
        env: { KUN_STANDALONE_ROOT: currentRoot },
        fetch: async (url) => String(url).endsWith('latest-tui.json')
          ? Response.json(next)
          : new Response(bytes)
      })
      expect(code).toBe(70)
      expect(stdout).not.toContain('installed')
      expect(stderr).toContain('does not match latest-tui.json')
      expect(JSON.parse(await readFile(join(currentRoot, 'release.json'), 'utf8')))
        .toMatchObject({ version: '1.2.3', buildId: BUILD_ID })
      await expect(stat(join(currentRoot, 'current'))).rejects.toMatchObject({ code: 'ENOENT' })
    },
    30_000
  )

  it('reports a recorded pending-update result before checking for updates', async () => {
    const root = await standaloneRoot(release())
    const transactionDir = join(dirname(root), '.kun.kun-tui-update')
    await mkdir(transactionDir, { recursive: true })
    await writeFile(join(transactionDir, 'transaction.json'), `${JSON.stringify({
      schemaVersion: 1,
      previousVersion: '1.2.3',
      targetVersion: '1.2.4',
      buildId: BUILD_ID,
      installRoot: root,
      stagingRoot: join(dirname(root), '.kun-update-gone'),
      backupRoot: `${root}.previous`,
      pid: process.pid,
      token: 'token',
      startedAt: new Date().toISOString()
    })}\n`, 'utf8')
    await writeFile(join(transactionDir, 'update-result.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'succeeded',
      previousVersion: '1.2.3',
      targetVersion: '1.2.4',
      finishedAt: new Date().toISOString()
    })}\n`, 'utf8')
    let stdout = ''
    let fetches = 0
    const code = await runSelfUpdateCommand([], {
      stdout: { write: (chunk) => { stdout += chunk } },
      stderr: { write: () => undefined },
      env: { KUN_STANDALONE_ROOT: root },
      fetch: async () => {
        fetches += 1
        return Response.json(latest())
      }
    })
    expect(code).toBe(0)
    expect(stdout).toContain('1.2.4 is now active')
    // The recorded outcome short-circuits; no new manifest request is needed.
    expect(fetches).toBe(0)
  })

  it('surfaces a failed pending update with a retry hint', async () => {
    const root = await standaloneRoot(release())
    const transactionDir = join(dirname(root), '.kun.kun-tui-update')
    await mkdir(transactionDir, { recursive: true })
    await writeFile(join(transactionDir, 'transaction.json'), `${JSON.stringify({
      schemaVersion: 1,
      previousVersion: '1.2.3',
      targetVersion: '1.2.4',
      buildId: BUILD_ID,
      installRoot: root,
      stagingRoot: join(dirname(root), '.kun-update-gone'),
      backupRoot: `${root}.previous`,
      pid: process.pid,
      token: 'token',
      startedAt: new Date().toISOString()
    })}\n`, 'utf8')
    await writeFile(join(transactionDir, 'update-result.json'), `${JSON.stringify({
      schemaVersion: 1,
      status: 'failed',
      stage: 'swap',
      error: 'IOException: <install> is locked',
      previousVersion: '1.2.3',
      targetVersion: '1.2.4',
      finishedAt: new Date().toISOString()
    })}\n`, 'utf8')
    let stderr = ''
    const code = await runSelfUpdateCommand([], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: { KUN_STANDALONE_ROOT: root },
      fetch: async () => {
        throw new Error('must not fetch while reporting a failed update')
      }
    })
    expect(code).toBe(70)
    expect(stderr).toContain('during swap')
    expect(stderr).toContain('kun update --yes')
  })

  it('returns 70 and skips fetching while another update is busy', async () => {
    const root = await standaloneRoot(release())
    const transactionDir = join(dirname(root), '.kun.kun-tui-update')
    await mkdir(transactionDir, { recursive: true })
    await writeFile(join(transactionDir, 'transaction.json'), `${JSON.stringify({
      schemaVersion: 1,
      previousVersion: '1.2.3',
      targetVersion: '1.2.4',
      buildId: BUILD_ID,
      installRoot: root,
      stagingRoot: join(dirname(root), '.kun-update-gone'),
      backupRoot: `${root}.previous`,
      pid: process.pid,
      token: 'token',
      startedAt: new Date().toISOString()
    })}\n`, 'utf8')
    await writeFile(join(transactionDir, 'updater.json'), `${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      token: 'token',
      startedAt: new Date().toISOString()
    })}\n`, 'utf8')
    let stderr = ''
    let fetches = 0
    const code = await runSelfUpdateCommand(['--yes'], {
      stdout: { write: () => undefined },
      stderr: { write: (chunk) => { stderr += chunk } },
      env: { KUN_STANDALONE_ROOT: root },
      fetch: async () => {
        fetches += 1
        return Response.json(latest())
      }
    })
    expect(code).toBe(70)
    expect(stderr).toContain('another update is already in progress')
    expect(stderr).toContain(`process ${process.pid}`)
    expect(fetches).toBe(0)
  })

  it('throttles startup checks for 24 hours', async () => {
    const root = await standaloneRoot(release())
    const dataDir = join(root, 'data')
    let requests = 0
    const fetch = async () => {
      requests += 1
      return Response.json(latest())
    }
    const first = await checkStandaloneTuiUpdateOnce({
      env: { KUN_STANDALONE_ROOT: root },
      dataDir,
      fetch,
      now: Date.parse('2026-07-29T00:00:00.000Z')
    })
    const second = await checkStandaloneTuiUpdateOnce({
      env: { KUN_STANDALONE_ROOT: root },
      dataDir,
      fetch,
      now: Date.parse('2026-07-29T01:00:00.000Z')
    })
    expect(first?.available).toBe(true)
    expect(second).toBeNull()
    expect(requests).toBe(1)
    expect(JSON.parse(await readFile(join(dataDir, 'tui-update-check.json'), 'utf8')))
      .toMatchObject({ currentVersion: '1.2.3', latestVersion: '1.2.4', available: true })
  })
})

function release(
  overrides: Partial<StandaloneTuiReleaseMetadata> = {}
): StandaloneTuiReleaseMetadata {
  return {
    schemaVersion: 1,
    component: 'tui',
    version: '1.2.3',
    artifactVersion: '1.2.3',
    tag: 'v1.2.3',
    channel: 'stable',
    target: HOST_TARGET,
    buildId: BUILD_ID,
    commit: COMMIT,
    updateEnabled: true,
    updateManifestUrl: 'https://downloads.example.test/latest-tui.json',
    ...overrides
  }
}

function latest() {
  return {
    schemaVersion: 1,
    productName: 'Kun',
    component: 'tui',
    version: '1.2.4',
    artifactVersion: '1.2.4',
    tag: 'v1.2.4',
    channel: 'stable',
    commit: COMMIT,
    buildId: NEW_BUILD_ID,
    releaseDate: '2026-07-29T00:00:00.000Z',
    generatedAt: '2026-07-29T00:00:00.000Z',
    githubReleaseUrl: 'https://github.com/KunAgent/Kun/releases/tag/v1.2.4',
    artifacts: [
      artifact('darwin-arm64', 'mac', 'arm64', 'tar.gz'),
      artifact('darwin-x64', 'mac', 'x64', 'tar.gz'),
      artifact('linux-arm64', 'linux', 'arm64', 'tar.gz'),
      artifact('linux-x64', 'linux', 'x64', 'tar.gz'),
      artifact('win32-x64', 'win', 'x64', 'zip')
    ]
  }
}

function artifact(target: string, os: string, arch: string, format: string) {
  const fileName = `Kun-TUI-1.2.4-${os}-${arch}.${format}`
  return {
    target,
    platform: target.split('-')[0],
    os,
    arch,
    format,
    fileName,
    size: 123,
    sha256: 'c'.repeat(64),
    nodeVersion: '22.23.1',
    url: `https://downloads.example.test/${fileName}`
  }
}

async function standaloneRoot(metadata: StandaloneTuiReleaseMetadata): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'kun-self-update-test-'))
  roots.push(parent)
  const root = join(parent, 'kun')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'release.json'), `${JSON.stringify(metadata)}\n`, 'utf8')
  return root
}

async function updateArchive(
  parent: string,
  target: string,
  buildId = NEW_BUILD_ID
): Promise<string> {
  const stage = join(parent, 'next')
  const root = join(stage, 'kun', 'releases', buildId)
  const node = join(root, 'runtime', 'node')
  const entry = join(root, 'app', 'kun', 'dist', 'cli', 'serve-entry.js')
  await mkdir(join(entry, '..'), { recursive: true })
  await mkdir(join(root, 'runtime'), { recursive: true })
  await copyFile(process.execPath, node)
  await chmod(node, 0o755)
  await writeFile(
    entry,
    "if (process.argv.includes('--version')) process.stdout.write('kun 1.2.4\\n')\n",
    'utf8'
  )
  await writeFile(
    join(root, 'release.json'),
    `${JSON.stringify(release({
      version: '1.2.4',
      artifactVersion: '1.2.4',
      tag: 'v1.2.4',
      target,
      buildId,
      commit: COMMIT
    }))}\n`,
    'utf8'
  )
  const archive = join(parent, `Kun-TUI-1.2.4-${targetName(target)}`)
  execFileSync('tar', ['-czf', archive, '-C', stage, 'kun'])
  return archive
}

async function pointerRoot(parent: string, metadata: StandaloneTuiReleaseMetadata): Promise<string> {
  const base = join(parent, 'kun')
  const dir = join(base, 'releases', metadata.buildId)
  await mkdir(join(dir, 'runtime'), { recursive: true })
  await mkdir(join(dir, 'app', 'kun', 'dist', 'cli'), { recursive: true })
  await copyFile(process.execPath, join(dir, 'runtime', 'node'))
  await chmod(join(dir, 'runtime', 'node'), 0o755)
  await writeFile(
    join(dir, 'app', 'kun', 'dist', 'cli', 'serve-entry.js'),
    "if (process.argv.includes('--version')) process.stdout.write('kun 1.2.3\\n')\n",
    'utf8'
  )
  await writeFile(join(dir, 'release.json'), `${JSON.stringify(metadata)}\n`, 'utf8')
  await writeFile(join(base, 'current'), `releases/${metadata.buildId}\n`, 'utf8')
  return base
}

async function updateFlatArchive(
  parent: string,
  target: string,
  buildId = NEW_BUILD_ID
): Promise<string> {
  const stage = join(parent, 'next-flat')
  const root = join(stage, 'kun')
  const node = join(root, 'runtime', 'node')
  const entry = join(root, 'app', 'kun', 'dist', 'cli', 'serve-entry.js')
  await mkdir(join(root, 'bin'), { recursive: true })
  await mkdir(join(entry, '..'), { recursive: true })
  await mkdir(join(root, 'runtime'), { recursive: true })
  await copyFile(process.execPath, node)
  await chmod(node, 0o755)
  await writeFile(join(root, 'bin', 'kun'), '#!/bin/sh\necho flat launcher\n', 'utf8')
  await writeFile(
    entry,
    "if (process.argv.includes('--version')) process.stdout.write('kun 1.2.4\\n')\n",
    'utf8'
  )
  await writeFile(
    join(root, 'release.json'),
    `${JSON.stringify(release({
      version: '1.2.4',
      artifactVersion: '1.2.4',
      tag: 'v1.2.4',
      target,
      buildId,
      commit: COMMIT
    }))}\n`,
    'utf8'
  )
  const archive = join(parent, `Kun-TUI-1.2.4-${targetName(target)}`)
  execFileSync('tar', ['-czf', archive, '-C', stage, 'kun'])
  return archive
}

function targetName(target: string): string {
  if (target === 'darwin-arm64') return 'mac-arm64.tar.gz'
  if (target === 'darwin-x64') return 'mac-x64.tar.gz'
  if (target === 'linux-arm64') return 'linux-arm64.tar.gz'
  if (target === 'linux-x64') return 'linux-x64.tar.gz'
  throw new Error(`Unsupported Unix test target: ${target}`)
}
