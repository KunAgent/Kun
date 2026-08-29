import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mainBundleDirectory } from './main-bundle-path'

describe('main bundle path', () => {
  it('keeps the entry bundle rooted at out/main', () => {
    expect(mainBundleDirectory(pathToFileURL('/app/out/main/index.js').href))
      .toBe('/app/out/main')
  })

  it('normalizes a split chunk back to out/main', () => {
    expect(mainBundleDirectory(pathToFileURL('/app/out/main/chunks/desktop.js').href))
      .toBe('/app/out/main')
  })
})
