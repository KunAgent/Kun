// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { useIsApprovalDocked } from './approval-dock-registry'
import { FloatingComposerApprovalPanel } from './FloatingComposerApprovalPanel'
import { clearApprovalDenyNotes, readApprovalDenyNote } from './interrupt-card/approval-deny-note-memory'
import { INTERRUPT_ARM_DELAY_MS } from './interrupt-card/interrupt-arming'

// jsdom events are never trusted; `trust.scriptedOnly` restores the real rule.
const trust = vi.hoisted(() => ({ scriptedOnly: false }))
vi.mock('../../extensions/protected-user-activation', () => ({
  runTrustedUserActivation: (event: { isTrusted: boolean }, action: () => void): boolean => {
    if (trust.scriptedOnly && event.isTrusted !== true) return false
    action()
    return true
  }
}))
const sendApprovalDenyNote = vi.hoisted(() => vi.fn(async (_note: string) => undefined))
vi.mock('./approval-deny-note', () => ({ sendApprovalDenyNote }))

type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

const command: ApprovalBlock = {
  kind: 'approval', id: 'appr-cmd', approvalId: 'appr_cmd', status: 'pending', toolName: 'acp:execute',
  summary: 'npm test',
  action: {
    kind: 'command', toolName: 'acp:execute', workspace: '/w', cwd: '/w',
    arguments: { rawInput: { command: 'npm test', description: 'Run the unit tests' } },
    targets: [{ kind: 'command', value: 'npm test' }],
    permissionOptions: [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'always', name: 'Always Allow `npm test:*`', kind: 'allow_always' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' }
    ]
  }
}
const edit: ApprovalBlock = {
  kind: 'approval', id: 'appr-edit', approvalId: 'appr_edit', status: 'pending', toolName: 'edit',
  summary: 'edit a.ts',
  action: { kind: 'file', toolName: 'edit', workspace: '/w', arguments: { path: '/w/a.ts', oldText: 'a\n', newText: 'b\n' } }
}

const shell: ApprovalBlock = {
  kind: 'approval', id: 'appr-shell', approvalId: 'appr_shell', status: 'pending', toolName: 'shell',
  summary: 'npm run deploy',
  action: {
    kind: 'command', toolName: 'shell', workspace: '/w', cwd: '/w',
    arguments: { command: 'npm run deploy', run_in_background: true, timeout: 600000, with_escalated_permissions: true, justification: 'needs network' },
    targets: [{ kind: 'command', value: 'npm run deploy' }]
  }
}

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { lng: 'en', ...options })
const resolveApproval = vi.fn(async (_id: string, _decision: 'allow' | 'deny', _choice?: unknown) => undefined)
const interrupt = vi.fn(async () => undefined)

function DockProbe({ id }: { id: string }): ReactElement {
  return createElement('output', { 'data-docked': useIsApprovalDocked(id) ? 'yes' : 'no' })
}

