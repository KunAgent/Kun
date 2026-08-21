import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CodeCanvasPanel,
  codeCanvasPanelDesignHostClass,
  codeCanvasPanelShellClass,
  codeCanvasPanelTitlebarClass,
  resolveCodeCanvasDesignSurface,
  shouldRehydrateCodeCanvasDesignDocument
} from './CodeCanvasPanel'

describe('CodeCanvasPanel', () => {
  it('uses code whiteboard copy in the sidebar shell', () => {
    const html = renderToStaticMarkup(
      createElement(CodeCanvasPanel, {
        workspaceRoot: '/workspace',
        activeThreadId: null,
        onCollapse: () => {}
      })
    )

    expect(html).toContain('Whiteboard')
    expect(html).toContain('Open or start a conversation to use the whiteboard.')
    expect(html).not.toContain('Open or start a conversation to use the canvas.')
  })

  it('uses a floating canvas chrome instead of a docked sidebar header', () => {
    const html = renderToStaticMarkup(
      createElement(CodeCanvasPanel, {
        workspaceRoot: '/workspace',
        activeThreadId: null,
        onCollapse: () => {}
      })
    )

    expect(codeCanvasPanelShellClass('h-full')).toContain('overflow-hidden')
    expect(codeCanvasPanelShellClass('h-full')).toContain('bg-[#f8fafc]')
    expect(codeCanvasPanelShellClass('h-full', 'focused')).not.toContain('border-l')
    expect(codeCanvasPanelTitlebarClass()).toContain('rounded-full')
    expect(codeCanvasPanelTitlebarClass()).toContain('backdrop-blur-2xl')
    expect(html).toContain('data-code-canvas-titlebar="true"')
    expect(html).not.toContain('border-b border-ds-border-muted bg-white/92')
  })

  it('gives the direct Design whiteboard a flex sizing context', () => {
    const classes = codeCanvasPanelDesignHostClass().split(' ')

    expect(classes).toEqual(expect.arrayContaining([
      'flex',
      'flex-1',
      'min-h-0',
      'overflow-hidden'
    ]))
  })

  it('uses the bound Design document while the cached surface hydrates', () => {
    expect(resolveCodeCanvasDesignSurface({
      surface: null,
      workspaceRoot: '/workspace',
      activeThreadId: 'design-thread',
      designTaskActive: true,
      designDocumentId: 'doc-bound'
    })).toEqual({
      surfaceKind: 'kun-design',
      threadId: 'design-thread',
      workspaceRoot: '/workspace',
      documentId: 'doc-bound'
    })
  })

  it('does not replace a matching browsed Design surface with the fallback document', () => {
    expect(resolveCodeCanvasDesignSurface({
      surface: {
        threadId: 'design-thread',
        workspaceRoot: '/workspace',
        documentId: 'doc-browsed',
        readOnly: true,
        canonicalDocumentId: 'doc-bound'
      },
      workspaceRoot: '/workspace',
      activeThreadId: 'design-thread',
      designTaskActive: true,
      designDocumentId: 'doc-bound'
    })?.documentId).toBe('doc-browsed')
  })

  it('keeps a provisional Design board before the profile target hydrates', () => {
    expect(resolveCodeCanvasDesignSurface({
      surface: {
        threadId: 'design-thread',
        workspaceRoot: '/workspace',
        documentId: 'doc-provisional',
        boardArtifactId: 'board-provisional'
      },
      workspaceRoot: '/workspace',
      activeThreadId: 'design-thread',
      designTaskActive: false
    })).toMatchObject({
      documentId: 'doc-provisional',
      boardArtifactId: 'board-provisional'
    })
  })

  it('rehydrates when the active id is set before the document list arrives', () => {
    expect(shouldRehydrateCodeCanvasDesignDocument([], 'doc-bound')).toBe(true)
    expect(shouldRehydrateCodeCanvasDesignDocument([{ id: 'doc-bound' }], 'doc-bound')).toBe(false)
  })

  it('keeps a classified Design task in its Design loading state before target hydration', () => {
    const html = renderToStaticMarkup(
      createElement(CodeCanvasPanel, {
        workspaceRoot: '/workspace',
        activeThreadId: 'design-thread',
        designTaskActive: true,
        onCollapse: () => {}
      })
    )

    expect(html).toContain('Loading')
    expect(html).not.toContain('Open or start a conversation to use the whiteboard.')
  })
})
