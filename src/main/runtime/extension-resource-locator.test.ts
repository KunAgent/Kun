import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExtensionResources } from './extension-resource-locator'

describe('resolveExtensionResources', () => {
  it('uses the application root in development', () => {
    const appPath = join('D:\\', 'soft', 'Kun')
    const resources = resolveExtensionResources({
      isPackaged: false,
      appPath,
      resourcesPath: join('D:\\', 'ignored')
    })

    expect(resources.managedRoot).toBe(resolve(appPath))
    expect(resources.expertPluginRoot).toBe(join(resources.managedRoot, 'experts', 'plugins'))
    expect(resources.designLibrariesRoot).toBe(join(resources.managedRoot, 'design', 'design_libraries'))
    expect(resources.designRuntimeSkillsRoot).toBe(join(resources.managedRoot, 'design', 'runtime-skills'))
    expect(resources.designStaticSkillsRoot).toBe(join(resources.managedRoot, 'design', 'skills'))
  })

  it('uses the packaged resource directory instead of app.asar', () => {
    const resourcesPath = join('D:\\', 'app', 'resources')
    const resources = resolveExtensionResources({
      isPackaged: true,
      appPath: join(resourcesPath, 'app.asar'),
      resourcesPath
    })

    expect(resources.managedRoot).toBe(resolve(resourcesPath, 'kun-extensions'))
  })
})
