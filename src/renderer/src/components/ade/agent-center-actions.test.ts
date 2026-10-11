import { describe, expect, it } from 'vitest'
import { setupInstallCommand, setupLoginCommand } from './agent-center-actions'

const SETUP = {
  install: [
    { platform: 'darwin' as const, command: 'brew install x' },
    { platform: 'any' as const, command: 'npm i -g x' }
  ],
  login: { command: 'x', args: ['auth', 'login'], note: 'n' },
  adapter: { command: 'x-acp', install: 'npm i -g x-acp' },
  docsUrl: 'https://example.test'
}

describe('setupInstallCommand', () => {
  it('returns null without install entries', () => {
    expect(setupInstallCommand(undefined, 'darwin')).toBeNull()
    expect(setupInstallCommand({}, 'darwin')).toBeNull()
  })
})

describe('setupLoginCommand', () => {
  it('joins command and args for the terminal prefill', () => {
    expect(setupLoginCommand(SETUP)).toMatchObject({ command: 'x auth login' })
    expect(setupLoginCommand({ login: { command: 'x', args: [] } })).toMatchObject({ command: 'x' })
  })
})

it('uses the checked native login executable and quotes shell-sensitive paths instead of another PATH alias', () => {
  const value = setupLoginCommand({ login: { command: 'agent', args: ['login'] } }, '/Users/fixture/Agent $(touch bad)/agent', 'darwin')
  expect(value?.command).toBe("'/Users/fixture/Agent $(touch bad)/agent' login")
  expect(setupLoginCommand({ login: { command: 'agent', args: ['login'] } }, 'C:\\Program Files\\Cursor\\agent.exe', 'win32')?.command)
    .toBe("& 'C:\\Program Files\\Cursor\\agent.exe' login")
})
