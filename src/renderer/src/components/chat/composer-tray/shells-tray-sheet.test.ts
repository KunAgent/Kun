import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../../i18n'
import { summarizeBackgroundShells, type BackgroundShellSession } from './shells-tray-data'
import { backgroundShellSegmentLabel, ShellsTraySegment } from './shells-tray-kind'
import { backgroundShellRowSubtitle } from './shells-tray-rows'
import {
  backgroundShellSheetSummary,
  defaultExpandedBackgroundShell,
  resolveExpandedBackgroundShell,
  ShellsTraySheet
} from './shells-tray-sheet'

const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string

function shell(id: string, overrides: Partial<BackgroundShellSession> = {}): BackgroundShellSession {
  return {
    id,
    threadId: 'thread-a',
    turnId: 'turn-a',
    command: `cmd ${id}`,
    cwd: '/Users/me/code/kun',
    shell: 'zsh',
    status: 'running',
    startedAt: new Date(NOW - 728_000).toISOString(),
    exitCode: null,
    output: '',
    detached: true,
    ...overrides
  }
}

const running = shell('dev', { command: 'npm run dev', output: 'ready in 412 ms' })
const failed = shell('vitest', {
  command: 'npx vitest --watch src/auth',
  status: 'completed',
  exitCode: 1,
  finishedAt: new Date(NOW - 125_000).toISOString(),
  output: "Error: Cannot find module './token-cache'"
})
const lint = shell('lint', {
  command: 'npm run lint',
  status: 'completed',
  exitCode: 0,
  finishedAt: new Date(NOW - 490_000).toISOString()
})

function summarize(sessions: BackgroundShellSession[]) {
  return summarizeBackgroundShells(sessions, { dismissed: new Set(), sinceMs: NOW - 3_600_000 })
}

function sheet(sessions: BackgroundShellSession[], props: { compact?: boolean; canSendToKun?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(ShellsTraySheet, {
    summary: summarize(sessions),
    compact: props.compact ?? false,
    canSendToKun: props.canSendToKun ?? true,
    onClose: () => undefined,
    onStop: async () => undefined,
    onPresenceChange: () => undefined
  }))
}

describe('background shell sheet copy', () => {
  beforeEach(async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('zh')
  })

  it('formats the header summary and row subtitles like the board', () => {
    const summary = summarize([running, failed, lint])
    expect(backgroundShellSheetSummary(summary, NOW, t)).toBe('12 分 8 秒 · 1 个在后台 · 1 个失败')
    expect(backgroundShellRowSubtitle(running, 'running', NOW, t, '/Users/me')).toBe('已运行 12 分 8 秒 · ~/code/kun')
    expect(backgroundShellRowSubtitle(failed, 'failed', NOW, t, '/Users/me'))
      .toBe("退出码 1 · 2 分钟前 · Cannot find module './token-cache'")
    expect(backgroundShellRowSubtitle(lint, 'succeeded', NOW, t, '/Users/me')).toBe('退出码 0 · 8 分钟前')
    const stopped = shell('srv', { status: 'stopped', exitCode: 143, finishedAt: new Date(NOW - 300_000).toISOString() })
    expect(backgroundShellRowSubtitle(stopped, 'stopped', NOW, t, '/Users/me')).toBe('已停止 · 5 分钟前')
    const crashed = shell('crash', {
      command: 'node crash.js',
      status: 'completed',
      exitCode: null,
      finishedAt: new Date(NOW - 3_000).toISOString(),
      output: 'Segmentation fault'
    })
    expect(backgroundShellRowSubtitle(crashed, 'failed', NOW, t, '/Users/me')).toBe('被信号终止 · 刚刚 · Segmentation fault')
    expect(backgroundShellSheetSummary(summarize([failed]), NOW, t)).toBe('1 个失败')
  })

  it('labels the segment with the one live command or a count', () => {
    expect(backgroundShellSegmentLabel(summarize([running]), t)).toBe('后台命令：npm run dev')
    expect(backgroundShellSegmentLabel(summarize([running, lint]), t)).toBe('后台命令：npm run dev')
    // A failure next to the one live command switches to counts, so the red
    // count never reads as that command's failure.
    const mixed = summarize([running, failed])
    expect(backgroundShellSegmentLabel(mixed, t)).toBe('后台命令：1 个在后台 · 1 个失败')
    const mixedSegment = renderToStaticMarkup(createElement(ShellsTraySegment, { summary: mixed, compact: false }))
    expect(mixedSegment).toContain('2 个后台命令')
    expect(mixedSegment).not.toContain('npm run dev')
    expect(mixedSegment).toMatch(/data-tone="running">.*?1<\/span>/)
    expect(mixedSegment).toMatch(/data-tone="error">.*?1<\/span>/)
    const two = summarize([running, shell('tsc', { command: 'npx tsc --watch' }), failed])
    expect(backgroundShellSegmentLabel(two, t)).toBe('后台命令：2 个在后台 · 1 个失败')
    const solo = renderToStaticMarkup(createElement(ShellsTraySegment, { summary: summarize([running]), compact: false }))
    expect(solo).toContain('npm run dev')
    expect(solo).toContain('data-tone="done"')
    expect(solo).not.toContain('data-tone="error"')
    const counted = renderToStaticMarkup(createElement(ShellsTraySegment, { summary: two, compact: false }))
    expect(counted).toContain('3 个后台命令')
    expect(counted).toMatch(/data-tone="running">.*?2<\/span>/)
    expect(counted).toMatch(/data-tone="error">.*?1<\/span>/)
    const compact = renderToStaticMarkup(createElement(ShellsTraySegment, { summary: two, compact: true }))
    expect(compact).not.toContain('后台命令')
    expect(compact).toContain('ds-composer-tray-count">2<')
  })
})

