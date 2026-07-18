import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createExtensionCliServices,
  runExtensionCommand,
  type ExtensionCliIo,
  type ExtensionCliServices
} from './extension-cli.js'

const cleanupRoots: string[] = []

afterEach(async () => {
  for (const root of cleanupRoots.splice(0)) {
    await makeWritable(root)
    await rm(root, { recursive: true, force: true })
  }
})

describe('kun extension CLI', () => {
  it('scaffolds through the official create-kun-extension adapter', async () => {
    const root = await temporaryRoot()
    let options: Record<string, unknown> | undefined
    const io = createIo(root, async (input) => {
      options = input
      return { extensionId: `${input.publisher}.${input.name}`, targetDirectory: input.targetDirectory }
    })
    const code = await runExtensionCommand([
      'create',
      'demo',
      '--publisher',
      'acme',
      '--name',
      'demo',
      '--template',
      'react',
      '--json'
    ], io)
    expect(code).toBe(0)
    expect(options).toMatchObject({
      targetDirectory: join(root, 'demo'),
      publisher: 'acme',
      name: 'demo',
      template: 'react'
    })
    expect(JSON.parse(io.output())).toMatchObject({
      schemaVersion: 1,
      result: { extensionId: 'acme.demo' }
    })
  })

  it('accepts repeatable safe include and ignore paths for source validation and packing', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'source')
    const archive = join(root, 'selected.kunx')
    const services = createTestServices(root)
    await writeExtensionSource(source, '1.0.0', [])
    await mkdir(join(source, 'dist/chunks'), { recursive: true })
    await writeFile(join(source, 'dist/chunks/first.js'), 'export const first = true\n')
    await writeFile(join(source, 'dist/chunks/second.js'), 'export const second = true\n')

    const selectionArguments = [
      source,
      '--include',
      'dist/chunks/first.js',
      '--include',
      'dist/chunks/second.js',
      '--ignore',
      'dist/chunks/second.js'
    ]
    const validated = await command(['validate', ...selectionArguments, '--json'], root, services)
    expect(validated.code).toBe(0)
    expect(JSON.parse(validated.stdout).result.fileCount).toBe(6)

    const packed = await command([
      'pack',
      ...selectionArguments,
      '--output',
      archive,
      '--json'
    ], root, services)

    expect(packed.code).toBe(0)
    expect(JSON.parse(packed.stdout).result).toMatchObject({
      id: 'acme.demo',
      version: '1.0.0',
      fileCount: 6
    })

    await writeFile(join(source, '.env'), 'API_KEY=must-not-ship\n')
    const forbidden = await command([
      'pack',
      source,
      '--include',
      '.env',
      '--output',
      join(root, 'forbidden.kunx'),
      '--json'
    ], root, services)
    expect(forbidden.code).toBe(78)
    expect(JSON.parse(forbidden.stderr).error).toMatchObject({
      code: 'EXTENSION_PACKAGE_FORBIDDEN_PATH'
    })
  })

  it('validates bounded manifest locale overlays through the public CLI', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'localized-source')
    const services = createTestServices(root)
    await writeExtensionSource(source, '1.0.0', ['commands.register'])
    const manifestPath = join(source, 'kun-extension.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.activationEvents = ['onCommand:hello']
    manifest.contributes = {
      commands: [{ id: 'hello', title: 'Hello' }]
    }
    manifest.localizations = {
      'zh-CN': {
        displayName: '演示扩展',
        contributes: {
          commands: { hello: { title: '你好' } }
        }
      }
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    expect((await command(['validate', source, '--json'], root, services)).code).toBe(0)

    manifest.localizations['zh-CN'].contributes.commands.missing = { title: '不存在' }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const invalid = await command(['validate', source, '--json'], root, services)
    expect(invalid.code).toBe(78)
    expect(invalid.stderr).toContain('Localization references an undeclared commands contribution')
  })

  it('covers validate, pack, consented install, list, enablement, rollback, doctor, logs, and uninstall', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'source')
    const v1Archive = join(root, 'acme.demo-1.0.0.kunx')
    const services = createTestServices(root)
    await writeExtensionSource(source, '1.0.0', ['commands.register'])

    expect(await command(['validate', source, '--json'], root, services)).toMatchObject({ code: 0 })
    const packedV1 = await command(['pack', source, '--output', v1Archive, '--json'], root, services)
    expect(packedV1.code).toBe(0)
    expect(JSON.parse(packedV1.stdout).result).toMatchObject({ id: 'acme.demo', version: '1.0.0' })

    const refused = await command(['install', v1Archive, '--json'], root, services)
    expect(refused.code).toBe(70)
    expect(refused.stderr).toContain('EXTENSION_PERMISSION_CONSENT_REQUIRED')

    const installedV1 = await command([
      'install',
      v1Archive,
      '--accept-permissions',
      '--json'
    ], root, services)
    expect(installedV1.code).toBe(0)
    expect(JSON.parse(installedV1.stdout).result).toMatchObject({
      id: 'acme.demo',
      version: '1.0.0'
    })

    const listed = await command(['list', '--json'], root, services)
    expect(JSON.parse(listed.stdout).extensions).toHaveLength(1)

    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    expect((await command(['disable', 'acme.demo', '--workspace', workspace], root, services)).code).toBe(0)
    const key = services.paths.workspaceKey(workspace)
    expect((await services.registry.get('acme.demo'))?.workspaceEnablement[key]).toBe(false)
    expect((await command(['enable', 'acme.demo', '--workspace', workspace], root, services)).code).toBe(0)

    await writeExtensionSource(source, '2.0.0', ['commands.register'])
    const v2Archive = join(root, 'acme.demo-2.0.0.kunx')
    expect((await command(['pack', source, '--output', v2Archive], root, services)).code).toBe(0)
    expect((await command([
      'install',
      v2Archive,
      '--accept-permissions'
    ], root, services)).code).toBe(0)
    expect((await services.registry.get('acme.demo'))?.selectedVersion).toBe('2.0.0')

    const rolledBack = await command([
      'rollback',
      'acme.demo',
      '--version',
      '1.0.0',
      '--json'
    ], root, services)
    expect(rolledBack.code).toBe(0)
    expect(JSON.parse(rolledBack.stdout).result.selectedVersion).toBe('1.0.0')

    const doctor = await command(['doctor', 'acme.demo', '--json'], root, services)
    expect(doctor.code).toBe(0)
    expect(JSON.parse(doctor.stdout)).toMatchObject({
      healthy: true,
      diagnostics: [{ extensionId: 'acme.demo', codes: ['EXTENSION_OK'] }]
    })

    const logDirectory = services.paths.logsDirectory('acme.demo')
    await mkdir(logDirectory, { recursive: true })
    await writeFile(join(logDirectory, 'host.log'), 'api-key=supersecret\nnormal line\n')
    const logs = await command(['logs', 'acme.demo', '--json'], root, services)
    expect(logs.code).toBe(0)
    const logResult = JSON.parse(logs.stdout)
    expect(logResult.content).toContain('<redacted>')
    expect(logResult.content).not.toContain('supersecret')

    const uninstalled = await command(['uninstall', 'acme.demo', '--json'], root, services)
    expect(uninstalled.code).toBe(0)
    expect(JSON.parse(uninstalled.stdout).result).toMatchObject({
      extensionId: 'acme.demo',
      dataPreserved: true
    })
    expect(await services.registry.get('acme.demo')).toBeUndefined()
  })

  it('registers development directories and reloads only on an explicit command', async () => {
    const root = await temporaryRoot()
    const source = join(root, 'development')
    const services = createTestServices(root)
    await writeExtensionSource(source, '1.0.0', [])

    const installed = await command([
      'install',
      '--development',
      source,
      '--accept-permissions',
      '--json'
    ], root, services)
    expect(installed.code).toBe(0)
    expect(JSON.parse(installed.stdout).result).toMatchObject({
      id: 'acme.demo',
      generation: 1,
      mutable: true
    })

    await writeFile(join(source, 'dist/main.mjs'), 'export const changed = true\n')
    const stale = await command(['doctor', 'acme.demo', '--json'], root, services)
    expect(stale.code).toBe(70)
    expect(JSON.parse(stale.stdout).diagnostics[0].codes).toContain('EXTENSION_DEVELOPMENT_RELOAD_REQUIRED')

    const reloaded = await command(['reload', 'acme.demo', '--json'], root, services)
    expect(reloaded.code).toBe(0)
    expect(JSON.parse(reloaded.stdout).result.generation).toBe(2)

    const validated = await command([
      'validate',
      source,
      '--development-validation',
      '--json'
    ], root, services)
    expect(validated.code).toBe(0)
    expect(JSON.parse(validated.stdout).result).toMatchObject({ mode: 'development' })
  })
})

