import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const BUNDLED_EXTENSIONS_RESOURCE_DIR = 'bundled-extensions'
export const BUNDLED_EXTENSIONS_CATALOG_FILE = 'catalog.json'

export function resolveBundledExtensionsDirectory(input: {
  isPackaged: boolean
  resourcesPath: string
  appRoot: string
}): string {
  return resolve(input.isPackaged
    ? join(input.resourcesPath, BUNDLED_EXTENSIONS_RESOURCE_DIR)
    : join(input.appRoot, 'resources', BUNDLED_EXTENSIONS_RESOURCE_DIR))
}

export function availableBundledExtensionsDirectory(input: {
  isPackaged: boolean
  resourcesPath: string
  appRoot: string
}): string | undefined {
  const directory = resolveBundledExtensionsDirectory(input)
  return existsSync(join(directory, BUNDLED_EXTENSIONS_CATALOG_FILE)) ? directory : undefined
}
