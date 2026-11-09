import { describe, expect, it } from 'vitest'
import { captureFailureName, permitsDesktopCapture } from './capture-permissions'

describe('isolated desktop capture permission compatibility', () => {
  it('accepts Electron 43 display requests and checks', () => {
    expect(permitsDesktopCapture('media', { mediaTypes: [], isMainFrame: true }, 'request')).toBe(true)
    expect(permitsDesktopCapture('media', { mediaType: 'unknown', isMainFrame: true }, 'check')).toBe(true)
  })
  it('accepts the newer display-capture name without granting display audio', () => {
    expect(permitsDesktopCapture('display-capture', { mediaTypes: ['video'] }, 'request')).toBe(true)
    expect(permitsDesktopCapture('display-capture', {}, 'check')).toBe(true)
    expect(permitsDesktopCapture('display-capture', { mediaTypes: ['video', 'audio'] }, 'request')).toBe(false)
  })
  it.each(['audio', 'video'])('rejects physical %s device access', mediaType => {
    expect(permitsDesktopCapture('media', { mediaTypes: [mediaType] }, 'request')).toBe(false)
    expect(permitsDesktopCapture('media', { mediaType }, 'check')).toBe(false)
  })
  it('fails closed for missing legacy details, unrelated permissions and subframes', () => {
    expect(permitsDesktopCapture('media', {}, 'request')).toBe(false)
    expect(permitsDesktopCapture('media', {}, 'check')).toBe(false)
    expect(permitsDesktopCapture('clipboard-read', {}, 'request')).toBe(false)
    expect(permitsDesktopCapture('media', { mediaTypes: [], isMainFrame: false }, 'request')).toBe(false)
    expect(permitsDesktopCapture('display-capture', { isMainFrame: false }, 'check')).toBe(false)
  })
  it('does not put arbitrary renderer messages in diagnostics', () => {
    expect(captureFailureName('NotAllowedError')).toBe('NotAllowedError')
    expect(captureFailureName('token=private; device=personal')).toBe('UnknownError')
    expect(captureFailureName({ name: 'NotAllowedError' })).toBe('UnknownError')
  })
})
