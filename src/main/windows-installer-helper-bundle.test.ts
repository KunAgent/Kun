import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const buildRoot = join(process.cwd(), 'build')

function helperDependencies(file = 'windows-installer-migration.ps1', visited = new Set<string>()): Set<string> {
  if (visited.has(file)) return visited
  visited.add(file)
  const source = readFileSync(join(buildRoot, file), 'utf8')
  for (const match of source.matchAll(/\.\s+\(Join-Path \$PSScriptRoot '(windows-installer-migration[^']*\.ps1)'\)/g)) {
    helperDependencies(match[1], visited)
  }
  return visited
}

describe('Windows installer helper bundle', () => {
  for (const entry of ['installer.nsh', 'installer-process-check.nsh']) {
    it(`extracts every transitive PowerShell helper from ${entry}`, () => {
      const source = readFileSync(join(buildRoot, entry), 'utf8')
      const dependencies = helperDependencies()
      expect(dependencies.has('windows-installer-migration-runtime-integrity.ps1')).toBe(true)
      for (const file of dependencies) {
        const installedName = file === 'windows-installer-migration.ps1' ? `kun-${file}` : file
        expect(source).toContain(`File /oname=$PLUGINSDIR\\${installedName} "\${PROJECT_DIR}\\build\\${file}"`)
      }
    })
  }

  it('invokes runtime integrity validation from installed-payload validation', () => {
    const source = readFileSync(join(buildRoot, 'windows-installer-migration-filesystem.ps1'), 'utf8')
    expect(source).toMatch(/\. \(Join-Path \$PSScriptRoot 'windows-installer-migration-runtime-integrity\.ps1'\)\s+Assert-PackagedRuntimeIntegrity \$target/)
  })
})
