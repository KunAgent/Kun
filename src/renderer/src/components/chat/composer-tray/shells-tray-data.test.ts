import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalOutputAttachment } from '../../../lib/terminal-output-attachment'
import { backgroundShellOutputDraft } from './shells-tray-actions'
import {
  backgroundShellDirectoryLabel,
  backgroundShellEndedBySignal,
  backgroundShellFailureLine,
  backgroundShellOutcome,
  backgroundShellOutputLines,
  backgroundShellRelativeDirectory,
  fetchBackgroundShells,
  isAbsoluteShellPath,
  sameBackgroundShellSessions,
  stripAnsiSequences,
  summarizeBackgroundShells,
  type BackgroundShellSession
} from './shells-tray-data'

const SINCE = Date.parse('2026-10-24T10:00:00.000Z')

function shell(id: string, overrides: Partial<BackgroundShellSession> = {}): BackgroundShellSession {
  return {
    id,
    threadId: 'thread-a',
    turnId: 'turn-a',
    command: `cmd ${id}`,
    cwd: '/Users/me/code/kun',
    shell: 'zsh',
    status: 'running',
    startedAt: '2026-10-24T10:05:00.000Z',
    exitCode: null,
    output: '',
    detached: true,
    ...overrides
  }
}

describe('stripAnsiSequences', () => {
  it('removes color, cursor and OSC sequences', () => {
    expect(stripAnsiSequences('\u001B[32m✓\u001B[39m passed \u001B[2m(4 tests)\u001B[22m')).toBe('✓ passed (4 tests)')
    expect(stripAnsiSequences('\u001B]0;vite\u0007ready\u001B]633;D;0\u001B\\ done')).toBe('ready done')
    expect(stripAnsiSequences('\u001B[2K\u001B[1Gbuilding')).toBe('building')
  })

  it('leaves plain text untouched when no escape sequences exist', () => {
    expect(stripAnsiSequences('plain output line')).toBe('plain output line')
  })
})

describe('backgroundShellOutcome', () => {
  it('classifies exits, stops and runtime failures', () => {
    expect(backgroundShellOutcome(shell('a'))).toBe('running')
    expect(backgroundShellOutcome(shell('a', { status: 'completed', exitCode: 0 }))).toBe('succeeded')
    expect(backgroundShellOutcome(shell('a', { status: 'completed', exitCode: 1 }))).toBe('failed')
    expect(backgroundShellOutcome(shell('a', { status: 'failed', exitCode: null, error: 'spawn ENOENT' }))).toBe('failed')
    expect(backgroundShellOutcome(shell('a', { status: 'completed', exitCode: null, error: 'killed' }))).toBe('failed')
    expect(backgroundShellOutcome(shell('a', { status: 'completed', exitCode: 0, error: 'stream closed' }))).toBe('failed')
    // A requested stop exits by signal; that is not a failure.
    expect(backgroundShellOutcome(shell('a', { status: 'stopped', exitCode: 143 }))).toBe('stopped')
    expect(backgroundShellOutcome(shell('a', { status: 'stopped', exitCode: null }))).toBe('stopped')
  })

  it('treats an exit by a signal nobody requested (a crash, an OOM kill) as a failure', () => {
    // bash -lc execs the last command, so a segfault reaches Kun as code null.
    const crashed = shell('a', { status: 'completed', exitCode: null, output: 'Segmentation fault' })
    expect(backgroundShellOutcome(crashed)).toBe('failed')
    expect(backgroundShellEndedBySignal(crashed)).toBe(true)
    expect(backgroundShellEndedBySignal(shell('a', { status: 'stopped', exitCode: null }))).toBe(false)
    expect(backgroundShellEndedBySignal(shell('a', { status: 'failed', exitCode: null, error: 'spawn ENOENT' }))).toBe(false)
    expect(backgroundShellEndedBySignal(shell('a', { status: 'completed', exitCode: 0 }))).toBe(false)
  })
})

