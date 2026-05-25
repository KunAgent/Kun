import { describe, expect, it } from 'vitest'
import {
  managedPackageBinaryName,
  managedPackageInstallModuleRequest
} from './resolve-deepseek-binary'

describe('managedPackageInstallModuleRequest', () => {
  it('uses the package self-relative installer path for extracted update packages', () => {
    expect(
      managedPackageInstallModuleRequest(
        '/Users/test/Library/Application Support/deepseek-gui/deepseek-tui-updates/versions/0.8.42/node_modules/codewhale/package.json',
        'codewhale'
      )
    ).toBe('./scripts/install.js')
  })

  it('uses the package name lookup from the app root package.json for bundled deepseek-tui', () => {
    expect(managedPackageInstallModuleRequest('/Users/test/app/package.json', 'deepseek-tui')).toBe(
      'deepseek-tui/scripts/install.js'
    )
  })

  it('uses the package name lookup from the app root package.json for updated codewhale', () => {
    expect(managedPackageInstallModuleRequest('/Users/test/app/package.json', 'codewhale')).toBe(
      'codewhale/scripts/install.js'
    )
  })
})

describe('managedPackageBinaryName', () => {
  it('maps the legacy package to the deepseek binary name', () => {
    expect(managedPackageBinaryName('deepseek-tui')).toBe('deepseek')
  })

  it('maps the renamed package to the codewhale binary name', () => {
    expect(managedPackageBinaryName('codewhale')).toBe('codewhale')
  })
})
