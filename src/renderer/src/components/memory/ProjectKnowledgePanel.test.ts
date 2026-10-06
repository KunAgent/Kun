import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { CoreMemoryRecordJson } from '../../agent/kun-contract'
import { buildProjectKnowledgeMarkdown, previewProjectKnowledgeExport } from '@shared/project-memory-interoperability'
import { ProjectKnowledgePanel } from './ProjectKnowledgePanel'

const record: CoreMemoryRecordJson = { id: 'project-1', revision: 2, content: 'Use npm test.', scope: 'project', project: '/repo',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
describe('project snapshot explicit review interactions', () => {
  let renderer: ReactTestRenderer
  const createMemory = vi.fn(), updateMemory = vi.fn(), save = vi.fn()
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('window', { kunGui: { exportMemoryMarkdown: save } })
    vi.clearAllMocks(); await i18n.changeLanguage('en'); createMemory.mockResolvedValue(true); updateMemory.mockResolvedValue(true)
    save.mockResolvedValue({ ok: false, canceled: true })
    await act(async () => { renderer = create(createElement(ProjectKnowledgePanel, { records: [record], create: createMemory, update: updateMemory })) })
    act(() => renderer.root.findByProps({ 'aria-label': 'Exact project path' }).props.onChange({ target: { value: '/repo' } }))
  })
  afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('keeps the labelled project path linked to a native datalist without overriding its combobox semantics', () => {
    const input = renderer.root.findByProps({ 'aria-label': 'Exact project path' })
    expect(input.type).toBe('input')
    expect(input.props.role).toBeUndefined()
    const list = renderer.root.findByType('datalist')
    expect(input.props.list).toBe(list.props.id)
    expect(list.findAllByType('option').map((option) => option.props.value)).toEqual(['/repo'])
  })
  it('starts empty and requires selection plus preview, with cancel/reopen preserving no approval', async () => {
    act(() => button('Review preview').props.onClick())
    expect(button('Save approved snapshot…').props.disabled).toBe(true)
    expect(renderer.root.findAllByType('p').some((node) => node.children.includes('Empty preview. Select at least one project record before saving.'))).toBe(true)
    act(() => renderer.root.findByProps({ type: 'checkbox' }).props.onChange())
    expect(button('Save approved snapshot…')).toBeUndefined()
    act(() => button('Review preview').props.onClick())
    act(() => button('Cancel').props.onClick())
    expect(save).not.toHaveBeenCalled()
    act(() => button('Review preview').props.onClick())
    let finish!: (value: unknown) => void
    save.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const approve = button('Save approved snapshot…').props.onClick
    act(() => { approve(); approve() })
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ projectKnowledge: { project: '/repo', approvedIds: ['project-1'] } }))
    await act(async () => finish({ ok: false, canceled: true }))
    expect(button('Save approved snapshot…')).toBeDefined()
  })
  it('invalidates a preview when the destination changes and rejects a mismatched import', () => {
    act(() => button('Import snapshot').props.onClick())
    const markdown = buildProjectKnowledgeMarkdown(previewProjectKnowledgeExport([record], { project: '/repo', approvedIds: [record.id] }))
    act(() => renderer.root.findByProps({ 'aria-label': 'Paste project Markdown snapshot' }).props.onChange({ target: { value: markdown } }))
    act(() => button('Review preview').props.onClick())
    expect(button('Import reviewed references')).toBeDefined()
    act(() => renderer.root.findByProps({ 'aria-label': 'Exact project path' }).props.onChange({ target: { value: '/other' } }))
    expect(button('Import reviewed references')).toBeUndefined()
    act(() => button('Review preview').props.onClick())
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('different project')
    expect(createMemory).not.toHaveBeenCalled(); expect(updateMemory).not.toHaveBeenCalled()
  })
  it('imports changed existing origin as reference with CAS and leaves unmodified imports alone', async () => {
    act(() => button('Import snapshot').props.onClick())
    const manifest = previewProjectKnowledgeExport([record], { project: '/repo', approvedIds: [record.id] })
    manifest.records[0].content = 'Use npm test and inspect the result.'
    act(() => renderer.root.findByProps({ 'aria-label': 'Paste project Markdown snapshot' }).props.onChange({ target: { value: buildProjectKnowledgeMarkdown(manifest) } }))
    act(() => button('Review preview').props.onClick())
    expect(updateMemory).not.toHaveBeenCalled()
    await act(async () => button('Import reviewed references').props.onClick())
    expect(updateMemory).toHaveBeenCalledWith(record.id, expect.objectContaining({ authority: 'reference', expectedRevision: 2 }))
    expect(createMemory).not.toHaveBeenCalled()
  })
})
