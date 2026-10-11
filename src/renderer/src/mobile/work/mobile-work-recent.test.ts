// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { forgetMobileWorkRecent, readMobileWorkRecent, rememberMobileWorkRecent } from './mobile-work-recent'

afterEach(() => window.sessionStorage.clear())

describe('mobile Work recent files', () => {
  it('survives a page remount, keeps workspace scope, and removes renamed entries', () => {
    rememberMobileWorkRecent('/A', '/A/old.md', 'old.md')
    rememberMobileWorkRecent('/B', '/B/other.md', 'other.md')
    rememberMobileWorkRecent('/A', '/A/new.md', 'new.md')
    expect(readMobileWorkRecent('/A').map((item) => item.path)).toEqual(['/A/new.md', '/A/old.md'])
    expect(readMobileWorkRecent('/B').map((item) => item.path)).toEqual(['/B/other.md'])
    forgetMobileWorkRecent('/A', '/A/old.md')
    expect(readMobileWorkRecent('/A').map((item) => item.path)).toEqual(['/A/new.md'])
  })
})
