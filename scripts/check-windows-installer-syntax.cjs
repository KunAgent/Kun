'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { isAbsolute, join } = require('node:path')

const installerHelperPath = join(
  __dirname,
  '..',
  'build',
  'windows-installer-migration.ps1'
)
const installerSmokePath = join(__dirname, 'smoke-windows-installer.ps1')
const installerHelperPaths = [
  installerHelperPath,
  installerSmokePath,
  'windows-installer-migration-paths.ps1',
  'windows-installer-migration-journal.ps1',
  'windows-installer-migration-filesystem.ps1',
  'windows-installer-migration-actions.ps1',
  'windows-installer-migration-recovery-env.ps1',
  'windows-installer-migration-transaction.ps1'
].map((path) => isAbsolute(path) ? path : join(__dirname, '..', 'build', path))

function getWindowsPowerShellPath(env = process.env) {
  const systemRoot = env.SystemRoot || env.WINDIR
  if (!systemRoot) {
    throw new Error('[windows-installer-syntax] SystemRoot is unavailable.')
  }
  return join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
}

function validateWindowsInstallerSyntax({
  platform = process.platform,
  env = process.env,
  spawn = spawnSync,
  scriptPath = installerHelperPath
} = {}) {
  if (platform !== 'win32') {
    console.log('[windows-installer-syntax] Skipped outside Windows.')
    return
  }

  const powershellPath = getWindowsPowerShellPath(env)
  if (!existsSync(powershellPath)) {
    throw new Error(
      `[windows-installer-syntax] Windows PowerShell was not found: ${powershellPath}`
    )
  }

  const parseCommand = [
    '$tokens = $null',
    '$errors = $null',
    '[System.Management.Automation.Language.Parser]::ParseFile(' +
      '$env:KUN_INSTALLER_SYNTAX_TARGET, [ref]$tokens, [ref]$errors) | Out-Null',
    'if ($errors.Count -gt 0) {',
    '  foreach ($errorRecord in $errors) {',
    '    [Console]::Error.WriteLine((',
    '      "{0}:{1}:{2}: {3} [{4}]" -f',
    '        $env:KUN_INSTALLER_SYNTAX_TARGET,',
    '        $errorRecord.Extent.StartLineNumber,',
    '        $errorRecord.Extent.StartColumnNumber,',
    '        $errorRecord.Message,',
    '        $errorRecord.ErrorId',
    '    ))',
    '  }',
    '  exit 1',
    '}'
  ].join('\n')

  const scriptPaths = scriptPath === installerHelperPath ? installerHelperPaths : [scriptPath]
  for (const currentScriptPath of scriptPaths) {
    const result = spawn(
      powershellPath,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        parseCommand
      ],
      {
        encoding: 'utf8',
        env: {
          ...env,
          KUN_INSTALLER_SYNTAX_TARGET: currentScriptPath
        }
      }
    )

    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `[windows-installer-syntax] PowerShell parser exited with code ${result.status}.`
      )
    }
    console.log(`[windows-installer-syntax] PowerShell syntax OK: ${currentScriptPath}`)
  }
}

if (require.main === module) {
  validateWindowsInstallerSyntax()
}

module.exports = {
  getWindowsPowerShellPath,
  installerHelperPath,
  installerHelperPaths,
  installerSmokePath,
  validateWindowsInstallerSyntax
}