describe('summarizeBackgroundShells', () => {
  const recent = '2026-10-24T10:20:00.000Z'
  const sessions = [
    shell('run-new', { startedAt: '2026-10-24T10:30:00.000Z' }),
    shell('run-old', { startedAt: '2026-10-24T10:01:00.000Z' }),
    shell('fail-old', { status: 'completed', exitCode: 1, finishedAt: '2026-10-24T10:10:00.000Z' }),
    shell('fail-new', { status: 'completed', exitCode: 2, finishedAt: recent }),
    shell('fail-previous-app', { status: 'failed', exitCode: 1, startedAt: '2026-10-23T09:00:00.000Z', finishedAt: '2026-10-23T09:01:00.000Z' }),
    shell('ok', { status: 'completed', exitCode: 0, finishedAt: recent }),
    shell('stopped', { status: 'stopped', exitCode: 143, finishedAt: '2026-10-24T10:21:00.000Z' })
  ]

  it('orders running by age, failures and finished by recency, and drops earlier app sessions', () => {
    const summary = summarizeBackgroundShells(sessions, { dismissed: new Set(), sinceMs: SINCE })
    expect(summary.running.map((session) => session.id)).toEqual(['run-old', 'run-new'])
    expect(summary.failed.map((session) => session.id)).toEqual(['fail-new', 'fail-old'])
    expect(summary.finished.map((session) => session.id)).toEqual(['stopped', 'ok'])
    expect(summary.active).toBe(true)
  })

  it('stays visible for undismissed failures only; finished commands never keep it', () => {
    const failuresOnly = summarizeBackgroundShells(sessions.filter((session) => session.status !== 'running'), {
      dismissed: new Set(['fail-old']),
      sinceMs: SINCE
    })
    expect(failuresOnly.failed.map((session) => session.id)).toEqual(['fail-new'])
    expect(failuresOnly.active).toBe(true)

    const finishedOnly = summarizeBackgroundShells(sessions.filter((session) => session.id === 'ok'), {
      dismissed: new Set(),
      sinceMs: SINCE
    })
    expect(finishedOnly.finished).toHaveLength(1)
    expect(finishedOnly.active).toBe(false)

    const dismissedAll = summarizeBackgroundShells(sessions.filter((session) => session.status !== 'running'), {
      dismissed: new Set(['fail-old', 'fail-new', 'ok', 'stopped']),
      sinceMs: SINCE
    })
    expect(dismissedAll.active).toBe(false)
    expect(dismissedAll.finished).toEqual([])
  })

  it('never hides a running command, even when its id was dismissed earlier', () => {
    const summary = summarizeBackgroundShells([shell('run')], { dismissed: new Set(['run']), sinceMs: SINCE })
    expect(summary.running).toHaveLength(1)
  })

  it('caps the finished rows', () => {
    const finished = Array.from({ length: 8 }, (_, index) => shell(`ok-${index}`, {
      status: 'completed', exitCode: 0, finishedAt: `2026-10-24T10:2${index}:00.000Z`
    }))
    const summary = summarizeBackgroundShells(finished, { dismissed: new Set(), sinceMs: SINCE, finishedLimit: 3 })
    expect(summary.finished.map((session) => session.id)).toEqual(['ok-7', 'ok-6', 'ok-5'])
  })
})

describe('sameBackgroundShellSessions', () => {
  it('compares field by field so unchanged polls keep the previous array', () => {
    const left = [shell('a', { output: 'one' })]
    expect(sameBackgroundShellSessions(left, [shell('a', { output: 'one' })])).toBe(true)
    expect(sameBackgroundShellSessions(left, [shell('a', { output: 'one two' })])).toBe(false)
    expect(sameBackgroundShellSessions(left, [shell('a', { output: 'one', status: 'completed', exitCode: 0 })])).toBe(false)
    expect(sameBackgroundShellSessions(left, [])).toBe(false)
  })
})

describe('output helpers', () => {
  it('keeps the last lines, collapses carriage-return redraws and trims blank edges', () => {
    const output = '\n\nstart\r\n10%\r50%\r100%\n\u001B[31mdone\u001B[0m\n\n'
    expect(backgroundShellOutputLines(output)).toEqual(['start', '100%', 'done'])
    expect(backgroundShellOutputLines('a\nb\nc\nd', 2)).toEqual(['c', 'd'])
    expect(backgroundShellOutputLines('')).toEqual([])
  })

  it('picks the line that names the cause of a failure', () => {
    const output = [
      ' FAIL  src/auth/token-cache.test.ts',
      "Error: Cannot find module './token-cache'",
      ' ❯ src/auth/token-cache.test.ts:2:1',
      ' Test Files  1 failed | 4 passed (5)'
    ].join('\n')
    expect(backgroundShellFailureLine(shell('a', { status: 'completed', exitCode: 1, output })))
      .toBe("Cannot find module './token-cache'")
    expect(backgroundShellFailureLine(shell('a', { status: 'failed', error: 'spawn pnpm ENOENT\nmore' })))
      .toBe('spawn pnpm ENOENT')
    expect(backgroundShellFailureLine(shell('a', { status: 'completed', exitCode: 3, output: 'step one\nstep two' })))
      .toBe('step two')
    expect(backgroundShellFailureLine(shell('a', { status: 'completed', exitCode: 3 }))).toBeNull()
  })

  it('shortens paths under the home directory', () => {
    expect(backgroundShellDirectoryLabel('/Users/me/code/kun', '/Users/me')).toBe('~/code/kun')
    expect(backgroundShellDirectoryLabel('/Users/me', '/Users/me/')).toBe('~')
    expect(backgroundShellDirectoryLabel('/srv/app', '/Users/me')).toBe('/srv/app')
    expect(backgroundShellDirectoryLabel('/Users/meadow/x', '/Users/me')).toBe('/Users/meadow/x')
    // POSIX paths stay case-sensitive.
    expect(backgroundShellDirectoryLabel('/users/me/code', '/Users/me')).toBe('/users/me/code')
  })

  it('shortens Windows paths under the home directory with either separator, ignoring case', () => {
    expect(backgroundShellDirectoryLabel('C:\\Users\\me\\code\\kun', 'C:\\Users\\me')).toBe('~\\code\\kun')
    expect(backgroundShellDirectoryLabel('c:\\users\\ME\\code', 'C:\\Users\\me\\')).toBe('~\\code')
    expect(backgroundShellDirectoryLabel('C:/Users/me/code', 'C:\\Users\\me')).toBe('~/code')
    expect(backgroundShellDirectoryLabel('C:\\Users\\me', 'C:\\Users\\me')).toBe('~')
    expect(backgroundShellDirectoryLabel('C:\\Users\\meadow\\x', 'C:\\Users\\me')).toBe('C:\\Users\\meadow\\x')
    expect(backgroundShellDirectoryLabel('D:\\work\\kun', 'C:\\Users\\me')).toBe('D:\\work\\kun')
  })

  it('reduces absolute directories to their folder name for composer context', () => {
    expect(isAbsoluteShellPath('/srv/app')).toBe(true)
    expect(isAbsoluteShellPath('C:\\work')).toBe(true)
    expect(isAbsoluteShellPath('d:/work')).toBe(true)
    expect(isAbsoluteShellPath('\\\\server\\share')).toBe(true)
    expect(isAbsoluteShellPath('file:///tmp')).toBe(true)
    expect(isAbsoluteShellPath('~/code')).toBe(false)
    expect(backgroundShellRelativeDirectory('/Users/me/code/kun', '/Users/me')).toBe('~/code/kun')
    expect(backgroundShellRelativeDirectory('/srv/app/', '/Users/me')).toBe('app')
    expect(backgroundShellRelativeDirectory('D:\\work\\kun', 'C:\\Users\\me')).toBe('kun')
    expect(backgroundShellRelativeDirectory('\\\\server\\share\\build', undefined)).toBe('build')
    expect(backgroundShellRelativeDirectory('/', undefined)).toBe('')
  })
})

