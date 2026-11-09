/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { useFloatingComposerActions } from './use-floating-composer-actions'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'

let tree: ReactTestRenderer | undefined
afterEach(() => { if (tree) act(() => tree!.unmount()) })

describe('paper composer commands', () => {
  it.each(['/goal pause', '/goal clear', '/compact', '/archive', '/fork'])('routes %s only through the paper-owned send', (input) => {
    const onSend = vi.fn(), push = vi.fn(), setInput = vi.fn()
    const goal = vi.fn(), compact = vi.fn(), fork = vi.fn(), archive = vi.fn()
    let actions: FloatingComposerRenderContext
    const context = {
      route: 'papers', input, queuedMessages: [], busy: false, effectiveWorkspaceRoot: '/source',
      dictationPrimaryActionRef: { current: null }, primaryActionDisabled: false,
      draft: { textareaRef: { current: null } }, composerRootRef: { current: null },
      inputHistory: { push }, onSend, setInput,
      setActiveThreadGoal: goal, setActiveThreadGoalStatus: goal, clearActiveThreadGoal: goal,
      compactActiveThread: compact, forkActiveThread: fork, archiveThread: archive
    } as unknown as FloatingComposerRenderContext
    function Harness() { actions = useFloatingComposerActions(context); return createElement('div') }
    act(() => { tree = create(createElement(Harness)) })
    act(() => actions.handlePrimaryAction())
    expect(onSend).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith(input)
    expect(setInput).not.toHaveBeenCalled()
    for (const mutate of [goal, compact, fork, archive]) expect(mutate).not.toHaveBeenCalled()
    act(() => actions.applySlashCommand('archive'))
    expect(archive).not.toHaveBeenCalled()
  })
})