function createTestServices(root: string): ExtensionCliServices {
  return createExtensionCliServices({
    packageRoot: join(root, 'extensions'),
    extensionDataRoot: join(root, 'extension-data'),
    kunVersion: '0.1.0'
  })
}

async function command(
  argv: string[],
  root: string,
  services: ExtensionCliServices
): Promise<{ code: number; stdout: string; stderr: string }> {
  const io = createIo(root)
  const code = await runExtensionCommand(argv, io, services)
  return { code, stdout: io.output(), stderr: io.errors() }
}

function createIo(
  root: string,
  scaffold?: NonNullable<ExtensionCliIo['scaffold']>
): ExtensionCliIo & { output(): string; errors(): string } {
  let stdout = ''
  let stderr = ''
  return {
    stdout: { write: (chunk) => { stdout += chunk } },
    stderr: { write: (chunk) => { stderr += chunk } },
    cwd: () => root,
    ...(scaffold === undefined ? {} : { scaffold }),
    output: () => stdout,
    errors: () => stderr
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-extension-cli-'))
  cleanupRoots.push(root)
  return root
}

async function writeExtensionSource(root: string, version: string, permissions: string[]): Promise<void> {
  await mkdir(join(root, 'dist'), { recursive: true })
  await writeFile(join(root, 'kun-extension.json'), `${JSON.stringify({
    publisher: 'acme',
    name: 'demo',
    displayName: 'Demo',
    version,
    manifestVersion: 1,
    apiVersion: '1.0.0',
    engines: { kun: '*' },
    main: 'dist/main.mjs',
    activationEvents: ['onStartup'],
    contributes: {},
    permissions,
    stateSchemaVersion: 0
  }, null, 2)}\n`)
  await writeFile(join(root, 'README.md'), '# Demo\n')
  await writeFile(join(root, 'LICENSE'), 'MIT\n')
  await writeFile(join(root, 'dist/main.mjs'), 'export async function activate() {}\n')
}

async function makeWritable(root: string): Promise<void> {
  if (process.platform === 'win32') return
  const visit = async (path: string): Promise<void> => {
    const details = await stat(path).catch(() => undefined)
    if (details === undefined) return
    await chmod(path, details.isDirectory() ? 0o700 : 0o600).catch(() => undefined)
    if (!details.isDirectory()) return
    for (const entry of await readdir(path)) await visit(join(path, entry))
  }
  await visit(root)
}
