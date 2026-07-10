import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceFilePreviewPanel } from './WorkspaceFilePreviewPanel'

describe('WorkspaceFilePreviewPanel tab controls', () => {
  it('renders pinned and cross-thread preservation state as native controls', () => {
    const target = { path: 'C:\\repo\\docs\\plan.md', workspaceRoot: 'C:\\repo' }
    const targetKey = 'c:/repo\nc:/repo/docs/plan.md'
    const html = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanel, {
      target,
      openTargets: [target],
      workspaceRoot: 'C:\\repo',
      pinnedTargetKeys: [targetKey],
      preserveAcrossThreads: true,
      onTogglePinnedTarget: () => undefined,
      onCloseOtherTargets: () => undefined,
      onTogglePreserveAcrossThreads: () => undefined,
      onClose: () => undefined
    }))

    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('data-kun-preview-key="c:/repo\nc:/repo/docs/plan.md"')
    expect(html).toContain('lucide-pin')
  })
})
