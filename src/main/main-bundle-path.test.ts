import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mainBundleDirectory } from './main-bundle-path'

describe('main bundle path', () => {
  const bundleRoot = resolve('/app/out/main')

  it('keeps the entry bundle rooted at out/main', () => {
    expect(mainBundleDirectory(pathToFileURL(join(bundleRoot, 'index.js')).href))
      .toBe(bundleRoot)
  })

  it('normalizes a split chunk back to out/main', () => {
    expect(mainBundleDirectory(pathToFileURL(join(bundleRoot, 'chunks', 'desktop.js')).href))
      .toBe(bundleRoot)
  })
})
