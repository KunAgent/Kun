import { describe, expect, it } from 'vitest'
import { humanizeCommand, initialStatus, paneTitle, statusDot, strongestDot, type TerminalSessionStatus } from './terminal-dock-model'

function status(patch: Partial<TerminalSessionStatus>): TerminalSessionStatus {
  return { ...initialStatus(), phase: 'ready', ...patch }
}

describe('terminal dock model', () => {
  it('picks the dot by urgency', () => {
    expect(statusDot(status({}))).toBeNull()
    expect(statusDot(status({ activity: 'running' }))).toBe('running')
    expect(statusDot(status({ activity: 'done', unseen: true }))).toBe('done')
    expect(statusDot(status({ activity: 'done', unseen: false }))).toBeNull()
    expect(statusDot(status({ activity: 'waiting' }))).toBe('waiting')
    expect(statusDot(status({ phase: 'exited', exitCode: 2 }))).toBe('failed')
    expect(statusDot(status({ phase: 'exited', exitCode: 0 }))).toBeNull()
    expect(strongestDot(['running', 'done', null])).toBe('done')
    expect(strongestDot(['failed', 'waiting'])).toBe('waiting')
  })

  it('shortens commands for tab titles', () => {
    expect(humanizeCommand('NODE_ENV=test /usr/local/bin/node ./scripts/dev.js --watch')).toBe('dev.js --watch')
    expect(humanizeCommand('npm run dev')).toBe('npm run dev')
    expect(humanizeCommand('python3 -m http.server')).toBe('python3 -m http.server')
    expect(humanizeCommand('x'.repeat(60))).toHaveLength(40)
  })

  it('titles panes: rename, running command, launch title, directory', () => {
    const pane = { id: 'p', target: { kind: 'local' as const } }
    expect(paneTitle(pane, status({ cwd: '/Users/me/app' }), 'Shell')).toBe('app')
    expect(paneTitle(pane, status({ cwd: '/Users/me/app', commandRunning: true, command: 'npm test' }), 'Shell')).toBe('npm test')
    expect(paneTitle({ ...pane, title: 'npm run dev' }, status({ cwd: '/x' }), 'Shell')).toBe('npm run dev')
    expect(paneTitle({ ...pane, userTitle: 'mine' }, status({ commandRunning: true, command: 'vim' }), 'Shell')).toBe('mine')
    expect(paneTitle({ id: 'a', target: { kind: 'agent', harnessId: 'codex', title: 'Codex' }, title: 'Codex' }, undefined, 'Agent')).toBe('Codex')
  })
})
