import { describe, expect, it } from 'vitest'
import {
  chunkQuotedLines,
  createTerminalOutputAttachment,
  selectRelevantLines,
  terminalOutputFromComposerContext
} from './terminal-output-attachment'

describe('terminal output attachment', () => {
  it('keeps short output whole and trims long output around failures', () => {
    expect(selectRelevantLines(['a', 'b']).lines).toEqual(['a', 'b'])
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`)
    lines[50] = 'Error: boom'
    const { lines: kept, omitted } = selectRelevantLines(lines)
    expect(kept).toContain('Error: boom')
    expect(kept).toContain('line 48')
    expect(kept).toContain('line 99')
    expect(kept.some((line) => /lines omitted/.test(line))).toBe(true)
    expect(omitted).toBeGreaterThan(50)
  })

  it('quotes lines so no chunk starts like an absolute path', () => {
    const chunks = chunkQuotedLines(['/Users/me/app/src/a.ts:1', '', 'ok'])
    expect(chunks).toEqual(['> /Users/me/app/src/a.ts:1\n>\n> ok'])
    const long = chunkQuotedLines(Array.from({ length: 40 }, () => 'x'.repeat(100)))
    expect(long.length).toBeGreaterThan(1)
    expect(long.every((chunk) => chunk.length <= 1_900)).toBe(true)
  })

  it('builds a valid composer context that round-trips into chip data', async () => {
    const attachment = await createTerminalOutputAttachment({
      workspaceRoot: '/Users/me/app',
      now: 1,
      draft: {
        source: 'command',
        command: '/usr/bin/env npx vitest run',
        exitCode: 1,
        durationMs: 1840,
        cwdLabel: '~/app',
        lines: ['/Users/me/app/src/a.test.ts', ' × fails', ...Array.from({ length: 2_000 }, (_, index) => `中文行 ${index}`)]
      }
    })
    expect(attachment.reference.kind).toBe('terminal-output')
    expect(attachment.reference.command).toBe('$ /usr/bin/env npx vitest run')
    expect(new TextEncoder().encode(JSON.stringify(attachment.reference)).byteLength).toBeLessThanOrEqual(16 * 1024)
    const display = terminalOutputFromComposerContext(attachment)
    expect(display).toMatchObject({ source: 'command', command: '/usr/bin/env npx vitest run', exitCode: 1, lineCount: 2_002 })
    expect(display?.preview[0]).toBe('/Users/me/app/src/a.test.ts')
  })
})
