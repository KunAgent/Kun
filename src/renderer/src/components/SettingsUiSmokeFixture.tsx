import { createRoot } from 'react-dom/client'
import type { AppSettingsV1 } from '@shared/app-settings'
import { ExtensionContributionsSchema } from '@kun/extension-api'
import { SettingsView } from './SettingsView'
import { coerceRendererSettings } from './settings-utils'
import { installSettingsSmokeHost } from './SettingsUiSmokeHost'
import { useChatStore } from '../store/chat-store'
import { useHarnessStore } from '../store/harness-store'
import { ExtensionSettingsServiceProvider } from '../extensions/ExtensionSettingsServiceContext'
import { refreshExtensionContributionSnapshot } from '../extensions/use-contributions'
import type { ExtensionSettingsService, ExtensionSettingsSnapshot } from '../extensions/extension-settings-service'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import i18n from '../i18n'
import '../index.css'
import '../styles/base-shell.css'
import '../styles/settings-layout.css'
import '../styles/neutral-polish.css'
import '../styles/provider-quota-panel.css'

// Only the host boundary and data are replaced. All navigation, controls,
// settings hooks, translations, styles, and lazy panels are production code.
const parameters = new URLSearchParams(location.search)
const platform = parameters.get('platform') === 'darwin' ? 'darwin' : 'win32'
const initial = coerceRendererSettings({
  version: 1, locale: 'en', theme: 'light', initialSetupCompleted: true,
  workspaceRoot: '/fixture/workspace',
  provider: { apiKey: '', baseUrl: 'https://offline.invalid' }
} as AppSettingsV1)
const host = installSettingsSmokeHost(initial)
Object.assign(window.kunGui, { platform, homeDir: '/fixture', appEnvironment: 'development' })
document.documentElement.dataset.platform = platform
document.documentElement.dataset.desktopTitleBar = platform === 'darwin' ? 'mac-native' : 'custom'

const contributionId = 'extension:fixture.settings/preferences'
let extensionSnapshot: ExtensionSettingsSnapshot = {
  schemaVersion: 1, revision: 1,
  values: { [contributionId]: { enabled: true, label: 'Offline extension', density: 2 } }
}
const service: ExtensionSettingsService = {
  load: async () => extensionSnapshot,
  update: async ({ contributionId: id, key, value }) => {
    extensionSnapshot = { ...extensionSnapshot, revision: extensionSnapshot.revision + 1,
      values: { ...extensionSnapshot.values, [id]: { ...extensionSnapshot.values[id], [key]: value } } }
    return extensionSnapshot
  }
}
Object.assign(window.kunGui, {
  extensionGetWorkbench: async () => ({ ok: true, status: 200, body: JSON.stringify({
    schemaVersion: 1, revision: 1, workspaceRoot: '/fixture/workspace',
    extensions: [{ id: 'fixture.settings', version: '1.0.0', enabled: true,
      compatible: true, workspaceTrusted: true, grantedPermissions: ['ui.actions'],
      contributes: ExtensionContributionsSchema.parse({ settings: [{ id: 'preferences',
        title: 'Offline extension', scope: 'workspace', properties: {
          enabled: { type: 'boolean', title: 'Enable extension', default: true },
          label: { type: 'string', title: 'Display name', default: 'Offline extension' },
          density: { type: 'integer', title: 'Density', minimum: 1, maximum: 3, default: 2 }
        } }] }) }]
  }) })
})
useChatStore.setState({ route: 'settings', settingsSection: 'general',
  workspaceRoot: '/fixture/workspace', activeThreadId: null, runtimeConnection: 'ready',
  threads: [], refreshThreads: async () => undefined, reloadUiSettings: async () => undefined,
  probeRuntime: async () => undefined, applyI18nFromSettings: async () => undefined,
  closeSettings: () => undefined, openCode: async () => undefined,
  openInitialSetup: () => undefined, openPlugins: () => undefined
})
useHarnessStore.setState({ rowsLoadedAt: Date.now() })
await i18n.changeLanguage('en')
await refreshExtensionContributionSnapshot('/fixture/workspace', 'en')

Object.assign(window, { settingsFixture: {
  host,
  label: (key: string, defaultValue?: string) => i18n.t(key, { ns: 'settings', defaultValue: defaultValue ?? key }),
  theme: (theme: 'light' | 'dark') => {
    const next = { ...host.settings, theme }
    host.setSettings(next)
    emitRendererSettingsChanged(next)
  },
  language: (language: string) => i18n.changeLanguage(language),
  coverage: {
    component: 'SettingsView', bridgePlatform: platform,
    excluded: [
      'Provider-specific sign-in flows and real credentials',
      'Real downloads, microphone capture, native file dialogs and external websites',
      'Data migration export/import wizard steps beyond landing tabs',
      'Populated archives, memories, worktrees and their mutation dialogs',
      'Conditionally enabled feature branches not reached by tabs or disclosures',
      'Operating-system DPI changes: scales are native Electron webContents zoom'
    ]
  }
} })
createRoot(document.getElementById('root')!).render(
  <ExtensionSettingsServiceProvider service={service}>
    <div style={{ width: '100%', height: '100%', minWidth: 0 }}><SettingsView /></div>
    <aside aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0 }}>
      <button data-settings-smoke-external data-settings-action="secondary" type="button" tabIndex={-1}
        className="h-5 rounded-sm border px-1 text-[11px]">Non-settings control</button>
    </aside>
  </ExtensionSettingsServiceProvider>
)
