import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  availableBundledExtensionsDirectory,
  resolveBundledExtensionsDirectory
} from './bundled-extension-resources'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'kun-bundled-extension-resources-'))
  roots.push(value)
  return value
}

describe('bundled extension resources', () => {
  it('uses repository resources in development and packaged resources in releases', () => {
    const base = root()
    expect(resolveBundledExtensionsDirectory({
      isPackaged: false,
      resourcesPath: join(base, 'product-resources'),
      appRoot: join(base, 'repo')
    })).toBe(join(base, 'repo', 'resources', 'bundled-extensions'))
    expect(resolveBundledExtensionsDirectory({
      isPackaged: true,
      resourcesPath: join(base, 'product-resources'),
      appRoot: join(base, 'repo')
    })).toBe(join(base, 'product-resources', 'bundled-extensions'))
  })

  it('passes a bundle directory to Kun only after its catalog exists', () => {
    const base = root()
    const appRoot = join(base, 'repo')
    const directory = join(appRoot, 'resources', 'bundled-extensions')
    const input = { isPackaged: false, resourcesPath: join(base, 'unused'), appRoot }
    expect(availableBundledExtensionsDirectory(input)).toBeUndefined()
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'catalog.json'), '{}\n')
    expect(availableBundledExtensionsDirectory(input)).toBe(directory)
  })
})
