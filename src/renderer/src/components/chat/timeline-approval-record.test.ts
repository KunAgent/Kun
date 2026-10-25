import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { setDockedApprovalIds } from './approval-dock-registry'
import { clearApprovalDenyNotes, rememberApprovalDenyNote } from './interrupt-card/approval-deny-note-memory'
import { TimelineApprovalCard } from './TimelineApprovalCard'
import { approvalRecordLabelKey, approvalRecordSubject } from './timeline-approval-record'

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

const command = { kind: 'command' as const, arguments: { command: 'npm run build' }, targets: [{ kind: 'command', value: 'npm run build' }] }
const fileEdit = { kind: 'file' as const, toolName: 'edit', arguments: { path: 'src/main/index.ts' }, targets: [{ kind: 'file', value: 'src/main/index.ts' }] }

function approval(overrides: Partial<ApprovalBlock>): ApprovalBlock {
  return { kind: 'approval', id: 'approval_1', approvalId: 'a_1', status: 'allowed', summary: 'Run npm run build', action: command, ...overrides }
}

function render(block: ApprovalBlock, allowThreadActions = true): string {
  return renderToStaticMarkup(createElement(TimelineApprovalCard, { block, allowThreadActions }))
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')
}

/** Client render, so the settled line's disclosure can be clicked. */
function mount(block: ApprovalBlock): {
  renderer: ReactTestRenderer
  toggle: () => ReactTestInstance
  details: () => ReactTestInstance[]
} {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(TimelineApprovalCard, { block, allowThreadActions: true }))
  })
  const mounted = renderer as unknown as ReactTestRenderer
  return {
    renderer: mounted,
    toggle: () => mounted.root.find((node) => node.type === 'button' && 'aria-expanded' in node.props),
    details: () => mounted.root.findAll((node) => node.type === 'div' && 'data-approval-record-detail' in node.props)
  }
}

describe('approval timeline record', () => {
  beforeAll(async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('zh')
  })

  afterEach(() => {
    setDockedApprovalIds([])
    clearApprovalDenyNotes()
  })

  it('names what was approved for the chip', () => {
    expect(approvalRecordSubject({ action: command })).toEqual({ topic: 'command', target: 'npm run build' })
    expect(approvalRecordSubject({ action: fileEdit, toolName: 'edit' })).toEqual({ topic: 'file', target: 'src/main/index.ts' })
    expect(approvalRecordSubject({ toolName: 'write', action: { arguments: { file_path: 'README.md' } } }))
      .toEqual({ topic: 'file', target: 'README.md' })
    expect(approvalRecordSubject({
      action: {
        kind: 'external-effect',
        toolName: 'gmail_send',
        arguments: { to: ['pat@example.com'], subject: 'Weekly report', body: 'Hi' }
      }
    })).toEqual({ topic: 'email', target: 'Weekly report' })
    expect(approvalRecordSubject({ toolName: 'mcp__search', action: { kind: 'mcp' } })).toEqual({ topic: 'other', target: 'mcp__search' })
  })

  it('shortens absolute file targets like the approval card, keeping the raw path for the tooltip', () => {
    const workspace = '/Users/me/kun'
    const inside = '/Users/me/kun/src/main/services/session-store.ts'
    expect(approvalRecordSubject({ toolName: 'write', action: { kind: 'file', workspace, targets: [{ kind: 'file', value: inside }] } }))
      .toEqual({ topic: 'file', target: 'src/main/services/session-store.ts', fullTarget: inside })
    const outside = '/Users/me/Library/Kun/settings.json'
    expect(approvalRecordSubject({ toolName: 'write', action: { kind: 'file', workspace, arguments: { path: outside } } }))
      .toEqual({ topic: 'file', target: '~/Library/Kun/settings.json', fullTarget: outside })
    const html = render(approval({ toolName: 'write', action: { kind: 'file', workspace, targets: [{ kind: 'file', value: inside }] } }))
    // Paths are cut from the start, so the file name survives a narrow line.
    expect(html).toContain(`data-truncate="start" title="${inside}"><bdi dir="ltr">src/main/services/session-store.ts</bdi>`)
  })

  it('picks the leading label by status and topic', () => {
    expect(approvalRecordLabelKey('allowed', 'command')).toBe('composerRecords.allowedRun')
    expect(approvalRecordLabelKey('allowed', 'file')).toBe('composerRecords.allowedEdit')
    expect(approvalRecordLabelKey('denied', 'other')).toBe('composerRecords.denied')
    expect(approvalRecordLabelKey('expired', 'command')).toBe('composerRecords.expired')
    expect(approvalRecordLabelKey('error', 'email')).toBe('composerRecords.failed')
  })

  it('collapses an allowed request to one line with the command chip, evidence closed', () => {
    const html = render(approval({}))
    expect(html).toContain('data-approval-record="allowed"')
    expect(html).toContain('已允许运行')
    expect(html).toContain('>npm run build</span>')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Run npm run build')
    expect(html).not.toContain('data-testid="approval-actions"')
  })

  it('adds the deny note to a denied record only when one was remembered', () => {
    const denied = approval({ status: 'denied', toolName: 'edit', action: fileEdit })
    const bare = render(denied)
    expect(bare).toContain('已拒绝修改')
    expect(bare).toContain('>src/main/index.ts</bdi>')
    expect(bare).not.toContain('附言')
    rememberApprovalDenyNote('approval_1', '先别动主进程')
    // The note yields to the chip: what was denied is cut last.
    expect(render(denied)).toContain('data-yield="true" title="先别动主进程">· 附言：先别动主进程</span>')
  })

  it('shows a failed request as a danger line with its error', () => {
    const html = render(approval({ status: 'error', errorMessage: 'approval not found' }))
    expect(html).toContain('data-tone="danger"')
    expect(html).toContain('审批没有送达')
    expect(html).toContain('data-yield="true" title="approval not found">approval not found</span>')
  })

  it('points at the card below while the composer docks the pending request', () => {
    setDockedApprovalIds(['approval_1'])
    const html = render(approval({ status: 'pending' }))
    expect(html).toContain('data-testid="approval-docked-pointer"')
    expect(html).toContain('等待你的批准')
    expect(html).toContain('在下方处理')
    expect(html).not.toContain('data-testid="approval-actions"')
  })

  it('keeps evidence and numbered decision rows for a pending request nobody docks', () => {
    const html = render(approval({ status: 'pending' }))
    expect(html).toContain('data-approval-record="pending"')
    expect(html).toContain('Run npm run build')
    expect(html).toContain('data-layout="rows"')
    expect(html).toContain('data-approval-action-row="1"')
    // Read-only transcripts keep the evidence without any decision control.
    const readOnly = render(approval({ status: 'pending' }), false)
    expect(readOnly).not.toContain('data-testid="approval-actions"')
    expect(readOnly).toContain('等待你选择…')
  })

  it('never shows the pointer for a docked request in a read-only transcript', () => {
    setDockedApprovalIds(['approval_1'])
    expect(render(approval({ status: 'pending' }), false)).not.toContain('approval-docked-pointer')
  })
})

