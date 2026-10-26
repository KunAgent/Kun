'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

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
