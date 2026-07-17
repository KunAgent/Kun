import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { useCollaborationStore } from './collaboration-store'
import { CollaborationSidebar } from './CollaborationSidebar'

describe('CollaborationSidebar', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useCollaborationStore.setState({
      snapshot: { version: 1, meetings: [], employees: [], invocations: [], commandResults: {} },
      selection: null,
      loading: false,
      error: null
    })
  })

  it('renders separate meeting and reception employee sections', () => {
    const html = renderToStaticMarkup(createElement(CollaborationSidebar, {
      onCodeOpen: vi.fn(),
      onWriteOpen: vi.fn(),
      onDesignOpen: vi.fn(),
      onCollaborationOpen: vi.fn()
    }))

    expect(html).toContain('会议')
    expect(html).toContain('接待数字员工')
  })
})
