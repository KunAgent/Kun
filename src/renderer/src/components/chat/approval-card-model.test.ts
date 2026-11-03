import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import {
  APPROVAL_DIFF_MAX_ROWS,
  abbreviateHomePath,
  approvalCardModel,
  approvalDescription,
  approvalDiffFile,
  approvalDiffFiles,
  approvalDisplayPath,
  approvalExtraInput
} from './approval-card-model'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}${JSON.stringify(options)}` : key

function block(action: ApprovalBlock['action'], overrides: Partial<ApprovalBlock> = {}): ApprovalBlock {
  return { kind: 'approval', id: 'a1', approvalId: 'appr_1', summary: 'summary', status: 'pending', action, ...overrides }
}

describe('approval card paths', () => {
  it('shows workspace-relative paths and abbreviates home folders', () => {
    expect(approvalDisplayPath('/Users/me/kun/src/main/a.ts', '/Users/me/kun')).toBe('src/main/a.ts')
    expect(approvalDisplayPath('/Users/me/other/a.ts', '/Users/me/kun')).toBe('~/other/a.ts')
    expect(abbreviateHomePath('/home/dev/code/kun')).toBe('~/code/kun')
    expect(abbreviateHomePath('C:\\Users\\dev\\code')).toBe('~\\code')
    expect(abbreviateHomePath('/opt/kun')).toBe('/opt/kun')
  })
})

describe('approval diff rows', () => {
  it('marks replaced lines and leaves snippet context unnumbered', () => {
    const file = approvalDiffFile({
      path: '/w/src/a.ts',
      oldText: 'function f() {\n  log(1)\n}\n',
      newText: 'function f() {\n  log(2)\n  clear()\n}\n'
    }, { workspace: '/w' })
    expect(file).toMatchObject({ displayPath: 'src/a.ts', added: 2, removed: 1, clipped: false })
    expect(file.rows).toEqual([
      { type: 'context', text: 'function f() {' },
      { type: 'remove', text: '  log(1)' },
      { type: 'add', text: '  log(2)' },
      { type: 'add', text: '  clear()' },
      { type: 'context', text: '}' }
    ])
  })

  it('numbers context rows when the runtime located the snippet', () => {
    const file = approvalDiffFile({ path: 'a.ts', oldText: 'a\nb\n', newText: 'a\nc\n' }, { startLine: 84 })
    expect(file.rows[0]).toEqual({ type: 'context', text: 'a', line: 84 })
  })

  it('numbers every line of a whole-file write and caps long files', () => {
    const write = approvalDiffFile({ path: 'n.ts', oldText: null, newText: 'one\ntwo\n' })
    expect(write.rows).toEqual([{ type: 'add', text: 'one', line: 1 }, { type: 'add', text: 'two', line: 2 }])
    const long = approvalDiffFile({ path: 'n.ts', oldText: null, newText: 'x\n'.repeat(APPROVAL_DIFF_MAX_ROWS + 5) })
    expect(long).toMatchObject({ added: APPROVAL_DIFF_MAX_ROWS + 5, clipped: true })
    expect(long.rows).toHaveLength(APPROVAL_DIFF_MAX_ROWS)
  })

  it('groups several replacements in one file into one section', () => {
    const files = approvalDiffFiles([
      { path: '/w/a.ts', oldText: 'a\n', newText: 'b\n' },
      { path: '/w/b.ts', oldText: 'x\n', newText: 'y\n' },
      { path: '/w/a.ts', oldText: 'c\n', newText: 'd\ne\n' }
    ], { workspace: '/w' })
    expect(files.map((file) => [file.displayPath, file.added, file.removed])).toEqual([['a.ts', 3, 2], ['b.ts', 1, 1]])
    expect(files[0].rows.map((row) => row.type)).toEqual(['remove', 'add', 'gap', 'remove', 'add', 'add'])
  })

  it('separates hunks with a gap row', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`)
    const changed = [...lines]
    changed[1] = 'first'
    changed[18] = 'second'
    const file = approvalDiffFile({ path: 'a', oldText: `${lines.join('\n')}\n`, newText: `${changed.join('\n')}\n` })
    expect(file.rows.filter((row) => row.type === 'gap')).toHaveLength(1)
  })
})

