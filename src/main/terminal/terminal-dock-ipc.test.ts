import { describe, expect, it } from 'vitest'
import { openSystemTerminal, systemTerminalCommands } from './terminal-dock-ipc'

describe('system terminal launch', () => {
  it('picks a native terminal command per platform', () => {
    expect(systemTerminalCommands('/w', 'darwin')).toEqual([{ file: 'open', args: ['-a', 'Terminal', '/w'] }])
    expect(systemTerminalCommands('C:\\w', 'win32')[0]).toEqual({ file: 'wt.exe', args: ['-d', 'C:\\w'] })
    expect(systemTerminalCommands('/w', 'linux').map((command) => command.file)).toContain('x-terminal-emulator')
  })

  it('refuses relative or missing directories', async () => {
    expect(await openSystemTerminal('relative/dir', 'linux')).toBe(false)
    expect(await openSystemTerminal('/definitely/not/here/kun', 'linux')).toBe(false)
  })
})
