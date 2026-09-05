import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const smokePath = join(root, 'scripts/smoke-windows-installer.ps1')
const smoke = readFileSync(smokePath, 'utf8')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

function windowsJob(workflowPath: string, jobName: string): string {
  const source = readFileSync(join(root, workflowPath), 'utf8')
  const start = source.indexOf(`\n  ${jobName}:`)
  expect(start).toBeGreaterThanOrEqual(0)
  const nextJob = source.slice(start + 1).search(/\n {2}[A-Za-z0-9_-]+:\r?\n/u)
  return source.slice(start, nextJob < 0 ? undefined : start + 1 + nextJob)
}

describe('Windows installer smoke', () => {
  it('covers one bounded install, packaged CLI launch, and uninstall', () => {
    expect(packageJson.scripts['smoke:windows-installer']).toContain(
      './scripts/smoke-windows-installer.ps1'
    )
    expect(smoke.split(/\r?\n/u).length).toBeLessThanOrEqual(150)
    expect(smoke).toContain("Invoke-CheckedProcess 'install'")
    expect(smoke).toContain("'smoke-packaged-cli.cjs'")
    expect(smoke).toContain('Invoke-SmokeUninstaller')
    expect(smoke).toContain('[int]$TimeoutSeconds = 10800')
    expect(smoke).toContain('$process.WaitForExit($TimeoutSeconds * 1000)')
    expect(smoke).toContain('The Kun install registration remains after uninstall.')
    expect(smoke).not.toContain('--updated')
    expect(smoke).not.toContain('/allusers')
  })

  it('keeps every Windows packaging job on the short smoke', () => {
    for (const [workflow, jobName] of [
      ['.github/workflows/pr-checks.yml', 'package-windows'],
      ['.github/workflows/daily-dev-prerelease.yml', 'build-windows'],
      ['.github/workflows/release.yml', 'build-windows']
    ]) {
      const job = windowsJob(workflow, jobName)
      expect(job).toContain('timeout-minutes: 180')
      expect(job).toMatch(/- name: Smoke Windows installer\s+timeout-minutes: 180/u)
      expect(job).toContain('npm run smoke:windows-installer --')
      expect(job).not.toContain('windows-installer-smoke-diagnostics')
      expect(job).not.toContain('smoke:windows-installer-migration')
    }
  })
})
