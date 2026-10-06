import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperEvidenceImage } from './PaperEvidenceImage'
import { deferred, nodeText, render } from './paper-evidence-test-support'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let tree: ReactTestRenderer | undefined
let read: ReturnType<typeof vi.fn>
const localPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  read = vi.fn(async () => ({ ok: true, dataUrl: localPng }))
  vi.stubGlobal('window', { kunGui: { readWorkspaceImage: read } })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('PaperEvidenceImage local-only previews', () => {
  it.each([
    'https://untrusted.example/pixel?secret=private',
    '//untrusted.example/pixel',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><image href="https://untrusted.example/pixel"/></svg>',
    'data:text/html;base64,PGltZyBzcmM9Imh0dHBzOi8vdW50cnVzdGVkLmV4YW1wbGUiPg==',
    'data:image/png;https://untrusted.example,payload',
    ''
  ])('never creates an image element for malformed or non-PNG source %s', async (dataUrl) => {
    read.mockResolvedValue({ ok: true, dataUrl })
    tree = await render(createElement(PaperEvidenceImage, { workspaceRoot: '/library', path: '.paper/evidence/visual.png' }))
    expect(tree.root.findAllByType('img')).toHaveLength(0)
    expect(nodeText(tree.root)).toBe('Evidence image is not a local PNG.')
    expect(read).toHaveBeenCalledWith({ workspaceRoot: '/library', path: '.paper/evidence/visual.png' })
  })

  it('renders an accepted snapshot using only a local data URL', async () => {
    tree = await render(createElement(PaperEvidenceImage, { workspaceRoot: '/library', path: '.paper/evidence/visual.png' }))
    expect(tree.root.findByType('img').props.src).toBe(localPng)
    expect(tree.root.findByType('img').props.alt).toBe('paperEvidenceImage')
  })

  it('shows missing/corrupt image failures without external fallback', async () => {
    read.mockResolvedValue({ ok: false, message: 'Snapshot file is missing or invalid' })
    tree = await render(createElement(PaperEvidenceImage, { workspaceRoot: '/library', path: '.paper/evidence/visual.png' }))
    expect(tree.root.findAllByType('img')).toHaveLength(0)
    expect(nodeText(tree.root)).toBe('Snapshot file is missing or invalid')
  })

  it('abandons a previous workspace image read after navigation', async () => {
    const pending = deferred<unknown>()
    read.mockImplementationOnce(() => pending.promise).mockResolvedValueOnce({ ok: false, message: 'New snapshot missing' })
    tree = await render(createElement(PaperEvidenceImage, { workspaceRoot: '/library', path: 'a.png' }))
    await act(async () => tree!.update(createElement(PaperEvidenceImage, { workspaceRoot: '/other', path: 'b.png' })))
    await act(async () => pending.resolve({ ok: true, dataUrl: localPng }))
    expect(tree.root.findAllByType('img')).toHaveLength(0)
    expect(nodeText(tree.root)).toBe('New snapshot missing')
  })
})
