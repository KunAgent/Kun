import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ThreadSchema } from '../contracts/threads.js'
import type { ThreadDetail } from './client.js'
import {
  editTextInExternalEditor,
  lastAssistantText,
  osc52ClipboardSequence,
  resolveThreadExportPath,
  renderThreadMarkdown,
  splitEditorCommandLine,
  writeThreadExport
} from './operations.js'

function detail(): ThreadDetail {
  const createdAt = '2026-07-22T00:00:00.000Z'
  return {
    ...ThreadSchema.parse({
      id: 'thr_export',
      title: 'Demo\x1b]0;owned\x07 thread',
      workspace: '/tmp/project',
      model: 'model-a',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      createdAt,
      updatedAt: createdAt,
      turns: [{
        id: 'turn_1',
        threadId: 'thr_export',
        status: 'completed',
        prompt: 'hello',
        steering: [],
        createdAt,
        completedAt: createdAt,
        attachmentIds: [],
        activeSkillIds: [],
        injectedMemoryIds: [],
        injectedMemorySummaries: [],
        injectedInstructionSources: [],
        items: [{
          id: 'item_user', turnId: 'turn_1', threadId: 'thr_export', role: 'user',
          createdAt, kind: 'user_message', status: 'completed', text: 'hello'
        }, {
          id: 'item_assistant', turnId: 'turn_1', threadId: 'thr_export', role: 'assistant',
          createdAt, kind: 'assistant_text', status: 'completed', text: 'safe\x1b[2J answer\ntoken=do-not-export'
        }, {
          id: 'item_tool', turnId: 'turn_1', threadId: 'thr_export', role: 'tool',
          createdAt, kind: 'tool_result', status: 'completed', toolName: 'probe', callId: 'call_1',
          toolKind: 'tool_call', output: { apiKey: 'object-secret', response: '{"token":"json-secret"}' }, isError: false
        }]
      }]
    }),
    latestSeq: 0,
    pendingUserInputIds: []
  }
}

describe('TUI local operations', () => {
  it('finds the latest assistant text and exports sanitized Markdown without overwriting', async () => {
    const thread = detail()
    expect(lastAssistantText(thread)).toBe('safe\x1b[2J answer\ntoken=do-not-export')
    expect(renderThreadMarkdown(thread)).toContain('safe answer')
    expect(renderThreadMarkdown(thread)).not.toContain('\x1b')
    expect(renderThreadMarkdown(thread)).toContain('token=<redacted>')
    expect(renderThreadMarkdown(thread)).not.toContain('do-not-export')
    expect(renderThreadMarkdown(thread)).not.toMatch(/object-secret|json-secret/u)
    expect(renderThreadMarkdown(thread)).toContain('"apiKey": "<redacted>"')
    thread.title = 'Demo token=title-secret'
    expect(resolveThreadExportPath(thread)).not.toContain('title-secret')

    const directory = await mkdtemp(join(tmpdir(), 'kun-tui-export-'))
    const path = join(directory, 'conversation.md')
    try {
      await expect(writeThreadExport(thread, path)).resolves.toBe(path)
      await expect(writeThreadExport(thread, path)).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(path, 'utf8')).toContain('# Demo token=<redacted>')
      if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('exports chart results as a bounded Markdown table', () => {
    const thread = detail()
    const turn = thread.turns[0]!
    turn.items.push({
      id: 'item_chart', turnId: turn.id, threadId: thread.id, role: 'tool',
      createdAt: turn.createdAt, kind: 'tool_result', status: 'completed',
      toolName: 'mcp__kun__render_chart', callId: 'call_chart', toolKind: 'tool_call', isError: false,
      output: JSON.stringify({
        status: 'completed',
        chart: {
          version: 1, type: 'line', title: 'Errors',
          data: [{ day: 'Mon', count: 2 }, { day: 'Tue', count: 5 }],
          x: { field: 'day' }, series: [{ field: 'count' }]
        }
      })
    })
    const markdown = renderThreadMarkdown(thread)
    expect(markdown).toContain('> Chart `line`: Errors')
    expect(markdown).toContain('| day | count |')
    expect(markdown).toContain('| Tue | 5 |')
    expect(markdown).not.toContain('"status": "completed"')
  })

  it('uses an argv-based external editor and cleans up its temporary file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-tui-editor-test-'))
    const script = join(directory, 'editor.mjs')
    try {
      await writeFile(script, "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], '\\nedited\\n')\n")
      const result = await editTextInExternalEditor('draft', `"${process.execPath}" "${script}"`)
      expect(result).toBe('draft\nedited\n')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves Windows path separators in quoted editor commands', () => {
    expect(splitEditorCommandLine(
      '"C:\\Program Files\\nodejs\\node.exe" "D:\\work tree\\editor.mjs"',
      'win32'
    )).toEqual([
      'C:\\Program Files\\nodejs\\node.exe',
      'D:\\work tree\\editor.mjs'
    ])
  })

  it('creates a bounded OSC52 clipboard fallback', () => {
    const sequence = osc52ClipboardSequence('hello', false)
    expect(sequence).toBe('\x1b]52;c;aGVsbG8=\x07')
    expect(osc52ClipboardSequence('x'.repeat(200_000), false).length).toBeLessThan(140_000)
    expect(osc52ClipboardSequence('hello', true)).toBe(
      '\x1bPtmux;\x1b\x1b]52;c;aGVsbG8=\x07\x1b\\'
    )
  })
})