describe('fetchBackgroundShells', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads a 404 as no shells and any other failure as transient', async () => {
    const runtimeRequest = vi.fn()
    vi.stubGlobal('window', { kunGui: { runtimeRequest } })
    runtimeRequest.mockResolvedValueOnce({ ok: true, status: 200, body: JSON.stringify({ sessions: [shell('a')], running: 1 }) })
    expect(await fetchBackgroundShells('thread a')).toEqual({ sessions: [shell('a')], running: 1 })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/background-shells?thread_id=thread%20a')
    runtimeRequest.mockResolvedValueOnce({ ok: false, status: 404, body: 'Not Found' })
    expect(await fetchBackgroundShells('thread-a')).toEqual({ sessions: [], running: 0 })
    const transient = [
      { ok: false, status: 500, body: 'Internal Server Error' },
      { ok: false, status: 0, body: '' },
      { ok: true, status: 200, body: 'not json' },
      { ok: true, status: 200, body: '{"error":"busy"}' }
    ]
    for (const result of transient) {
      runtimeRequest.mockResolvedValueOnce(result)
      expect(await fetchBackgroundShells('thread-a')).toBeNull()
    }
  })
})

describe('backgroundShellOutputDraft', () => {
  it('builds the terminal "send to Kun" draft with a relative directory and the runtime error', () => {
    const draft = backgroundShellOutputDraft(shell('a', {
      command: 'pnpm storybook',
      status: 'failed',
      exitCode: null,
      startedAt: '2026-10-24T10:00:00.000Z',
      finishedAt: '2026-10-24T10:00:02.500Z',
      output: '\u001B[2mstarting\u001B[22m',
      error: 'spawn pnpm ENOENT'
    }), '/Users/me')
    expect(draft).toEqual({
      source: 'command',
      command: 'pnpm storybook',
      exitCode: null,
      durationMs: 2500,
      cwdLabel: '~/code/kun',
      lines: ['starting', 'spawn pnpm ENOENT']
    })
    const outside = backgroundShellOutputDraft(shell('b', { cwd: '/srv/app', status: 'completed', exitCode: 1 }), '/Users/me')
    expect(outside.cwdLabel).toBe('app')
    expect(outside).not.toHaveProperty('durationMs')
  })

  it('builds a Windows draft that composer context accepts', async () => {
    const failed = shell('win', { cwd: 'C:\\Users\\me\\code\\kun', status: 'completed', exitCode: 1, output: 'boom' })
    const underHome = backgroundShellOutputDraft(failed, 'C:\\Users\\me')
    expect(underHome.cwdLabel).toBe('~\\code\\kun')
    const elsewhere = backgroundShellOutputDraft({ ...failed, cwd: 'D:\\work\\kun' }, 'C:\\Users\\me')
    expect(elsewhere.cwdLabel).toBe('kun')
    for (const draft of [underHome, elsewhere, backgroundShellOutputDraft(failed, undefined)]) {
      const attachment = await createTerminalOutputAttachment({ workspaceRoot: '', draft, now: 1 })
      expect((attachment.reference as Record<string, unknown>).directory).toBe(draft.cwdLabel)
    }
  })
})
