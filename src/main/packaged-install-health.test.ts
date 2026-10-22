import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectPackagedInstallHealth,
  resolveInstallHealthFileStat
} from './packaged-install-health'

describe('inspectPackagedInstallHealth', () => {
  let directory = ''

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
    directory = ''
  })

  async function createHealthyPayload(): Promise<{ executablePath: string; resourcesPath: string }> {
    directory = await mkdtemp(join(tmpdir(), 'kun-packaged-install-health-'))
    const resourcesPath = join(directory, 'resources')
    const executablePath = join(directory, 'Kun.exe')
    await mkdir(join(resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'cli'), { recursive: true })
    await mkdir(join(resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'manager'), { recursive: true })
    await Promise.all([
      writeFile(executablePath, 'exe'),
      writeFile(join(resourcesPath, 'app.asar'), 'asar'),
      writeFile(join(resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js'), 'serve'),
      writeFile(join(resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'), 'manager')
    ])
    return { executablePath, resourcesPath }
  }

  it('accepts a complete packaged payload', async () => {
    const input = await createHealthyPayload()

    expect(inspectPackagedInstallHealth({ isPackaged: true, ...input })).toEqual({ ok: true })
  })

  it('reports every missing or empty runtime component', async () => {
    const input = await createHealthyPayload()
    await writeFile(join(input.resourcesPath, 'app.asar'), '')
    await rm(join(input.resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'manager', 'manager-entry.js'))

    expect(inspectPackagedInstallHealth({ isPackaged: true, ...input })).toEqual({
      ok: false,
      missing: ['resources/app.asar', 'Kun service manager entry']
    })
  })

  it('does not block source and development runs', () => {
    expect(inspectPackagedInstallHealth({
      isPackaged: false,
      executablePath: 'missing.exe',
      resourcesPath: 'missing-resources'
    })).toEqual({ ok: true })
  })

  it('uses Electron original-fs so app.asar is checked as a physical file', () => {
    const rawStat = resolveInstallHealthFileStat((id) => {
      expect(id).toBe('original-fs')
      return {
        statSync: () => ({
          isFile: () => true,
          size: 42
        })
      }
    })

    expect(rawStat('resources/app.asar').isFile()).toBe(true)
    expect(rawStat('resources/app.asar').size).toBe(42)
  })

  async function writeIntegrityManifest(
    resourcesPath: string,
    files: { path: string, size: number }[],
    modules: { name: string, dir: string }[]
  ): Promise<void> {
    await writeFile(
      join(resourcesPath, 'kun-runtime-integrity.json'),
      JSON.stringify({ schemaVersion: 1, files, modules })
    )
  }

  it('reports a runtime package that the integrity manifest expects but is missing', async () => {
    const input = await createHealthyPayload()
    const packageJson = join(
      input.resourcesPath,
      'app.asar.unpacked',
      'kun',
      'node_modules',
      '@earendil-works',
      'pi-tui',
      'package.json'
    )
    await mkdir(join(packageJson, '..'), { recursive: true })
    await writeFile(packageJson, JSON.stringify({ name: '@earendil-works/pi-tui', version: '0.81.1' }))
    const serveEntry = join(input.resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js')
    await writeIntegrityManifest(
      input.resourcesPath,
      [{ path: 'app.asar.unpacked/kun/dist/cli/serve-entry.js', size: (await stat(serveEntry)).size }],
      [{ name: '@earendil-works/pi-tui', dir: 'app.asar.unpacked/kun/node_modules/@earendil-works/pi-tui' }]
    )

    expect(inspectPackagedInstallHealth({ isPackaged: true, ...input })).toEqual({ ok: true })

    // The reported failure: the compiled runtime still imports the package but
    // the unpacked payload no longer contains it.
    await rm(join(packageJson, '..'), { recursive: true, force: true })

    expect(inspectPackagedInstallHealth({ isPackaged: true, ...input })).toEqual({
      ok: false,
      missing: ['Kun runtime package is missing: @earendil-works/pi-tui']
    })
  })

  it('reports a runtime file that was truncated after installation', async () => {
    const input = await createHealthyPayload()
    const serveEntry = join(input.resourcesPath, 'app.asar.unpacked', 'kun', 'dist', 'cli', 'serve-entry.js')
    await writeIntegrityManifest(
      input.resourcesPath,
      [{ path: 'app.asar.unpacked/kun/dist/cli/serve-entry.js', size: (await stat(serveEntry)).size }],
      [{ name: 'zod', dir: 'app.asar.unpacked/kun/node_modules/zod' }]
    )
    await writeFile(serveEntry, 'se')

    expect(inspectPackagedInstallHealth({ isPackaged: true, ...input })).toEqual({
      ok: false,
      missing: [
        'Kun runtime file is truncated: app.asar.unpacked/kun/dist/cli/serve-entry.js',
        'Kun runtime package is missing: zod'
      ]
    })
  })

  it('keeps working for installs that shipped no integrity manifest', async () => {
    const input = await createHealthyPayload()

    expect(inspectPackagedInstallHealth({ isPackaged: true, ...input })).toEqual({ ok: true })
  })
})
