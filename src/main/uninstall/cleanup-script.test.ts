import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildPosixCleanupScript,
  buildWindowsCleanupScript,
  type CleanupRequest,
  writeCleanupScripts
} from './cleanup-script'

function posixRequest(overrides: Partial<CleanupRequest> = {}): CleanupRequest {
  return {
    operationId: '123e4567-e89b-42d3-a456-426614174000',
    mainPid: 4242,
    guardCommandSubstring: '/Applications/Kun.app/Contents/MacOS/Kun',
    deleteDataPaths: ['/Users/Alice/Library/Application Support/Kun', '/Users/Alice/.kun/data'],
    appRemovalMode: 'bundle',
    appRemovalTarget: '/Applications/Kun.app',
    platform: 'darwin',
    tempRoot: '/tmp',
    markerDir: '/tmp/kun-uninstall-123e4567-e89b-42d3-a456-426614174000',
    ...overrides
  }
}

function windowsRequest(overrides: Partial<CleanupRequest> = {}): CleanupRequest {
  return {
    operationId: '123e4567-e89b-42d3-a456-426614174000',
    mainPid: 4242,
    guardCommandSubstring: 'C:\\Program Files\\Kun\\Kun.exe',
    deleteDataPaths: ['C:\\Users\\Alice\\AppData\\Roaming\\Kun', 'C:\\Users\\Alice\\.kun\\data'],
    appRemovalMode: 'uninstaller',
    appRemovalTarget: 'C:\\Program Files\\Kun\\Uninstall Kun.exe',
    platform: 'win32',
    tempRoot: 'C:\\Users\\Alice\\AppData\\Local\\Temp',
    markerDir: 'C:\\Users\\Alice\\AppData\\Local\\Temp\\kun-uninstall-123e4567-e89b-42d3-a456-426614174000',
    ...overrides
  }
}

describe('POSIX cleanup script', () => {
  it('fails without deleting data when Main does not exit, and bounds its own process group', () => {
    const script = buildPosixCleanupScript(posixRequest())
    expect(script).toContain('MAIN_PID=4242')
    expect(script).toContain('while kill -0 "$MAIN_PID" 2>/dev/null; do')
    expect(script).toContain('if [ "$i" -ge 120 ]; then exit 124; fi')
    expect(script).not.toContain('kill -9 "$MAIN_PID"')
    expect(script).toContain('kill -KILL "-$HELPER_PID"')
    expect(script).toContain('wait "$WATCHDOG_PID"')
    expect(script).toContain("GUARD='/Applications/Kun.app/Contents/MacOS/Kun'")
  })

  it('removes data paths, the app bundle, and the marker directory', () => {
    const script = buildPosixCleanupScript(posixRequest())
    expect(script).toContain("rm -rf -- '/Users/Alice/Library/Application Support/Kun'")
    expect(script).toContain("rm -rf -- '/Users/Alice/.kun/data'")
    expect(script).toContain("rm -rf -- '/Applications/Kun.app'")
    expect(script).toContain('rm -rf --')
  })

  it('escapes single quotes inside paths', () => {
    const script = buildPosixCleanupScript(posixRequest({
      deleteDataPaths: ["/Users/Alice/it's data/.kun"]
    }))
    expect(script).toContain("rm -rf -- '/Users/Alice/it'\\''s data/.kun'")
  })

  it('skips bundle removal when app removal is not requested', () => {
    const script = buildPosixCleanupScript(posixRequest({ appRemovalMode: 'none' }))
    expect(script).not.toContain("rm -rf -- '/Applications/Kun.app'")
  })

  it('uses rm -f for an AppImage target', () => {
    const script = buildPosixCleanupScript(posixRequest({
      platform: 'linux',
      appRemovalMode: 'appimage',
      appRemovalTarget: '/home/Alice/Downloads/Kun.AppImage'
    }))
    expect(script).toContain("rm -f -- '/home/Alice/Downloads/Kun.AppImage'")
  })
})

describe('Windows cleanup script', () => {
  it('preserves data if Main stays alive and contains uninstall descendants in a bounded Job', () => {
    const script = buildWindowsCleanupScript(windowsRequest())
    expect(script).toContain('$mainPid = 4242')
    expect(script).toContain("$guard = 'C:\\Program Files\\Kun\\Kun.exe'")
    expect(script).toContain('if (Get-Process -Id $mainPid -ErrorAction SilentlyContinue) { exit 124 }')
    expect(script).not.toContain('Stop-Process -Id $mainPid')
    expect(script).toContain('AssignProcessToJobObject')
    expect(script).toContain('[KunOneShotDeadline]::Start(300000, $true)')
  })

  it('removes data paths, runs the NSIS uninstaller with /S, and cleans the marker', () => {
    const script = buildWindowsCleanupScript(windowsRequest())
    expect(script).toContain("Remove-Item -LiteralPath 'C:\\Users\\Alice\\AppData\\Roaming\\Kun' -Recurse -Force")
    expect(script).toContain("Remove-Item -LiteralPath 'C:\\Users\\Alice\\.kun\\data' -Recurse -Force")
    expect(script).toContain("Start-Process -FilePath 'C:\\Program Files\\Kun\\Uninstall Kun.exe' -ArgumentList '/S' -Wait")
    expect(script).toContain("Remove-Item -LiteralPath 'C:\\Users\\Alice\\AppData\\Local\\Temp\\kun-uninstall-123e4567-e89b-42d3-a456-426614174000' -Recurse -Force")
  })

  it('escapes single quotes in PowerShell strings', () => {
    const script = buildWindowsCleanupScript(windowsRequest({
      deleteDataPaths: ["C:\\Users\\Alice\\it's data"]
    }))
    expect(script).toContain("Remove-Item -LiteralPath 'C:\\Users\\Alice\\it''s data' -Recurse -Force")
  })
})

describe('cleanup marker and script files', () => {
  it('writes a marker.json plus the platform script into a temp folder', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'kun-uninstall-marker-'))
    const output = await writeCleanupScripts(posixRequest({ tempRoot }))
    expect(output.scriptPath).toContain('cleanup.sh')
    const script = await readFile(output.scriptPath, 'utf8')
    expect(script).toContain('MAIN_PID=4242')
    const marker = JSON.parse(await readFile(output.markerPath, 'utf8'))
    expect(marker.operationId).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(marker.deleteDataPaths).toEqual([
      '/Users/Alice/Library/Application Support/Kun',
      '/Users/Alice/.kun/data'
    ])
    expect(marker.appRemovalMode).toBe('bundle')
  })
})