describe('approval timeline record evidence disclosure', () => {
  beforeAll(async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('zh')
  })

  let mounted: ReactTestRenderer | null = null

  afterEach(() => {
    if (mounted) act(() => mounted?.unmount())
    mounted = null
    clearApprovalDenyNotes()
    vi.unstubAllGlobals()
  })

  function open(block: ApprovalBlock): ReturnType<typeof mount> {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // Tool evidence defers syntax highlighting on a window timer; the test
    // only reads the structure, so the timer never needs to fire.
    vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => undefined })
    const view = mount(block)
    mounted = view.renderer
    expect(view.toggle().props['aria-expanded']).toBe(false)
    expect(view.toggle().props['aria-controls']).toBeUndefined()
    expect(view.details()).toHaveLength(0)
    act(() => view.toggle().props.onClick())
    return view
  }

  it('opens the summary and tool details of a settled request, and closes them again', () => {
    const view = open(approval({}))
    const toggle = view.toggle()
    const [detail] = view.details()
    expect(toggle.props['aria-expanded']).toBe(true)
    expect(detail).toBeDefined()
    expect(toggle.props['aria-controls']).toBe(detail!.props.id)
    expect(textOf(detail!)).toContain('Run npm run build')
    expect(detail!.findAll((node) => node.props['data-testid'] === 'approval-tool-details').length).toBeGreaterThan(0)
    act(() => view.toggle().props.onClick())
    expect(view.toggle().props['aria-expanded']).toBe(false)
    expect(view.toggle().props['aria-controls']).toBeUndefined()
    expect(view.details()).toHaveLength(0)
  })

  it('opens the mail preview of an email request instead of tool details', () => {
    const view = open(approval({
      toolName: 'gmail_send',
      action: { kind: 'external-effect', toolName: 'gmail_send', arguments: { to: ['pat@example.com'], subject: 'Weekly report', body: 'Hi Pat' } }
    }))
    const [detail] = view.details()
    expect(detail!.findAll((node) => node.props['data-testid'] === 'approval-email-preview').length).toBeGreaterThan(0)
    expect(detail!.findAll((node) => node.props['data-testid'] === 'approval-tool-details')).toHaveLength(0)
    expect(textOf(detail!)).toContain('Weekly report')
  })

  it('keeps the memory body, the deny note and the error one click away', () => {
    rememberApprovalDenyNote('approval_1', '先别写这条记忆')
    const denied = open(approval({
      status: 'denied',
      toolName: 'memory_create',
      summary: 'Create memory',
      errorMessage: 'runtime rejected the late decision',
      action: { kind: 'unknown', toolName: 'memory_create', arguments: { content: 'Always run pnpm install first', authority: 'directive' } }
    }))
    const text = textOf(denied.details()[0]!)
    expect(text).toContain('Create memory')
    expect(text).toContain('Always run pnpm install first')
    expect(text).toContain('附言：先别写这条记忆')
    expect(text).toContain('runtime rejected the late decision')
  })
})