describe('approval card model', () => {
  it('builds a command card with its cwd and the tool description', () => {
    const model = approvalCardModel(block({
      kind: 'command', toolName: 'Bash', cwd: '/Users/me/kun',
      arguments: { command: 'npm run build && npx vitest run src/auth', description: 'Build, then run the auth tests' },
      targets: [{ kind: 'command', value: 'npm run build && npx vitest run src/auth' }],
      reason: 'runtime tool policy requires approval'
    }, { toolName: 'Bash' }), t)
    expect(model).toMatchObject({
      family: 'command',
      badge: 'composerApproval.kind.command',
      question: 'approvalCommandQuestion',
      description: 'Build, then run the auth tests',
      content: { kind: 'command', command: 'npm run build && npx vitest run src/auth', cwd: '/Users/me/kun' }
    })
  })

  it('builds an edit card from ACP diff changes', () => {
    const model = approvalCardModel(block({
      kind: 'file', toolName: 'acp:edit', workspace: '/w',
      arguments: { title: 'Clear the session when refresh fails', changes: [{ path: '/w/src/main/session-store.ts', oldText: 'a\n', newText: 'b\nc\n' }] },
      targets: [{ kind: 'file', value: '/w/src/main/session-store.ts' }],
      reason: 'Clear the session when refresh fails'
    }, { toolName: 'acp:edit' }), t)
    expect(model.family).toBe('edit')
    expect(model.badge).toBe('composerApproval.kind.edit')
    expect(model.question).toBe('composerApproval.question.edit{"file":"session-store.ts"}')
    expect(model.description).toBe('Clear the session when refresh fails')
    expect(model.content).toMatchObject({ kind: 'edit', added: 2, removed: 1, files: [{ displayPath: 'src/main/session-store.ts' }] })
  })

  it('names other tools in the badge and keeps generic policy reasons out', () => {
    const model = approvalCardModel(block({
      kind: 'mcp', toolName: 'docs_search', arguments: { query: 'x', __truncated__: true },
      reason: 'runtime tool policy requires approval'
    }, { toolName: 'docs_search' }), t)
    expect(model).toMatchObject({
      family: 'other',
      badge: 'composerApproval.kind.tool{"name":"docs_search"}',
      description: null,
      truncated: true,
      content: { kind: 'other', summary: 'summary' }
    })
  })

  it('drops ACP titles that only repeat the command', () => {
    expect(approvalDescription(
      { kind: 'command', toolName: 'acp:execute', reason: '`npm test`', arguments: {} },
      { kind: 'command', command: 'npm test' }
    )).toBeNull()
    expect(approvalDescription(
      { kind: 'command', toolName: 'acp:execute', reason: 'ACP agent requested permission for acp:execute', arguments: {} },
      { kind: 'command', command: 'npm test' }
    )).toBeNull()
  })

  it('builds a mail card without a reason line', () => {
    const model = approvalCardModel(block({
      kind: 'external-effect', toolName: 'gmail_send',
      arguments: { to: ['a@example.com'], subject: 'Hi', body: 'Body', description: 'Reply to Ann' }
    }, { toolName: 'gmail_send' }), t)
    expect(model).toMatchObject({ family: 'email', badge: 'composerApproval.kind.email', question: 'approvalEmailQuestion', description: null })
  })
})

describe('approval card extra input', () => {
  it('lists command arguments the terminal preview does not show', () => {
    const model = approvalCardModel(block({
      kind: 'command', toolName: 'shell', workspace: '/w', cwd: '/w',
      arguments: {
        command: 'npm run deploy', cwd: '/w', run_in_background: true, timeout: 600000,
        with_escalated_permissions: true, justification: 'needs   network\nto push', env: { NODE_ENV: 'production' }, note: '', dry_run: false
      },
      targets: [{ kind: 'command', value: 'npm run deploy' }]
    }, { toolName: 'shell' }), t)
    expect(model.extraInput).toEqual([
      { key: 'run_in_background', value: 'true' },
      { key: 'timeout', value: '600000' },
      { key: 'with_escalated_permissions', value: 'true' },
      { key: 'justification', value: 'needs network to push' },
      { key: 'env', value: '{"NODE_ENV":"production"}' }
    ])
  })

  it('treats the ACP envelope, the reason line and the diff fields as shown', () => {
    expect(approvalExtraInput(
      { kind: 'command', toolName: 'acp:execute', arguments: { title: 'npm test', kind: 'execute', rawInput: { command: 'npm test', description: 'Run tests' } } },
      { kind: 'command', command: 'npm test' }
    )).toEqual([])
    const edit = { kind: 'edit' as const, files: [], added: 0, removed: 0 }
    expect(approvalExtraInput({
      kind: 'file', toolName: 'acp:edit',
      arguments: { title: 'Edit a.ts', kind: 'edit', locations: [{ path: '/w/a.ts', line: 3 }], changes: [{ type: 'diff', path: '/w/a.ts', oldText: 'a', newText: 'b' }] }
    }, edit)).toEqual([])
    expect(approvalExtraInput({
      kind: 'file', toolName: 'edit',
      arguments: { path: 'a.ts', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd', replace_all: true }] }
    }, edit)).toEqual([{ key: 'edits[1].replace_all', value: 'true' }])
    expect(approvalExtraInput({
      kind: 'file', toolName: 'acp:edit',
      arguments: { kind: 'edit', rawInput: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b', replace_all: true } }
    }, edit)).toEqual([{ key: 'replace_all', value: 'true' }])
    // `false` flags are the default and add no row.
    expect(approvalExtraInput({
      kind: 'file', toolName: 'acp:edit',
      arguments: { kind: 'edit', rawInput: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b', replace_all: false } }
    }, edit)).toEqual([])
  })

  it('shortens long values and leaves mail and other tools alone', () => {
    const [entry] = approvalExtraInput(
      { kind: 'command', toolName: 'shell', arguments: { command: 'x', justification: 'y'.repeat(400) } },
      { kind: 'command', command: 'x' }
    )
    expect(entry.value.length).toBe(160)
    expect(entry.value.endsWith('\u2026')).toBe(true)
    expect(approvalExtraInput({ kind: 'mcp', toolName: 'docs_search', arguments: { query: 'x' } },
      { kind: 'other', summary: 'x', presentation: null })).toEqual([])
  })
})
