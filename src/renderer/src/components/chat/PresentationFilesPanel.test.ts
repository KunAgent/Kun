import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresentationFilesPanel } from './PresentationFilesPanel'
import type { PresentationFileArtifact } from './presentation-file-artifacts'

const actionMocks = vi.hoisted(() => ({
  open: vi.fn(),
  reveal: vi.fn()
}))

vi.mock('../../lib/open-workspace-path', () => ({
  openWorkspaceFileWithSystemDefault: actionMocks.open,
  revealWorkspaceFileInFileManager: actionMocks.reveal
}))

vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    presentationFilesTitle: 'Presentations',
    presentationKindPowerPoint: 'PowerPoint presentation',
    presentationOpen: 'Open',
    presentationOpenOptions: 'Open options',
    presentationOpenSystem: 'Open with system default app',
    presentationOpenFailed: 'Open failed',
    presentationRevealFailed: 'Reveal failed',
    fileTreeRevealInFileManager: 'Reveal in file manager'
  }
  return { useTranslation: () => ({ t: (key: string) => labels[key] ?? key }) }
})

const file: PresentationFileArtifact = {
  path: 'presentations/brief.pptx',
  name: 'brief.pptx',
  kind: 'powerpoint',
  extension: 'PPTX'
}

describe('PresentationFilesPanel', () => {
  let renderer: ReactTestRenderer
  const logError = vi.fn(async () => undefined)

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    actionMocks.open.mockReset().mockResolvedValue({
      ok: true,
      path: '/workspace/presentations/brief.pptx',
      editorId: 'system'
    })
    actionMocks.reveal.mockReset().mockResolvedValue({
      ok: true,
      path: '/workspace/presentations/brief.pptx',
      editorId: 'file-manager'
    })
    logError.mockClear()
    vi.stubGlobal('window', { kunGui: { logError } })
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    await act(async () => {
      renderer = create(createElement(PresentationFilesPanel, {
        files: [file],
        workspaceRoot: '/workspace'
      }))
    })
  })

  afterEach(async () => {
    await act(async () => renderer.unmount())
    vi.unstubAllGlobals()
  })

  it('opens the presentation with the thread workspace and system association', async () => {
    const openButton = renderer.root.findByProps({
      'aria-label': 'Open with system default app'
    })

    await act(async () => openButton.props.onClick())

    expect(actionMocks.open).toHaveBeenCalledWith('presentations/brief.pptx', '/workspace', undefined)
    expect(actionMocks.reveal).not.toHaveBeenCalled()
  })

  it('offers a file-manager reveal action', async () => {
    const menuButton = renderer.root.findByProps({ 'aria-label': 'Open options' })
    await act(async () => menuButton.props.onClick())
    const menuItems = renderer.root.findAllByProps({ role: 'menuitem' })

    await act(async () => menuItems[1].props.onClick())

    expect(actionMocks.reveal).toHaveBeenCalledWith('presentations/brief.pptx', '/workspace', undefined)
  })

  it('forwards the trusted content digest for Kun HTML open verification', async () => {
    const htmlFile: PresentationFileArtifact = {
      path: 'brief.kun-ppt.html',
      name: 'brief.kun-ppt.html',
      kind: 'kun-html',
      extension: 'HTML',
      contentSha256: 'a'.repeat(64)
    }
    await act(async () => renderer.update(createElement(PresentationFilesPanel, {
      files: [htmlFile],
      workspaceRoot: '/workspace'
    })))

    const openButton = renderer.root.findByProps({
      'aria-label': 'Open with system default app'
    })
    await act(async () => openButton.props.onClick())

    expect(actionMocks.open).toHaveBeenCalledWith(
      'brief.kun-ppt.html',
      '/workspace',
      'a'.repeat(64)
    )
  })

  it('keeps the card visible and shows a bounded failure state', async () => {
    actionMocks.open.mockResolvedValueOnce({ ok: false, message: 'No associated application' })
    const openButton = renderer.root.findByProps({
      'aria-label': 'Open with system default app'
    })

    await act(async () => openButton.props.onClick())

    expect(renderer.root.findByProps({ children: 'Open failed' })).toBeTruthy()
    expect(logError).toHaveBeenCalledWith(
      'presentation-open',
      'Failed to open presentation artifact',
      expect.objectContaining({ action: 'open', message: 'No associated application' })
    )
  })

  it('reports a reveal failure separately from an association failure', async () => {
    actionMocks.reveal.mockResolvedValueOnce({ ok: false, message: 'Finder unavailable' })
    const menuButton = renderer.root.findByProps({ 'aria-label': 'Open options' })
    await act(async () => menuButton.props.onClick())
    const menuItems = renderer.root.findAllByProps({ role: 'menuitem' })

    await act(async () => menuItems[1].props.onClick())

    expect(renderer.root.findByProps({ children: 'Reveal failed' })).toBeTruthy()
    expect(logError).toHaveBeenCalledWith(
      'presentation-open',
      'Failed to open presentation artifact',
      expect.objectContaining({ action: 'reveal', message: 'Finder unavailable' })
    )
  })
})