describe('ShellsTraySheet markup', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('lists live, failed, then finished commands and expands the only live one', () => {
    const html = sheet([lint, failed, running])
    const order = ['dev', 'vitest', 'lint'].map((id) => html.indexOf(`data-background-shell-row="${id}"`))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(defaultExpandedBackgroundShell(summarize([running, failed]))).toBe('dev')
    expect(defaultExpandedBackgroundShell(summarize([running, shell('b')]))).toBeNull()
    expect(html).toContain('data-background-shell-output')
    expect(html).toContain('ready in 412 ms')
    expect(html).toContain('aria-label="Hide output of npm run dev"')
    expect(html).toContain('aria-label="Show output of npx vitest --watch src/auth"')
    // Every row keeps its (hidden while collapsed) detail box, so expanding
    // never remounts the row's open button.
    expect(html.match(/data-background-shell-detail/g)).toHaveLength(3)
    expect(html.match(/class="ds-shells-detail" hidden=""/g)).toHaveLength(2)
    expect(html.match(/data-background-shell-output/g)).toHaveLength(1)
    expect(html).toContain('role="list"')
    expect(html).toContain('Collapse')
    // Running: copy + stop. Failed: pill + send. Finished: dismiss only.
    expect(html).toContain('Copy output')
    expect(html).toContain('Stop')
    expect(html).toContain('Failed')
    expect(html).toContain('Send to Kun')
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(2)
  })

  it('keeps the picked row while it is listed and falls back to the default', () => {
    const live = summarize([running, failed])
    expect(resolveExpandedBackgroundShell(undefined, live)).toBe('dev')
    expect(resolveExpandedBackgroundShell(null, live)).toBeNull()
    expect(resolveExpandedBackgroundShell('vitest', live)).toBe('vitest')
    // The latched live command stays open once it finished (now a finished row).
    const finished = { ...running, status: 'completed' as const, exitCode: 0, finishedAt: new Date(NOW).toISOString() }
    expect(resolveExpandedBackgroundShell('dev', summarize([finished, failed]))).toBe('dev')
    // A dismissed / vanished pick falls back to the default.
    expect(resolveExpandedBackgroundShell('gone', live)).toBe('dev')
    expect(resolveExpandedBackgroundShell('gone', summarize([failed]))).toBeNull()
  })

  it('offers copy instead of send when the composer cannot take the output', () => {
    const html = sheet([failed], { canSendToKun: false })
    expect(html).not.toContain('Send to Kun')
    expect(html).toContain('Copy output')
  })

  it('uses icon controls and no failure pill in compact sheets', () => {
    const html = sheet([running, failed], { compact: true, canSendToKun: false })
    expect(html).toContain('aria-label="Copy output"')
    expect(html).toContain('aria-label="Stop"')
    expect(html).not.toContain('ds-composer-tray-pill')
  })

  it('shows the empty-output text and the full-output file line', () => {
    const quiet = shell('quiet', {
      command: 'cargo build --release',
      output: '',
      outputTruncated: true,
      outputFilePath: '/Users/me/.kun/shells/quiet.log'
    })
    const html = sheet([quiet])
    expect(html).toContain('(no output yet)')
    expect(html).toContain('data-empty="true"')
    expect(html).toContain('Full output: /Users/me/.kun/shells/quiet.log · preview truncated')
    // Copy is disabled while there is nothing to copy.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Copy output/)
  })

  it('wraps long commands and output inside the sheet instead of clipping', () => {
    const long = shell('long', {
      command: `cd /very/long/path && npx vitest run ${'x'.repeat(200)}`,
      output: 'line with long content'
    })
    const html = sheet([long])
    expect(html).toContain('ds-shells-output-command')
    expect(html).toContain(`$ cd /very/long/path &amp;&amp; npx vitest run ${'x'.repeat(200)}`)
    expect(html).toContain('ds-shells-output ds-shells-mono')
  })

  it('renders the empty state when every row is gone', () => {
    expect(sheet([])).toContain('No background commands.')
  })
})