describe('approval card markup', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the interrupt card with numbered choices, the preview and the note row', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, { approvals: [command, edit], t }))
    expect(html).toMatch(/^<section/)
    expect(html).toContain('data-composer-stack-item="approval"')
    expect(html).toContain('data-approval-kind="command"')
    expect(html).toContain('Needs your approval')
    expect(html).toContain('Run command')
    expect(html).toContain('1 / 2')
    expect(html).toContain('Run the unit tests')
    expect(html).toContain('data-approval-evidence-scroll')
    expect(html).toContain('Awaiting approval')
    expect(html).toContain('npm test')
    for (const choice of ['1', '2', '3']) expect(html).toContain(`data-approval-choice="${choice}"`)
    expect(html).not.toContain('data-approval-choice="4"')
    expect(html).toContain('Only this time')
    expect(html).toContain('<code class="rounded-[5px] bg-ds-hover px-[5px] py-px font-mono text-[12px] text-ds-ink">npm test …</code>')
    expect(html).toContain('Tell Kun what to do instead — sent with the denial…')
    expect(html).toContain('Press 1–3 to choose, or ↑↓ then Enter')
    expect(html).toContain('Stop this turn')
    expect(html).toContain('>Confirm</button>')
  })

  it('shows the edit diff, the error and the submitting state', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, {
      approvals: [{ ...edit, status: 'submitting', errorMessage: 'Runtime unavailable' }], t, variant: 'compact'
    }))
    expect(html).toContain('data-compact="true"')
    expect(html).toContain('data-approval-kind="edit"')
    expect(html).toContain('Edit a.ts?')
    expect(html).toContain('data-diff-row="remove"')
    expect(html).toContain('data-diff-row="add"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Runtime unavailable')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    // Two rows without runtime options: allow once, deny.
    expect(html).toContain('Press 1–2 to choose')
  })

  it('keeps a command or edit without hidden arguments free of the toggle', () => {
    const html = renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, { approvals: [command], t }))
    expect(html).not.toContain('data-approval-expand')
    expect(renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, { approvals: [edit], t }))).not.toContain('data-approval-expand')
  })

  it('caps the digit hint at 9 when the runtime offers more options', () => {
    const many: ApprovalBlock = { ...command, action: { ...command.action!, permissionOptions: Array.from({ length: 11 }, (_, index) => ({
      optionId: `once-${index}`, name: `Review option ${index + 1}`, kind: 'allow_once' as const
    })) } }
    const html = renderToStaticMarkup(createElement(FloatingComposerApprovalPanel, { approvals: [many], t }))
    expect(html).toContain('data-approval-choice="12"')
    expect(html).toContain('Press 1–9 to choose')
  })
})

