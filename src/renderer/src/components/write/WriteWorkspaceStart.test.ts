import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../../i18n'
import { WriteWorkspaceStart } from './WriteWorkspaceStart'

const baseProps = {
  onAskAssistant: () => undefined,
  onCreateDraft: () => undefined,
  onPickWorkspace: () => undefined,
  onRefreshWorkspace: () => undefined,
  workspaceName: 'write_workspace',
  workspacePathLabel: '/home/user/.kun/write_workspace'
}

describe('WriteWorkspaceStart', () => {
  it('explains writing-space setup on first use', () => {
    const html = renderToStaticMarkup(createElement(WriteWorkspaceStart, {
      ...baseProps,
      onboarding: true
    }))

    expect(html).toContain('Create your first writing space')
    expect(html).toContain('Create writing space')
    expect(html).toContain('Use Kun default space')
    expect(html).toContain('separately from code projects')
  })

  it('keeps the regular empty-workspace actions after onboarding', () => {
    const html = renderToStaticMarkup(createElement(WriteWorkspaceStart, baseProps))

    expect(html).toContain('New draft')
    expect(html).toContain('Ask AI for an outline')
    expect(html).not.toContain('Use Kun default space')
  })
})
