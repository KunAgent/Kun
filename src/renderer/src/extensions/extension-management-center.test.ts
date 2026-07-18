import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import {
  ExtensionManagementCenter,
  extensionCardLogoUrl,
  extensionCanRollback,
  extensionEffectiveEnabled
} from './ExtensionManagementCenter'
import type { ExtensionManagementEntry } from './extension-workbench-client'

function entry(overrides: Partial<ExtensionManagementEntry> = {}): ExtensionManagementEntry {
  return {
    id: 'acme.sample',
    selectedVersion: '2.0.0',
    previousSelectedVersion: '1.0.0',
    globallyEnabled: true,
    workspaceEnablement: {},
    workspacePermissionGrants: {},
    useDevelopment: false,
    versions: [],
    ...overrides
  }
}

describe('ExtensionManagementCenter', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('keeps extension enablement and rollback state explicit', () => {
    expect(extensionEffectiveEnabled(entry(), '/workspace')).toBe(true)
    expect(extensionEffectiveEnabled(entry({ workspaceEnablement: { '/workspace': false } }), '/workspace')).toBe(false)
    expect(extensionCanRollback(entry())).toBe(true)
    expect(extensionCanRollback(entry({ previousSelectedVersion: undefined }))).toBe(false)
    expect(extensionCardLogoUrl('acme.sample', 'assets/logo.svg')).toBe(
      'kun-extension://acme.sample/assets/logo.svg?kunHostResource=icon'
    )
    expect(extensionCardLogoUrl('acme.sample')).toBeUndefined()
  })

  it('visibly separates full extensions from UI Plugin, MCP, and Skill management', () => {
    const html = renderToStaticMarkup(createElement(ExtensionManagementCenter, {
      leftSidebarCollapsed: false,
      workspaceRoot: '/workspace',
      onToggleLeftSidebar: vi.fn(),
      onOpenIntegrations: vi.fn(),
      onOpenView: vi.fn()
    }))
    expect(html).toContain('Kun Extension Center')
    expect(html).toContain('Looking for UI appearance packs, MCP, or Skills?')
    expect(html).toContain('Those systems remain separate')
    expect(html).toContain('No automatic update checks')
    expect(html).toContain('not an OS sandbox')
  })
})
