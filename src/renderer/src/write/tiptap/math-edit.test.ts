// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { openMathEditor, preserveMathPointerTarget } from './math-edit'

afterEach(() => { document.body.replaceChildren() })

function fixture(kind: 'block' | 'inline') {
  const host = document.createElement('div')
  const dom = document.createElement('div')
  host.append(dom)
  document.body.append(host)
  const commands = {
    updateBlockMath: vi.fn(),
    updateInlineMath: vi.fn(),
    focus: vi.fn()
  }
  const editor = {
    isEditable: true,
    view: { dom, coordsAtPos: () => ({ left: 0, bottom: 20 }) },
    state: { doc: { content: { size: 20 } } },
    commands
  } as unknown as Editor
  openMathEditor(editor, { attrs: { latex: 'x^2' } } as unknown as PmNode, 4, kind)
  const input = host.querySelector('textarea')!
  return { commands, input, host }
}

describe.each(['block', 'inline'] as const)('%s math editing', (kind) => {
  it('saves to the intended node through the current Tiptap command contract', () => {
    const { commands, input, host } = fixture(kind)
    input.value = '\\frac{a}{b}'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    const save = kind === 'block' ? commands.updateBlockMath : commands.updateInlineMath
    expect(save).toHaveBeenCalledExactlyOnceWith({ pos: 4, latex: '\\frac{a}{b}' })
    expect(host.querySelector('.write-math-overlay')).toBeNull()
    input.dispatchEvent(new Event('blur'))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves once when focus leaves the editor', () => {
    const { commands, input } = fixture(kind)
    input.value = 'y^3'
    input.dispatchEvent(new Event('blur'))
    const save = kind === 'block' ? commands.updateBlockMath : commands.updateInlineMath
    expect(save).toHaveBeenCalledExactlyOnceWith({ pos: 4, latex: 'y^3' })
  })

  it('cancels without allowing the ensuing blur to save', () => {
    const { commands, input, host } = fixture(kind)
    input.value = 'discarded'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    input.dispatchEvent(new Event('blur'))
    expect(commands.updateBlockMath).not.toHaveBeenCalled()
    expect(commands.updateInlineMath).not.toHaveBeenCalled()
    expect(commands.focus).toHaveBeenCalledOnce()
    expect(host.querySelector('.write-math-overlay')).toBeNull()
  })
})

describe('math pointer focus', () => {
  function pointer(targetSelector: string, options: MouseEventInit = {}, editable = true) {
    const root = document.createElement('div')
    root.innerHTML = '<p>Other text</p><span data-type="inline-math"><span class="katex-display"><span class="katex-html"><span class="mord">x</span></span></span></span>'
    document.body.append(root)
    let handled = false
    root.addEventListener('mousedown', (event) => {
      handled = preserveMathPointerTarget(event, root, editable)
    })
    const event = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true, ...options })
    root.querySelector(targetSelector)!.dispatchEvent(event)
    return { event, handled }
  }

  it('prevents an editable glyph from being selected and scrolled before its click', () => {
    const { event, handled } = pointer('.mord')
    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
  })

  it('preserves scrollbar, ordinary text, modified and read-only pointer behavior', () => {
    for (const result of [
      pointer('.katex-display'),
      pointer('p'),
      pointer('.mord', { button: 2 }),
      pointer('.mord', { ctrlKey: true }),
      pointer('.mord', {}, false)
    ]) {
      expect(result.handled).toBe(false)
      expect(result.event.defaultPrevented).toBe(false)
    }
  })
})
