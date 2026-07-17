import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchStageRouter } from './WorkbenchStageRouter'

describe('WorkbenchStageRouter', () => {
  it('renders the Collaboration stage for the collaboration route', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchStageRouter, {
      route: 'collaboration',
      leftSidebarCollapsed: false,
      onToggleLeftSidebar: vi.fn(),
      onOpenThread: vi.fn(),
      design: {} as never,
      write: {} as never,
      conversation: {} as never,
      imageAnnotationHost: null,
      planOverlay: null,
      extensions: { workspaceRoot: '', onOpenIntegrations: vi.fn() }
    }))

    expect(html).toContain('data-collaboration-stage="true"')
  })
})
