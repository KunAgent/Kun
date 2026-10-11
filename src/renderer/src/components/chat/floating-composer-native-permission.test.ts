import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { nativePermissionPreview, permissionFollowsKunLevel } from '../../lib/harness-native-permission'
import { FloatingComposerPermissionMenuContent } from './FloatingComposerExecutionPicker'

const devinModes = [
  { id: 'ask', label: 'Ask (read-only)', kunPermissionMode: 'ask-for-approval' },
  { id: 'smart', label: 'Smart (auto-approve safe actions)', kunPermissionMode: 'approve-for-me' },
  { id: 'accept-edits', label: 'Accept edits', kunPermissionMode: 'full-access' },
  { id: 'bypass', label: 'Full access', kunPermissionMode: 'full-access' }
]

describe('native permission preview', () => {
  it('mirrors the runtime mapping for Devin, including the read-only ask level', () => {
    expect(nativePermissionPreview('devin', devinModes, 'ask-for-approval')).toMatchObject({ id: 'ask', readOnly: true })
    expect(nativePermissionPreview('devin', devinModes, 'approve-for-me')).toMatchObject({ id: 'smart', readOnly: false })
    expect(nativePermissionPreview('devin', devinModes, 'full-access')).toMatchObject({ id: 'bypass', readOnly: false })
    expect(nativePermissionPreview('devin', devinModes, 'full-access', 'accept-edits')).toMatchObject({ id: 'accept-edits' })
    expect(nativePermissionPreview('devin', devinModes, 'ask-for-approval', 'bypass')).toMatchObject({ id: 'ask' })
    expect(nativePermissionPreview('devin', [], 'full-access')).toBeNull()
  })

  it('shows what Codex and Claude Code actually run, which follows the Kun level only', () => {
    const codexModes = [
      { id: 'read-only', label: 'Read only', kunPermissionMode: 'ask-for-approval' },
      { id: 'auto', label: 'Auto', kunPermissionMode: 'full-access' },
      { id: 'full-access', label: 'Full access', kunPermissionMode: 'full-access' }
    ]
    expect(nativePermissionPreview('codex', codexModes, 'ask-for-approval', 'read-only', 'codex-app-server'))
      .toEqual({ id: 'workspace-write', label: 'Workspace write', readOnly: false })
    expect(nativePermissionPreview('codex', codexModes, 'approve-for-me', undefined, 'codex-app-server')).toMatchObject({ id: 'workspace-write' })
    expect(nativePermissionPreview('codex', codexModes, 'full-access', undefined, 'codex-app-server')).toMatchObject({ id: 'danger-full-access' })
    const claudeModes = [
      { id: 'default', label: 'Ask', kunPermissionMode: 'ask-for-approval' },
      { id: 'acceptEdits', label: 'Accept edits', kunPermissionMode: 'full-access' },
      { id: 'bypassPermissions', label: 'Full access', kunPermissionMode: 'full-access' }
    ]
    // The SDK runtime ignores a saved native preference such as acceptEdits.
    expect(nativePermissionPreview('claude-code', claudeModes, 'full-access', 'acceptEdits', 'agent-sdk')).toMatchObject({ id: 'bypassPermissions' })
    expect(nativePermissionPreview('claude-code', claudeModes, 'approve-for-me', undefined, 'agent-sdk')).toMatchObject({ id: 'default', readOnly: false })
    expect(['codex-app-server', 'agent-sdk', 'acp', 'pi-rpc'].map(permissionFollowsKunLevel)).toEqual([true, true, false, false])
  })

  it('tells the user which native mode each Kun level runs and flags read-only', async () => {
    await i18n.changeLanguage('en')
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
      createElement(FloatingComposerPermissionMenuContent, {
        permissionMode: 'ask-for-approval',
        agentPermission: { agentName: 'Devin', preview: (mode) => nativePermissionPreview('devin', devinModes, mode) },
        onSelect: () => undefined
      })))
    expect(html).toContain('Devin runs in: Ask (read-only, will not change files)')
    expect(html).toContain('Devin runs in: Smart')
    expect(html).toContain('Devin runs in: Bypass permissions')
    expect(html).toContain('data-native-permission-mode="smart"')
  })
})
