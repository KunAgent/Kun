// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mobilePaperLibraryRoot, setMobilePaperLibraryRoot } from './mobile-paper-library-root'

afterEach(() => window.sessionStorage.clear())

describe('mobile-only paper library selection', () => {
  it('uses only configured libraries and survives a phone route reload', () => {
    const libraries = ['/host/one', '/host/two']
    expect(mobilePaperLibraryRoot(libraries, '/host/one')).toBe('/host/one')
    setMobilePaperLibraryRoot('/host/private', libraries)
    expect(mobilePaperLibraryRoot(libraries, '/host/one')).toBe('/host/one')
    setMobilePaperLibraryRoot('/host/two', libraries)
    expect(mobilePaperLibraryRoot(libraries, '/host/one')).toBe('/host/two')
    expect(mobilePaperLibraryRoot(['/host/one'], '/host/one')).toBe('/host/one')
  })

  it('never treats a documents workspace or stale active library as an import target', () => {
    expect(mobilePaperLibraryRoot([], '/host/docs')).toBe('')
    expect(mobilePaperLibraryRoot(['/host/one'], '/host/docs')).toBe('/host/one')
    setMobilePaperLibraryRoot('/host/one', ['/host/one'])
    expect(mobilePaperLibraryRoot([], '/host/one')).toBe('')
  })
})
