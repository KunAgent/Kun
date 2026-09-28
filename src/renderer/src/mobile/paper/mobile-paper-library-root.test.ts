// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mobilePaperLibraryRoot, setMobilePaperLibraryRoot } from './mobile-paper-library-root'

afterEach(() => window.sessionStorage.clear())

describe('mobile-only paper library selection', () => {
  it('uses only configured libraries and survives a phone route reload', () => {
    const libraries = ['/host/one', '/host/two']
    expect(mobilePaperLibraryRoot(libraries, '/host/one', '/host/docs')).toBe('/host/one')
    setMobilePaperLibraryRoot('/host/private', libraries)
    expect(mobilePaperLibraryRoot(libraries, '/host/one', '/host/docs')).toBe('/host/one')
    setMobilePaperLibraryRoot('/host/two', libraries)
    expect(mobilePaperLibraryRoot(libraries, '/host/one', '/host/docs')).toBe('/host/two')
    expect(mobilePaperLibraryRoot(['/host/one'], '/host/one', '/host/docs')).toBe('/host/one')
  })
})