describe('approval card decisions', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    trust.scriptedOnly = false
    resolveApproval.mockClear(); interrupt.mockClear(); sendApprovalDenyNote.mockClear()
    clearApprovalDenyNotes()
    useChatStore.setState({ resolveApproval, interrupt } as never)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(80_000)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (approvals: ApprovalBlock[]): Promise<void> => {
    await act(async () => root.render(createElement('div', { 'data-floating-composer': true },
      createElement(FloatingComposerApprovalPanel, { approvals, t }),
      createElement(DockProbe, { id: command.id }))))
  }
  const arm = (): void => {
    vi.setSystemTime(80_000 + INTERRUPT_ARM_DELAY_MS + 1)
  }
  const el = <T extends Element = HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const press = async (target: Element, init: KeyboardEventInit): Promise<void> => {
    await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
  }
  const type = async (value: string): Promise<void> => {
    const area = el<HTMLTextAreaElement>('textarea')
    await act(async () => {
      area.focus()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value)
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('decides with digit keys only once armed, never on key repeat', async () => {
    await render([command])
    expect(document.activeElement).toBe(el('[role="listbox"]'))
    await press(el('[role="listbox"]'), { key: '2' })
    expect(resolveApproval).not.toHaveBeenCalled()
    arm()
    await press(el('[role="listbox"]'), { key: '2', repeat: true })
    expect(resolveApproval).not.toHaveBeenCalled()
    await press(el('[role="listbox"]'), { key: '2' })
    expect(resolveApproval).toHaveBeenCalledWith('appr-cmd', 'allow', { optionId: 'always' })
  })

  it('moves with arrows and confirms the active row with Enter or the primary button', async () => {
    await render([command])
    arm()
    await press(el('[role="listbox"]'), { key: 'ArrowDown' })
    await press(el('[role="listbox"]'), { key: 'ArrowDown' })
    expect(el('[data-approval-choice="3"]').getAttribute('aria-selected')).toBe('true')
    await press(el('[role="listbox"]'), { key: 'Enter' })
    expect(resolveApproval).toHaveBeenLastCalledWith('appr-cmd', 'deny', { optionId: 'no' })

    await press(el('[role="listbox"]'), { key: 'ArrowUp' })
    await act(async () => el<HTMLButtonElement>('[data-approval-confirm]').click())
    expect(resolveApproval).toHaveBeenLastCalledWith('appr-cmd', 'allow', { optionId: 'always' })
  })

  it('sends the typed note with a denial from the note row and remembers it for the record', async () => {
    await render([command])
    arm()
    await press(el('[role="listbox"]'), { key: '4' })
    expect(document.activeElement).toBe(el('textarea'))
    expect(resolveApproval).not.toHaveBeenCalled()
    await type('  Only run the auth tests  ')
    await press(el('textarea'), { key: 'Enter' })
    expect(resolveApproval).toHaveBeenCalledWith('appr-cmd', 'deny', { optionId: 'no' })
    expect(readApprovalDenyNote('appr-cmd')).toBe('Only run the auth tests')
    await act(async () => { await Promise.resolve() })
    expect(sendApprovalDenyNote).toHaveBeenCalledWith('Only run the auth tests')
  })

  it('treats a whitespace-only note as a plain denial and keeps notes off allow decisions', async () => {
    await render([command])
    arm()
    await type('   ')
    await press(el('textarea'), { key: 'Enter' })
    expect(resolveApproval).toHaveBeenLastCalledWith('appr-cmd', 'deny', { optionId: 'no' })
    expect(readApprovalDenyNote('appr-cmd')).toBeNull()

    await type('try again later')
    await act(async () => el<HTMLButtonElement>('[data-approval-choice="1"]').click())
    expect(resolveApproval).toHaveBeenLastCalledWith('appr-cmd', 'allow', { optionId: 'once' })
    await act(async () => { await Promise.resolve() })
    expect(sendApprovalDenyNote).not.toHaveBeenCalled()

    await act(async () => el<HTMLButtonElement>('[data-approval-choice="3"]').click())
    expect(resolveApproval).toHaveBeenLastCalledWith('appr-cmd', 'deny', { optionId: 'no' })
    expect(readApprovalDenyNote('appr-cmd')).toBe('try again later')
  })

  it('refuses scripted clicks and keys: decisions need a trusted user activation', async () => {
    trust.scriptedOnly = true
    await render([command])
    arm()
    await act(async () => el<HTMLButtonElement>('[data-approval-choice="1"]').click())
    await press(el('[role="listbox"]'), { key: '1' })
    await act(async () => el<HTMLButtonElement>('[data-approval-confirm]').click())
    expect(resolveApproval).not.toHaveBeenCalled()
  })

  it('pre-selects allow once even when the runtime lists always allow first', async () => {
    const [once, always, reject] = command.action!.permissionOptions!
    await render([{ ...command, action: { ...command.action!, permissionOptions: [always, reject, once] } }])
    arm()
    expect(el('[data-approval-choice="1"]').getAttribute('aria-selected')).toBe('true')
    expect(el('[data-approval-choice="1"]').textContent).toContain('Only this time')
    await press(el('[role="listbox"]'), { key: 'Enter' })
    expect(resolveApproval).toHaveBeenCalledWith('appr-cmd', 'allow', { optionId: 'once' })
  })

  it('expands a command to the arguments its preview hides and the full input', async () => {
    await render([shell])
    const toggle = el<HTMLButtonElement>('[data-approval-expand]')
    expect(toggle.textContent).toBe('4 more arguments')
    expect(host.querySelector('[data-testid="approval-tool-details"]')).toBeNull()
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const extra = el('[data-approval-extra-input]').textContent
    for (const key of ['run_in_background', 'timeout', 'with_escalated_permissions', 'justification']) expect(extra).toContain(key)
    const details = el('[data-testid="approval-tool-details"]')
    expect(details.textContent).toContain('Input')
    // The terminal box above already shows the command.
    expect(details.textContent).not.toContain('$ npm run deploy')
  })

  it('pages between pending approvals, stops the turn and tracks docked ids', async () => {
    await render([command, edit])
    expect(el('[data-docked]').getAttribute('data-docked')).toBe('yes')
    arm()
    await act(async () => el<HTMLButtonElement>('button[aria-label="Next"]').click())
    expect(el('[data-composer-stack-item="approval"]').getAttribute('data-approval-kind')).toBe('edit')
    // The next request re-arms the card before its buttons count.
    await act(async () => el<HTMLButtonElement>('[data-variant="ghost"]').click())
    expect(interrupt).not.toHaveBeenCalled()
    vi.setSystemTime(80_000 + 2 * INTERRUPT_ARM_DELAY_MS + 2)
    await act(async () => el<HTMLButtonElement>('[data-variant="ghost"]').click())
    expect(interrupt).toHaveBeenCalledOnce()

    await render([edit])
    expect(el('[data-docked]').getAttribute('data-docked')).toBe('no')
  })
})
