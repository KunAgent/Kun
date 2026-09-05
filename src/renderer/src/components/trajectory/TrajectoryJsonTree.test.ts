import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrajectoryJsonTree } from './TrajectoryJsonTree'

describe('TrajectoryJsonTree', () => {
  let renderer: ReactTestRenderer
  const writeText = vi.fn(async (_value: string) => undefined)

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    writeText.mockClear()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await act(async () => {
      renderer = create(createElement(TrajectoryJsonTree, {
        value: { alpha: { beta: 1 }, 'a.b': 'literal', items: [true] }
      }))
    })
  })

  it('opens only the root and exposes typed compact rows', () => {
    expect(paths(renderer)).toEqual(['$', '$.alpha', '$["a.b"]', '$.items'])
    expect(row(renderer, '$').props['aria-expanded']).toBe(true)
    expect(row(renderer, '$.alpha').props['aria-expanded']).toBe(false)
    expect(row(renderer, '$["a.b"]').props['data-type']).toBe('string')
  })

  it('folds with the key label and supports tree arrow navigation', async () => {
    await act(async () => {
      nodeButton(row(renderer, '$.alpha')).props.onClick()
    })
    expect(paths(renderer)).toContain('$.alpha.beta')

    const preventDefault = vi.fn()
    await act(async () => {
      row(renderer, '$.alpha').props.onKeyDown({ key: 'ArrowRight', preventDefault })
    })
    expect(row(renderer, '$.alpha.beta').props.tabIndex).toBe(0)
    await act(async () => {
      row(renderer, '$.alpha.beta').props.onKeyDown({ key: 'ArrowLeft', preventDefault })
    })
    expect(row(renderer, '$.alpha').props.tabIndex).toBe(0)
    expect(preventDefault).toHaveBeenCalled()
  })

  it('copies primitive values, formatted JSON, and escaped JSON paths', async () => {
    const literal = row(renderer, '$["a.b"]')
    const actions = literal.findAllByType('button').slice(-3)
    await act(async () => { await actions[0]!.props.onClick({ stopPropagation: vi.fn() }) })
    await act(async () => { await actions[1]!.props.onClick({ stopPropagation: vi.fn() }) })
    await act(async () => { await actions[2]!.props.onClick({ stopPropagation: vi.fn() }) })
    expect(writeText.mock.calls.map(([value]) => value)).toEqual([
      'literal',
      '"literal"',
      '$["a.b"]'
    ])
  })

  it('does not expose a dead expander for empty containers and reports copy failure', async () => {
    let emptyRenderer: ReactTestRenderer
    await act(async () => { emptyRenderer = create(createElement(TrajectoryJsonTree, { value: { empty: {} } })) })
    const empty = row(emptyRenderer!, '$.empty')
    expect(empty.props['aria-expanded']).toBeUndefined()
    expect(empty.findAllByType('button').some((button) => button.props.tabIndex === -1)).toBe(false)

    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    const literal = row(renderer, '$["a.b"]')
    const copyValue = literal.findAllByType('button').slice(-3)[0]!
    await act(async () => { await copyValue.props.onClick({ stopPropagation: vi.fn() }) })
    expect(literal.findAllByType('span').some((entry) => entry.children.join('') === '!')).toBe(true)
  })
})

function paths(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByProps({ role: 'treeitem' }).map((entry) => entry.props['data-path'])
}

function row(renderer: ReactTestRenderer, path: string): ReactTestInstance {
  return renderer.root.findAllByProps({ role: 'treeitem' }).find((entry) => entry.props['data-path'] === path)!
}

function nodeButton(entry: ReactTestInstance): ReactTestInstance {
  return entry.findAllByType('button').find((button) => button.props.tabIndex === -1)!
}
