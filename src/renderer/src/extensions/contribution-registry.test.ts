import { ExtensionContributionsSchema } from '@kun/extension-api'
import { describe, expect, it } from 'vitest'
import {
  ContributionRegistry,
  ExtensionWorkbenchSnapshotSchema,
  resolveContributionCommand
} from './contribution-registry'
import { BUILTIN_RIGHT_PANEL_IDS } from './contribution-ids'

function extension(
  id: string,
  contributes: Parameters<typeof ExtensionContributionsSchema.parse>[0],
  grants: string[] = ['ui.views', 'webview', 'ui.actions', 'commands.register', 'ui.notifications', 'hostDom']
) {
  return {
    id,
    version: '1.2.3',
    contributes: ExtensionContributionsSchema.parse(contributes),
    grantedPermissions: grants,
    enabled: true,
    compatible: true,
    workspaceTrusted: true,
    diagnostics: []
  }
}

function snapshot(extensions: ReturnType<typeof extension>[]) {
  return ExtensionWorkbenchSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    extensions
  })
}

describe('ContributionRegistry', () => {
  it('keeps builtins and qualifies extension views without activating code', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(snapshot([
      extension('acme.issues', {
        'views.rightSidebar': [{
          id: 'issues',
          title: 'Issues',
          entry: 'dist/index.html',
          order: 20
        }]
      })
    ]))

    expect(registry.has(BUILTIN_RIGHT_PANEL_IDS.changes)).toBe(true)
    expect(registry.has(BUILTIN_RIGHT_PANEL_IDS.terminal)).toBe(true)
    expect(registry.has(BUILTIN_RIGHT_PANEL_IDS.files)).toBe(true)
    expect(registry.has(BUILTIN_RIGHT_PANEL_IDS.sideConversations)).toBe(true)
    const view = registry.get('extension:acme.issues/issues')
    expect(view?.owner).toMatchObject({ kind: 'extension', extensionId: 'acme.issues' })
    expect(view?.point).toBe('views.rightSidebar')
  })

  it('orders equal-priority contributions deterministically by qualified ID', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(snapshot([
      extension('zed.panels', {
        'actions.topBar': [{ id: 'open', command: 'open', title: 'Zed', order: 10 }]
      }),
      extension('acme.panels', {
        'actions.topBar': [{ id: 'open', command: 'open', title: 'Acme', order: 10 }]
      })
    ]))

    expect(registry.list('actions.topBar').map((item) => item.id)).toEqual([
      'extension:acme.panels/open',
      'extension:zed.panels/open'
    ])
  })

  it('rejects an ambiguous manifest atomically and never replaces builtins', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(snapshot([
      extension('acme.duplicate', {
        commands: [{ id: 'same', title: 'Command' }],
        'actions.topBar': [{ id: 'same', command: 'same', title: 'Action' }]
      })
    ]))

    expect(registry.get('extension:acme.duplicate/same')).toBeUndefined()
    expect(registry.has(BUILTIN_RIGHT_PANEL_IDS.todo)).toBe(true)
    expect(registry.getDiagnostics().some((item) => item.code === 'CONTRIBUTION_DUPLICATE_ID')).toBe(true)
  })

  it('enforces permission, trust, compatibility and closed when gates', () => {
    const registry = new ContributionRegistry()
    const denied = extension('acme.gated', {
      'views.rightSidebar': [{
        id: 'dashboard',
        title: 'Dashboard',
        entry: 'dist/index.html',
        when: "workspaceOpen && workbench.mode == 'code'"
      }]
    }, ['ui.views'])
    registry.replaceExtensions(snapshot([denied]))
    expect(registry.get('extension:acme.gated/dashboard', {
      workspaceOpen: true,
      'workbench.mode': 'code'
    })).toBeUndefined()
    expect(registry.getDiagnostics().some((item) => item.code === 'CONTRIBUTION_PERMISSION_DENIED')).toBe(true)

    registry.replaceExtensions(snapshot([{ ...denied, grantedPermissions: ['ui.views', 'webview'] }]))
    expect(registry.get('extension:acme.gated/dashboard', { workspaceOpen: false })).toBeUndefined()
    expect(registry.get('extension:acme.gated/dashboard', {
      workspaceOpen: true,
      'workbench.mode': 'code'
    })).toBeDefined()
  })

  it('keeps untrusted right-rail metadata discoverable without making it executable', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      extensions: [{
        ...extension('acme.review', {}, []),
        workspaceTrusted: false,
        rightRailDiscovery: {
          views: [{
            id: 'review',
            title: 'Review me',
            icon: 'assets/review.svg',
            when: 'workspaceOpen',
            order: 30
          }],
          containers: []
        }
      }]
    }))

    expect(registry.listRightRailViewEntries({ workspaceOpen: false })).toEqual([])
    expect(registry.listRightRailViewEntries({ workspaceOpen: true })).toMatchObject([{
      id: 'extension:acme.review/review',
      workspaceTrusted: false,
      payload: { title: 'Review me' }
    }])
    expect(registry.list('views.rightSidebar', { workspaceOpen: true })
      .filter((item) => item.owner.kind === 'extension')).toEqual([])
    expect(registry.get('extension:acme.review/review', { workspaceOpen: true })).toBeUndefined()
    expect(registry.has('extension:acme.review/review', { workspaceOpen: true })).toBe(false)
    expect(registry.sanitizeLayoutIds(
      ['extension:acme.review/review'],
      { workspaceOpen: true }
    )).toEqual([])
  })

  it('keeps rail-hidden right-sidebar Views executable without adding a rail launcher', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      extensions: [
        extension('acme.hidden', {
          'views.rightSidebar': [{
            id: 'editor',
            title: 'Editor',
            entry: 'dist/index.html',
            showInRightRail: false
          }]
        }),
        {
          ...extension('acme.untrusted-hidden', {}, []),
          workspaceTrusted: false,
          rightRailDiscovery: {
            views: [{
              id: 'review',
              title: 'Review',
              showInRightRail: false,
              order: 0
            }],
            containers: []
          }
        }
      ]
    }))

    expect(registry.get('extension:acme.hidden/editor')).toMatchObject({
      point: 'views.rightSidebar',
      payload: { showInRightRail: false }
    })
    expect(registry.listRightRailViewEntries()).toEqual([])
  })

  it('removes stale layout IDs and namespaces private command dispatch', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(snapshot([
      extension('acme.commands', {
        'actions.composer': [{ id: 'refresh-action', command: 'refresh', title: 'Refresh' }]
      })
    ]))
    const action = registry.get('extension:acme.commands/refresh-action')!
    expect(resolveContributionCommand(action, 'refresh')).toBe('extension:acme.commands/refresh')
    expect(resolveContributionCommand(action, 'extension:other.commands/steal')).toBe('')
    expect(registry.sanitizeLayoutIds([
      BUILTIN_RIGHT_PANEL_IDS.changes,
      'extension:acme.commands/refresh-action',
      'extension:gone.panel/view',
      BUILTIN_RIGHT_PANEL_IDS.changes
    ])).toEqual([
      BUILTIN_RIGHT_PANEL_IDS.changes,
      'extension:acme.commands/refresh-action'
    ])
  })
})
