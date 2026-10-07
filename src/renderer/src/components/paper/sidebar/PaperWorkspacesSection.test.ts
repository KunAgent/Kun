import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { PaperWorkspacesSection } from './PaperWorkspacesSection'
import { PaperTree } from './PaperTree'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperLibraryIndexStore } from '../../../paper/paper-library-index'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.name ? `${key}:${String(opts.name)}` : key
  })
}))

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/lib/CodeLLMPaper'
const OTHER = '/lib/OtherPapers'

function entry(title: string): PaperLibraryEntry {
  return {
    unitDir: `unit-${title}`,
    meta: {
      version: 2,
      slug: `slug-${title}`,
      title,
      authors: [],
      importedAt: '2026-09-01T00:00:00.000Z'
    },
    hasPdf: true,
    hasNotes: false,
    interpretationCount: 0,
    group: ''
  }
}

function seed(libraries: string[], entries: PaperLibraryEntry[]): void {
  const work = useWriteWorkspaceStore.getState()
  useWriteWorkspaceStore.setState({
    workspaceRoot: ROOT,
    paperMode: { ...work.paperMode, libraries },
    activeFilePath: null
  })
  usePaperModeStore.setState({
    entries,
    groups: [],
    counts: {
      total: entries.length,
      unread: entries.length,
      reading: 0,
      read: 0,
      missingPdf: 0
    },
    entriesLoading: false,
    entriesError: null
  })
  usePaperLibraryIndexStore.setState({ byRoot: {}, invalidations: {} })
}

function rootRow(tree: ReactTestRenderer, root: string) {
  return tree.root.find(
    (node) => node.type === 'button' && node.props['data-testid'] === 'paper-workspace-collapse' && node.props['data-workspace-root'] === root
  )
}

function paperRowCount(tree: ReactTestRenderer): number {
  return tree.root.findAll(
    (node) => typeof node.props.onContextMenu === 'function' && node.props.title == null
  ).length
}

describe('PaperWorkspacesSection collapse', () => {
  it('hides the tree with the dedicated collapse button, and restores on second click', async () => {
    seed([ROOT], [entry('OrcaLoca'), entry('Experts Rise')])
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = createRenderer(createElement(PaperWorkspacesSection))
    })
    expect(paperRowCount(tree)).toBe(2)

    await act(async () => {
      rootRow(tree, ROOT).props.onClick()
    })
    expect(paperRowCount(tree)).toBe(0)

    await act(async () => {
      rootRow(tree, ROOT).props.onClick()
    })
    expect(paperRowCount(tree)).toBe(2)
    await act(async () => {
      tree.unmount()
    })
  })

  it('does not show a bogus 0 count for a collapsed library that was never indexed', async () => {
    seed([ROOT, OTHER], [entry('OrcaLoca')])
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = createRenderer(createElement(PaperWorkspacesSection))
    })
    // Flush the (failing in test env) lazy index scan for OTHER.
    await act(async () => undefined)
    // Collapse OTHER before any index data exists for it.
    await act(async () => {
      rootRow(tree, OTHER).props.onClick()
    })
    const badge = rootRow(tree, OTHER)
      .findAll((node) => node.type === 'span')
      .map((node) => node.children.map((child) => (typeof child === 'string' ? child : '')).join(''))
      .filter((text) => text.trim().length > 0)
    expect(badge).not.toContain('0')
    await act(async () => {
      tree.unmount()
    })
  })

  it('uses native keyboard buttons and never nests interactive workspace controls', async () => {
    seed([ROOT], [entry('OrcaLoca')])
    let tree!: ReactTestRenderer
    await act(async () => {
      tree = createRenderer(createElement(PaperWorkspacesSection))
    })
    expect(rootRow(tree, ROOT).props['aria-expanded']).toBe(true)
    const switchButton = tree.root.find((node) => node.type === 'button' && node.props['data-testid'] === 'paper-workspace-switch')
    expect(switchButton.props['aria-current']).toBe('true')
    expect(switchButton.findAll((node) => node !== switchButton && node.type === 'button')).toHaveLength(0)
    expect(tree.root.findAll((node) => node.props.role === 'button' && node.props.title === ROOT)).toHaveLength(0)
    await act(async () => tree.unmount())
  })

  it('keeps folder rows collapsible while filtering without touching persisted folds', async () => {
    seed([ROOT], [])
    const grouped = [
      { ...entry('OrcaLoca'), group: 'Papers' },
      { ...entry('Experts Rise'), group: 'Papers' }
    ]
    let tree!: ReactTestRenderer
    const renderTree = (filter: string) =>
      createElement(PaperTree, {
        libraryRoot: ROOT,
        entries: grouped,
        groups: ['Papers'],
        filter
      })
    await act(async () => {
      tree = createRenderer(renderTree('orca'))
    })
    // Only the matching row is visible.
    expect(paperRowCount(tree)).toBe(1)

    const groupRow = () =>
      tree.root.find((node) => node.type === 'button' && node.props.title === 'Papers')
    await act(async () => {
      groupRow().props.onClick()
    })
    expect(paperRowCount(tree)).toBe(0)

    // Filter-session folds do not leak into the persisted collapse state.
    await act(async () => {
      tree.update(renderTree(''))
    })
    expect(paperRowCount(tree)).toBe(2)
    await act(async () => {
      tree.unmount()
    })
  })
})
