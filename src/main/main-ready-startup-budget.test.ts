import { describe, expect, it, vi } from 'vitest'
import { startWindowFirstStartup } from './main-startup-orchestrator'

describe('startWindowFirstStartup', () => {
  it('creates the workbench window before a slow background service init settles', async () => {
    let resolveBackground!: () => void
    const background = new Promise<void>((resolve) => { resolveBackground = resolve })
    const events: string[] = []

    const starting = startWindowFirstStartup({
      initializeShell: async () => ({
        shellSettings: { appBehavior: {} } as never,
        productionSettingsPath: '/tmp/kun/settings.json'
      }),
      registerShellIpc: () => events.push('shell-ipc'),
      transitionShellReady: () => events.push('shell-ready'),
      createWindow: () => events.push('window'),
      windowAvailable: () => events.push('window-available'),
      syncTray: () => events.push('tray'),
      startBackground: async () => {
        events.push('background-started')
        await background
        events.push('background-settled')
      }
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual([
      'shell-ipc',
      'shell-ready',
      'window',
      'window-available',
      'tray',
      'background-started'
    ])

    resolveBackground()
    await expect(starting).resolves.toMatchObject({
      shell: { productionSettingsPath: '/tmp/kun/settings.json' },
      background: undefined
    })
    expect(events.at(-1)).toBe('background-settled')
  })

  it('does not create a window when the shell requests a relaunch', async () => {
    const createWindow = vi.fn()
    await expect(startWindowFirstStartup({
      initializeShell: async () => null,
      registerShellIpc: vi.fn(),
      transitionShellReady: vi.fn(),
      createWindow,
      windowAvailable: vi.fn(),
      syncTray: vi.fn(),
      startBackground: vi.fn()
    })).resolves.toBeNull()
    expect(createWindow).not.toHaveBeenCalled()
  })
})
