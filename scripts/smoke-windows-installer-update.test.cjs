'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { createPackage } = appBuilderRequire('@electron/asar')
const versionReader = join(__dirname, 'smoke-windows-installer-version.cjs')

const support = readFileSync(join(__dirname, 'smoke-windows-installer-update.ps1'), 'utf8').replace(/\r\n/g, '\n')
const driver = readFileSync(join(__dirname, 'smoke-windows-installer.ps1'), 'utf8').replace(/\r\n/g, '\n')

test('compiled update scenarios remain inside the clean-runner smoke before uninstall', () => {
  assert.match(driver, /\$env:CI -ne 'true'/)
  assert.match(driver, /\$existingKun\.Count -eq 0/)
  const original = driver.indexOf("Invoke-SmokeAutomaticUpdate 'same-version-automatic-update'")
  const active = driver.indexOf("Invoke-SmokeAutomaticUpdate 'active-stage-source-automatic-update'")
  assert.ok(original > driver.indexOf("'The installed Kun CLI smoke failed.'"))
  assert.ok(active > original)
  assert.ok(driver.indexOf('Move-SmokeInstallationToActiveStageName', original) < active)
  assert.ok(driver.indexOf('  Invoke-SmokeUninstaller', active) > active)
})

test('reads both transaction versions from the installed app archive', () => {
  assert.match(support, /\$archive = Join-Path \$script:installLocation 'resources\\app\.asar'/)
  assert.match(support, /\$version = & node \(Join-Path \$PSScriptRoot 'smoke-windows-installer-version\.cjs'\) \$archive/)
  assert.match(support, /Assert-True \(\$LASTEXITCODE -eq 0\)/)
  assert.match(support, /KUN_INSTALLER_OLD_VERSION = \$version/)
  assert.match(support, /KUN_INSTALLER_NEW_VERSION = \$version/)
  assert.doesNotMatch(support, /\.\.\\package\.json/)
})

async function createInstalledArchive(t, packageContents) {
  const root = mkdtempSync(join(tmpdir(), 'kun installer version '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const payload = join(root, 'payload')
  const resources = join(root, 'installed app', 'resources')
  mkdirSync(payload, { recursive: true })
  mkdirSync(resources, { recursive: true })
  if (packageContents !== undefined) writeFileSync(join(payload, 'package.json'), packageContents)
  else writeFileSync(join(payload, 'placeholder'), '')
  const archive = join(resources, 'app.asar')
  await createPackage(payload, archive)
  return archive
}

function runVersionReader(archive) {
  return spawnSync(process.execPath, [versionReader, archive], {
    encoding: 'utf8',
    env: { ...process.env, KUN_APP_VERSION: '9.9.9', DEEPSEEK_GUI_APP_VERSION: '8.8.8' }
  })
}

test('reads source, daily and release versions from actual ASAR payloads, not environment overrides', async (t) => {
  for (const version of ['0.4.3', '0.0.0-dev-20261031-0414', '0.4.4']) {
    await t.test(version, async (t) => {
      const archive = await createInstalledArchive(t, JSON.stringify({ version }))
      const result = runVersionReader(archive)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), version)
    })
  }
})

test('fails closed when the installed archive or its package version is invalid', async (t) => {
  const missing = runVersionReader(join(tmpdir(), 'missing-kun-installer-app.asar'))
  assert.notEqual(missing.status, 0)
  assert.equal(missing.stdout, '')
  for (const contents of [undefined, '{', '{}', '{"version":""}', '{"version":123}', '{"version":"not-semver"}']) {
    const archive = await createInstalledArchive(t, contents)
    const result = runVersionReader(archive)
    assert.notEqual(result.status, 0, `Unexpected success for ${contents}`)
    assert.equal(result.stdout, '')
  }
})

test('uses the installer no-pending lifecycle without force-run and restores inherited environment', () => {
  assert.match(support, /KUN_PENDING_UPDATE_RESULT = \$null/)
  assert.match(support, /KUN_PENDING_UPDATE_PATH = \$null/)
  assert.match(support, /KUN_INSTALLER_UPDATE_SOURCE = \$script:installLocation/)
  assert.match(support, /@\('\/S', '\/currentuser', '--updated'\)/)
  assert.doesNotMatch(support, /@\([^\n]*--force-run/)
  assert.match(support, /finally \{[\s\S]*SetEnvironmentVariable\(\$name, \$previous\[\$name\], 'Process'\)/)
  assert.doesNotMatch(support, /-Action FinalizeUpdateTransaction/)
})

test('requires compiled extraction, cutover, commit and finalize evidence plus retained user bytes', () => {
  for (const marker of [
    'NSIS update-boundary=prepared', 'SUCCESS action=StageExtractedUpdatePayload',
    'START action=ResolveRecoveryExecutable',
    'NSIS update-boundary=registration-original',
    'NSIS update-boundary=cutover', 'SUCCESS action=SwitchUpdatePayload',
    'SUCCESS action=ValidateCutover', 'SUCCESS action=CommitUpdateTransaction',
    'SUCCESS action=FinalizeUpdateTransaction'
  ]) assert.ok(support.includes(marker), marker)
  assert.match(support, /\$log\.IndexOf\(\$marker, \$cursor/)
  assert.match(support, /Get-Content -LiteralPath \$sentinel -Raw/)
  assert.match(support, /\$newBackups\.Count -eq 0/)
  assert.match(support, /-not \(Test-Path -LiteralPath \$transactionPath\)/)
})

test('rebinds only the owned temporary installation and exact previously discovered registry keys', () => {
  assert.match(support, /\$original\.StartsWith\(\$script:root \+ '\\'/)
  assert.match(support, /Test-PathEqual \$location \$original/)
  assert.match(support, /Set-ItemProperty -LiteralPath \$script:installRegistryPath -Name InstallLocation -Value \$active/)
  assert.match(support, /Set-ItemProperty -LiteralPath \$script:uninstallRegistryPath/)
  assert.match(support, /@\('UninstallString', 'QuietUninstallString', 'DisplayIcon'\)/)
  assert.match(support, /Test-PathEqual \$shortcut.TargetPath \(Join-Path \$original 'Kun.exe'\)/)
  assert.doesNotMatch(support, /HKLM:|Stop-Process|taskkill/)
})

test('rebinds only the exact owned user PATH component and preserves unrelated components', () => {
  assert.match(support, /\$originalBin = Join-Path \$original 'bin'/)
  assert.match(support, /\$activeBin = Join-Path \$active 'bin'/)
  assert.match(support, /\[string\]::Equals\(\$_\.Trim\(\)\.TrimEnd\('\\'\), \$originalBin, \[StringComparison\]::OrdinalIgnoreCase\)/)
  assert.match(support, /Assert-True \(\$ownedPathParts\.Count -gt 0\)/)
  assert.match(support, /GetEnvironmentVariable\('Path', 'User'\), \$userPath, \[StringComparison\]::Ordinal\)/)
  assert.match(support, /\$activeBin\s*\} else \{\s*\$_\s*\}/)
  assert.match(support, /SetEnvironmentVariable\('Path', \(\$updatedPathParts -join ';'\), 'User'\)/)
  assert.doesNotMatch(support, /SetEnvironmentVariable\('Path', \$userPath/)
})
