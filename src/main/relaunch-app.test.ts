import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, relaunch: vi.fn() } }))

import { app } from 'electron'
import { relaunchApp, resolveRelaunchOptions } from './relaunch-app'

const linux = {
  platform: 'linux' as const,
  isPackaged: true,
  execPath: '/opt/Kun/kun-gui.electron-bin',
  argv: ['/opt/Kun/kun-gui.electron-bin', '--disable-setuid-sandbox', 'kun://account']
}

describe('packaged Linux relaunch', () => {
  it('restarts an AppImage from the original file and preserves all arguments', () => {
    const options = resolveRelaunchOptions({
      ...linux,
      execPath: '/tmp/.mount_Kun/kun-gui.electron-bin',
      appImage: '/home/user/My Apps/Kun 0.4.4.AppImage'
    })
    expect(options).toEqual({
      execPath: '/home/user/My Apps/Kun 0.4.4.AppImage',
      args: ['--disable-setuid-sandbox', 'kun://account']
    })
    expect(options?.args).not.toBe(linux.argv)
  })

  it('re-enters the launcher next to the deb Electron payload', () => {
    expect(resolveRelaunchOptions(linux)).toEqual({
      execPath: '/opt/Kun/kun-gui',
      args: ['--disable-setuid-sandbox', 'kun://account']
    })
  })

  it('rejects a relative or NUL-containing AppImage path', () => {
    for (const appImage of ['Kun.AppImage', '/tmp/Kun\0.AppImage']) {
      expect(() => resolveRelaunchOptions({ ...linux, appImage })).toThrow(/absolute path/)
    }
  })

  it('retains Electron defaults outside packaged Linux launcher builds', () => {
    expect(resolveRelaunchOptions({ ...linux, platform: 'darwin', appImage: '/tmp/Kun.AppImage' })).toBeUndefined()
    expect(resolveRelaunchOptions({ ...linux, platform: 'win32' })).toBeUndefined()
    expect(resolveRelaunchOptions({ ...linux, isPackaged: false })).toBeUndefined()
    expect(resolveRelaunchOptions({ ...linux, execPath: '/usr/bin/electron' })).toBeUndefined()
  })

  it('calls Electron without options for an unpackaged app', () => {
    relaunchApp()
    expect(app.relaunch).toHaveBeenCalledWith()
  })
})
