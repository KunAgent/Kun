import { join, resolve } from 'node:path'

export type ExtensionResourceLocatorInput = {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}

export type ExtensionResources = {
  managedRoot: string
  expertPluginRoot: string
  designLibrariesRoot: string
  designRuntimeSkillsRoot: string
  designStaticSkillsRoot: string
}

export function resolveExtensionResources(
  input: ExtensionResourceLocatorInput
): ExtensionResources {
  const managedRoot = resolve(
    input.isPackaged
      ? join(input.resourcesPath, 'kun-extensions')
      : input.appPath
  )

  return {
    managedRoot,
    expertPluginRoot: join(managedRoot, 'experts', 'plugins'),
    designLibrariesRoot: join(managedRoot, 'design', 'design_libraries'),
    designRuntimeSkillsRoot: join(managedRoot, 'design', 'runtime-skills'),
    designStaticSkillsRoot: join(managedRoot, 'design', 'skills')
  }
}
