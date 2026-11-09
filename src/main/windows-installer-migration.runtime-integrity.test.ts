import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, toNamespacedPath } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  assertSucceeded, cleanupTransactionFixtures, fixture, powershell, windowsOnly
} from './windows-installer-migration.transaction.fixture'

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
const build = join(process.cwd(), 'build')
function check(command: string) {
  return powershell(`
    $ErrorActionPreference = 'Stop'
    . ${quote(join(build, 'windows-installer-migration-paths.ps1'))}
    . ${quote(join(build, 'windows-installer-migration-filesystem.ps1'))}
    . ${quote(join(build, 'windows-installer-migration-payload-copy.ps1'))}
    . ${quote(join(build, 'windows-installer-migration-runtime-integrity.ps1'))}
    try { ${command}; Write-Output 'VALID' }
    catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
  `)
}
function runtime(deep: boolean) {
  const input = fixture(false, true)
  // Do not shorten this fixture: even the manifest itself must exceed MAX_PATH.
  const root = deep ? join(input.root, ...Array.from({ length: 6 }, (_, i) => `custom-${i}-${'x'.repeat(42)}`), '\u6df1\u5ea6') : input.target
  const moduleDir = 'app.asar.unpacked/kun/node_modules/example'
  const relativeFile = `${moduleDir}/index.js`
  const file = join(root, 'resources', ...relativeFile.split('/'))
  const packageJson = join(dirname(file), 'package.json')
  const manifest = join(root, 'resources', 'kun-runtime-integrity.json')
  mkdirSync(toNamespacedPath(dirname(file)), { recursive: true })
  writeFileSync(toNamespacedPath(file), 'runtime')
  writeFileSync(toNamespacedPath(packageJson), '{"name":"example"}')
  const document = {
    schemaVersion: 1,
    files: [{ path: relativeFile, size: 7 }],
    modules: [{ name: 'example', dir: moduleDir }]
  }
  const save = () => writeFileSync(toNamespacedPath(manifest), JSON.stringify(document))
  save()
  return { input, root, file, packageJson, manifest, document, save }
}

afterEach(cleanupTransactionFixtures)

windowsOnly('Windows PowerShell 5.1 runtime integrity literal long paths', () => {
  it('converts drive and UNC paths once, preserving Unicode and existing prefixes', () => {
    const result = check(`
      $cases = @(
        @('C:\\Kun\\unicode', '\\\\?\\C:\\Kun\\unicode'),
        @('\\\\server\\share\\Kun', '\\\\?\\UNC\\server\\share\\Kun'),
        @('\\\\?\\C:\\Kun', '\\\\?\\C:\\Kun'),
        @('\\\\?\\UNC\\server\\share\\Kun', '\\\\?\\UNC\\server\\share\\Kun')
      )
      foreach ($pair in $cases) {
        if ([KunInstallerPayloadCopy]::Extended($pair[0]) -cne $pair[1]) { throw 'Native extended-path conversion differs' }
        if ((Get-ExtendedLengthPath $pair[0]) -cne $pair[1]) { throw 'PowerShell extended-path conversion differs' }
      }
      $unicode = 'C:\\' + [char]0x6df1 + [char]0x5ea6 + '\\Kun'
      if ([KunInstallerPayloadCopy]::Extended($unicode) -cne ('\\\\?\\' + $unicode)) { throw 'Unicode conversion differs' }
    `)
    assertSucceeded(result, 'extended-path conversion')
  }, 30_000)

  it.each([false, true])('accepts the complete runtime and nonempty package (deep: %s)', (deep) => {
    const f = runtime(deep)
    if (deep) {
      expect(f.manifest.length).toBeGreaterThan(260)
      expect(f.packageJson.length).toBeGreaterThan(260)
    }
    const result = check(`
      Assert-PackagedRuntimeIntegrity ${quote(f.root)}
      Assert-NonEmptyPayloadFile ${quote(f.file)} 'runtime'
      Assert-NonEmptyPayloadFile ${quote(toNamespacedPath(f.packageJson))} 'package'
      $info = [KunInstallerPayloadCopy]::GetLiteralFileInfo(${quote(f.file)})
      if (-not $info.Exists -or $info.IsDirectory -or $info.Length -ne 7) { throw 'Incorrect typed file metadata' }
    `)
    assertSucceeded(result, 'runtime integrity')
  }, 30_000)

  it.each(['missing', 'size', 'empty-package', 'missing-package', 'unsafe-file', 'unsafe-module'] as const)(
    'rejects %s under the real long-path root', (defect) => {
      const f = runtime(true)
      expect(f.manifest.length).toBeGreaterThan(260)
      if (defect === 'missing') rmSync(toNamespacedPath(f.file))
      if (defect === 'size') f.document.files[0]!.size = 8
      if (defect === 'empty-package') writeFileSync(toNamespacedPath(f.packageJson), '')
      if (defect === 'missing-package') rmSync(toNamespacedPath(f.packageJson))
      if (defect === 'unsafe-file') f.document.files[0]!.path = '../outside.js'
      if (defect === 'unsafe-module') f.document.modules[0]!.dir = '../outside'
      f.save()
      const result = check(`Assert-PackagedRuntimeIntegrity ${quote(f.root)}`)
      expect(result.status, String(result.stderr)).toBe(1)
      expect(String(result.stderr)).toMatch(/missing|truncated|empty|unsafe/i)
    }, 30_000)

  it.each(['leaf', 'ancestor', 'manifest'] as const)('refuses a %s junction at a long path', (entry) => {
    const f = runtime(true)
    const outside = join(f.input.root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'index.js'), 'runtime')
    writeFileSync(join(outside, 'package.json'), '{"name":"example"}')
    const link = entry === 'manifest' ? f.manifest : entry === 'leaf' ? f.file : dirname(f.file)
    rmSync(toNamespacedPath(link), { recursive: true, force: true })
    symlinkSync(outside, toNamespacedPath(link), 'junction')
    const result = check(`Assert-PackagedRuntimeIntegrity ${quote(f.root)}`)
    expect(result.status, String(result.stderr)).toBe(1)
    expect(String(result.stderr)).toMatch(/reparse point/i)
    const publicCheck = check(`Assert-NonEmptyPayloadFile ${quote(entry === 'manifest' ? f.manifest : f.file)} 'runtime'`)
    expect(publicCheck.status, String(publicCheck.stderr)).toBe(1)
    expect(String(publicCheck.stderr)).toMatch(/reparse point/i)
  }, 30_000)

  it('keeps only a genuinely absent manifest optional for older installs', () => {
    const f = runtime(true)
    rmSync(toNamespacedPath(f.manifest))
    assertSucceeded(check(`Assert-PackagedRuntimeIntegrity ${quote(f.root)}`), 'legacy manifest absence')
    writeFileSync(toNamespacedPath(f.manifest), '{invalid JSON')
    expect(check(`Assert-PackagedRuntimeIntegrity ${quote(f.root)}`).status).toBe(1)
  }, 30_000)
})
