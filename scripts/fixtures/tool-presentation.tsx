import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ToolPresentation } from '../../src/shared/tool-presentation'
import type { ChatBlock, ToolBlock } from '../../src/renderer/src/agent/types'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'
import '../../src/renderer/src/styles/markdown-code.css'

const actions: unknown[] = []
Object.assign(window, { kunGui: { platform: 'linux',
  openExternal: async (url: string) => { actions.push({ type: 'external', url }) },
  runtimeRequest: async () => ({ ok: true, status: 200, body: JSON.stringify({ buckets: [] }) }) } })
const [{ ToolBlockDetails }, { ToolStateMeta }, { FloatingComposerApprovalPanel }, { useChatStore },
  { TimelineFilePreviewWorkspaceProvider }, language, theme] = await Promise.all([
  import('../../src/renderer/src/components/chat/ToolBlockDetails'),
  import('../../src/renderer/src/components/chat/ToolStateMeta'),
  import('../../src/renderer/src/components/chat/FloatingComposerApprovalPanel'),
  import('../../src/renderer/src/store/chat-store'),
  import('../../src/renderer/src/components/chat/timeline-file-preview-workspace'),
  import('../../src/renderer/src/i18n'), import('../../src/renderer/src/lib/apply-theme')
])
await language.default.changeLanguage('en')
theme.applyTheme('light')
useChatStore.setState({ resolveApproval: async (id, decision, choice) => { actions.push({ type: 'approval', id, decision, choice }) } })
const base: ToolPresentation = { version: 1, kind: 'read', state: 'completed', canCancel: false }
const cases: Record<string, ToolPresentation> = {
  read: { ...base, name: 'read', title: 'Read src/session.ts', filePath: 'src/session.ts', line: 42, offset: 42, limit: 3,
    fileContent: 'const session = getSession()\nconst status = session.status\nexport { status }', input: { path: 'src/session.ts', offset: 42, limit: 3 } },
  search: { ...base, kind: 'search', title: 'Search sessionId', query: 'sessionId', results: [
    { path: 'src/session.ts', line: 18, text: 'const sessionId = session.id' },
    { path: 'src/store.ts', line: 51, text: 'state.sessions.get(sessionId)' },
    { url: 'https://example.invalid/api', title: 'Session API reference', text: 'Session identifiers and lifecycle.' }
  ], input: { pattern: 'sessionId' } },
  edit: { ...base, kind: 'edit', title: 'Update session cache', text: 'Updated two files while preserving the current session.',
    diffs: [{ path: 'src/session.ts', oldText: 'const ready = false\n', newText: 'const ready = true\n' },
      { path: 'src/store.ts', oldText: 'const limit = 1\n', newText: 'const limit = 6\n' }],
    input: { operation: 'edit' }, output: { updated: 2 } },
  terminal: { ...base, kind: 'execute', title: 'Run validation', state: 'failed', command: 'npm test', cwd: '/fixture',
    durationMs: 1542, text: 'Validation completed; inspect the failed test.', error: 'One test failed.',
    terminals: [{ terminalId: 'tests', command: 'npm test', output: '1 failed, 24 passed', exitCode: 1 },
      { terminalId: 'watcher', command: 'node watcher.js', cwd: '/fixture/scripts', output: 'Stopped watcher.', signal: 'SIGTERM' }],
    input: { command: 'npm test' }, output: { exit_code: 1 } },
  fetch: { ...base, kind: 'fetch', title: 'Fetch documentation', url: 'https://example.invalid/docs', statusCode: 200,
    text: 'Documentation loaded. No remote content is executed.', output: { status: 200 } },
  mcp: { ...base, kind: 'mcp', title: 'Search connected documents', server: 'documents', name: 'mcp__documents__search',
    input: { query: 'project notes' }, output: { documents: [{ title: 'Project notes', id: 'doc-1' }] } },
  rich: { ...base, kind: 'other', title: 'Tool resources', content: [
    { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=', name: 'Inline preview' },
    { type: 'resource_link', uri: 'https://example.invalid/report', name: 'Remote report' },
    { type: 'resource', resource: { uri: 'resource://local/report', mimeType: 'text/plain', text: 'Retained resource text.' } },
    { type: 'audio', mimeType: 'audio/wav', data: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=', name: 'Audio evidence' },
    { type: 'resource', mimeType: 'application/octet-stream', data: 'aGVsbG8=', name: 'evidence.bin' },
    { type: 'unknown', omitted: true, originalBytes: 2000000 },
    { type: 'resource_link', uri: 'javascript:window.__toolXss=1', name: 'Untrusted link' }
  ] },
  canceled: { ...base, kind: 'execute', title: 'Stopped command', state: 'canceled', text: 'Stopped by the user.' }
}
let choose: (name: string) => void = () => undefined
const approval: Extract<ChatBlock, { kind: 'approval' }> = { kind: 'approval', id: 'approval-fixture', summary: 'Run the requested command', status: 'pending', toolName: 'acp:execute', action: {
  version: 1, kind: 'command', toolName: 'acp:execute', toolKind: 'command_execution',
  arguments: { rawInput: { command: 'npm test', cwd: '/fixture' } }, workspace: '/fixture',
  targets: [{ kind: 'command', value: 'npm test' }], reason: 'User review required',
  effects: { network: false, externalWrite: false, processExecution: true, guiAutomation: false },
  permissionOptions: [{ optionId: 'once', name: 'Run this time', kind: 'allow_once' },
    { optionId: 'always', name: 'Trust this operation', kind: 'allow_always' },
    { optionId: 'deny', name: 'Skip this operation', kind: 'reject_once' }]
} }
const longApproval: typeof approval = { ...approval, summary: 'Review the requested file updates', toolName: 'acp:edit', action: { ...approval.action!, kind: 'file', toolName: 'acp:edit', toolKind: 'file_change',
  targets: Array.from({ length: 8 }, (_, index) => ({ kind: 'file' as const, value: `src/file-${index}.ts` })),
  effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
  arguments: { changes: Array.from({ length: 8 }, (_, index) => ({ path: `src/file-${index}.ts`, oldText: 'before\n'.repeat(50), newText: 'after\n'.repeat(50) })) },
  permissionOptions: Array.from({ length: 12 }, (_, index) => ({ optionId: `once-${index}`, name: `Review option ${index + 1}`, kind: 'allow_once' }))
} }
function Fixture(): ReactElement {
  const [name, setName] = useState('read')
  choose = setName
  const p = cases[name] ?? cases.read
  const block: ToolBlock = { kind: 'tool', id: name, summary: p.title ?? name,
    status: p.state === 'failed' || p.state === 'canceled' ? 'error' : 'success', meta: { toolPresentation: p } }
  return <main className="tool-fixture">
    <header><strong>Tool presentation</strong><nav>{[...Object.keys(cases), 'approval'].map((key) =>
      <button key={key} onClick={() => setName(key)}>{key}</button>)}</nav></header>
    <section className="tool-fixture-content" data-fixture-case={name}>
      <TimelineFilePreviewWorkspaceProvider workspaceRoot="/fixture" threadId="fixture-thread">
        {name.startsWith('approval') ? <FloatingComposerApprovalPanel approvals={[name === 'approval-long' ? longApproval : approval]} t={language.default.t.bind(language.default)} />
          : <><div className="mb-4 flex flex-wrap items-center gap-3"><h1>{p.title}</h1><ToolStateMeta block={block} /></div><ToolBlockDetails key={name} block={block} /></>}
      </TimelineFilePreviewWorkspaceProvider>
    </section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
Object.assign(window, { __toolXss: 0, toolFixture: { ready: true, cases, actions,
  scenario: (name: string) => choose(name), theme: theme.applyTheme } })
