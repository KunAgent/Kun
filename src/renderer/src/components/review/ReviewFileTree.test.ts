import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import '../../i18n'
import { ReviewFileTree } from './ReviewFileTree'

const files = [
  { path: 'src/a/one.ts', status: 'modified' as const, insertions: 3, deletions: 1, binary: false, tooLarge: false },
  { path: 'src/a/two.ts', status: 'added' as const, insertions: 10, deletions: 0, binary: false, tooLarge: false },
  { path: 'README.md', status: 'deleted' as const, insertions: 0, deletions: 5, binary: false, tooLarge: false }
]

async function renderTree(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(ReviewFileTree, { files }))
  })
  return renderer
}

describe('ReviewFileTree', () => {
  it('groups files into collapsible directories with stat counts', async () => {
    const renderer = await renderTree()
    const texts = renderer.root.findAll((n) => typeof n.children[0] === 'string')
    const joined = texts.map((n) => n.children.join('')).join(' ')
    expect(joined).toContain('one.ts')
    expect(joined).toContain('two.ts')
    expect(joined).toContain('README.md')
    expect(joined).toContain('+3')
    expect(joined).toContain('−1')
    expect(joined).toContain('src')
    expect(joined).toContain('a')
  })

  it('collapses a directory on click', async () => {
    const renderer = await renderTree()
    const dirButton = renderer.root.findAllByType('button' as never)
      .find((b) => b.findAll((n) => n.children[0] === 'src').length > 0)
    expect(dirButton).toBeTruthy()
    await act(async () => dirButton!.props.onClick())
    const texts = renderer.root.findAll((n) => typeof n.children[0] === 'string')
      .map((n) => n.children.join('')).join(' ')
    expect(texts).not.toContain('one.ts')
    expect(texts).toContain('README.md')
  })
})
