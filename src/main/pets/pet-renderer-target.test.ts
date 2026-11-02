import { describe, expect, it } from 'vitest'
import { petRendererTarget } from './pet-renderer-target'

describe('pet renderer loading', () => {
  it('loads the packaged Windows page from app.asar, including spaces in the install path', () => {
    expect(petRendererTarget({ platform: 'win32', appPath: 'C:\\Program Files\\Kun\\resources\\app.asar' })).toEqual({
      kind: 'file', path: 'C:\\Program Files\\Kun\\resources\\app.asar\\out\\renderer\\pet-overlay.html'
    })
  })

  it.each([
    ['darwin', '/Applications/Kun.app/Contents/Resources/app.asar'],
    ['linux', '/opt/Kun/resources/app.asar'],
    ['darwin', '/Users/developer/Kun']
  ] as const)('uses the app root on %s rather than out/main/chunks', (platform, appPath) => {
    expect(petRendererTarget({ platform, appPath })).toEqual({
      kind: 'file', path: `${appPath}/out/renderer/pet-overlay.html`
    })
  })

  it('keeps the development origin and port but removes workbench routing', () => {
    expect(petRendererTarget({ appPath: '/unused', developmentUrl: 'http://127.0.0.1:5173/index.html?test=1#chat' })).toEqual({
      kind: 'url', url: 'http://127.0.0.1:5173/pet-overlay.html'
    })
  })
})
