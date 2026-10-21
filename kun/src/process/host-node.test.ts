import { afterEach, describe, expect, it } from 'vitest'
import { tuiHandoffEnv } from '../tui/tui-node.js'
import { electronHostForNativeModules, resetElectronHostProbeForTest } from './host-node.js'

const ELECTRON = process.execPath

function loader(sqlite: () => unknown, electron: unknown = ELECTRON) {
  return (id: string) => {
    if (id === 'better-sqlite3') return sqlite()
    if (id === 'electron') return electron
    throw new Error(`unexpected module ${id}`)
  }
}

describe('electronHostForNativeModules', () => {
  afterEach(() => resetElectronHostProbeForTest())

  it('keeps the current interpreter when better-sqlite3 loads here', () => {
    const sqlite = () => class { close() {} }
    expect(electronHostForNativeModules(loader(sqlite))).toBeNull()
  })

  it('returns the checkout Electron binary on a native ABI mismatch', () => {
    const sqlite = () => {
      throw Object.assign(
        new Error('was compiled against a different Node.js version using NODE_MODULE_VERSION 148'),
        { code: 'ERR_DLOPEN_FAILED' }
      )
    }
    expect(electronHostForNativeModules(loader(sqlite))).toBe(ELECTRON)
  })

  it('does not switch hosts for unrelated load failures or a missing Electron', () => {
    const missing = () => { throw Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' }) }
    expect(electronHostForNativeModules(loader(missing))).toBeNull()
    resetElectronHostProbeForTest()
    const mismatch = () => { throw new Error('NODE_MODULE_VERSION 148') }
    expect(electronHostForNativeModules(loader(mismatch, '/missing/Electron'))).toBeNull()
  })
})

describe('tuiHandoffEnv', () => {
  it('passes the Electron host down when native modules need it', () => {
    const env = tuiHandoffEnv({}, () => '/checkout/Electron')
    expect(env.KUN_PACKAGED_RUNTIME_EXECUTABLE).toBe('/checkout/Electron')
    expect(env.KUN_HOST_NODE_EXECUTABLE).toBeUndefined()
  })

  it('keeps the launching Node otherwise and never overrides an explicit host', () => {
    expect(tuiHandoffEnv({}, () => null).KUN_HOST_NODE_EXECUTABLE).toBe(process.execPath)
    const explicit = tuiHandoffEnv({ KUN_HOST_NODE_EXECUTABLE: '/opt/node' }, () => '/checkout/Electron')
    expect(explicit.KUN_HOST_NODE_EXECUTABLE).toBe('/opt/node')
    expect(explicit.KUN_PACKAGED_RUNTIME_EXECUTABLE).toBeUndefined()
  })
})
