import { describe, expect, it } from 'vitest'
import {
  backgroundShellNoticeDisplayText,
  formatBackgroundShellCompletionNotice,
  parseBackgroundShellCompletionNotice
} from '../src/services/background-shell-notice.js'

describe('background-shell-notice', () => {
  it('formats and parses completion notices as xml', () => {
    const xml = formatBackgroundShellCompletionNotice({
      id: 'abcd1234',
      threadId: 'thr_1',
      turnId: 'turn_1',
      command: 'npm run build',
      cwd: '/tmp',
      shell: 'bash',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:05.000Z',
      exitCode: 0,
      output: 'build ok',
      detached: true
    })
    expect(xml).toContain('<background_shell_completed>')
    expect(xml).toContain('<session_id>abcd1234</session_id>')
    expect(xml).toContain('<command>npm run build</command>')
    expect(parseBackgroundShellCompletionNotice(xml)).toEqual({
      sessionId: 'abcd1234',
      command: 'npm run build',
      exitCode: 0,
      outputPreview: 'build ok',
      hint: expect.stringContaining('background_shell action="read"')
    })
  })

  it('escapes xml characters in command and output preview', () => {
    const xml = formatBackgroundShellCompletionNotice({
      id: 'sess1',
      threadId: 'thr_1',
      turnId: 'turn_1',
      command: 'echo "<tag>&"',
      cwd: '/tmp',
      shell: 'bash',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      exitCode: 0,
      output: '<done>',
      detached: true
    })
    expect(xml).toContain('<command>echo &quot;&lt;tag&gt;&amp;&quot;</command>')
    expect(parseBackgroundShellCompletionNotice(xml)?.command).toBe('echo "<tag>&"')
    expect(parseBackgroundShellCompletionNotice(xml)?.outputPreview).toBe('<done>')
  })

  it('includes the output file path in completion notices when available', () => {
    const xml = formatBackgroundShellCompletionNotice({
      id: 'abcd1234',
      threadId: 'thr_1',
      turnId: 'turn_1',
      command: 'npm run build',
      cwd: '/tmp',
      shell: 'bash',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      exitCode: 0,
      output: 'ok',
      outputFilePath: '/data/threads/thr_1/background-shells/abcd1234.output',
      detached: true
    })
    expect(xml).toContain('<output_file>/data/threads/thr_1/background-shells/abcd1234.output</output_file>')
    expect(xml).not.toContain('<output_dir>')
  })

  it('builds a short display label for the renderer', () => {
    expect(backgroundShellNoticeDisplayText('abcd1234')).toBe('Background shell abcd1234 completed')
  })
})
