// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mobileDocumentsWorkspaceRoot, setMobileDocumentsWorkspaceRoot } from './mobile-documents-workspace'

afterEach(() => window.sessionStorage.clear())

describe('phone documents workspace', () => {
  const choice = { workspaces: ['/docs', '/another', '/papers'], defaultWorkspaceRoot: '/docs',
    activeWorkspaceRoot: '/papers', paperModeEnabled: true }
  it('ignores the host paper-mode root and restores the phone selection after reload', () => {
    expect(mobileDocumentsWorkspaceRoot(choice)).toBe('/docs')
    setMobileDocumentsWorkspaceRoot('/another', choice.workspaces)
    expect(mobileDocumentsWorkspaceRoot(choice)).toBe('/another')
    expect(mobileDocumentsWorkspaceRoot({ ...choice, paperModeEnabled: false })).toBe('/another')
  })
  it('rejects unknown and removed workspaces instead of opening an old host path', () => {
    setMobileDocumentsWorkspaceRoot('/private', choice.workspaces)
    expect(mobileDocumentsWorkspaceRoot(choice)).toBe('/docs')
    setMobileDocumentsWorkspaceRoot('/another', choice.workspaces)
    expect(mobileDocumentsWorkspaceRoot({ ...choice, workspaces: ['/docs'] })).toBe('/docs')
  })
})
