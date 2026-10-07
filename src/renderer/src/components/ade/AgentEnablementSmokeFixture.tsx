import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { SettingsView } from '../SettingsView'
import { FloatingComposerHarnessPicker } from '../chat/FloatingComposerHarnessPicker'
import { coerceRendererSettings } from '../settings-utils'
import { installSettingsSmokeHost } from '../SettingsUiSmokeHost'
import { useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import i18n from '../../i18n'
import '../../index.css'
import '../../styles/base-shell.css'
import '../../styles/settings-layout.css'
import '../../styles/settings-chrome.css'
import '../../styles/settings-controls.css'
import '../../styles/settings-pages.css'
import '../../styles/neutral-polish.css'

const initial = coerceRendererSettings({ version: 1, locale: 'en', theme: 'light', initialSetupCompleted: true,
  workspaceRoot: '/fixture/workspace', provider: { apiKey: '', baseUrl: 'https://offline.invalid' } } as AppSettingsV1)
const host = installSettingsSmokeHost(initial)
let rerender: (() => void) | undefined
let opened = true
let epoch = 0
let navigationBusy = false
const navigationWaiters = new Set<() => void>()
const runtime = host.harnessRuntime
const requestedPlatform = new URLSearchParams(location.search).get('platform')
const platform = requestedPlatform === 'darwin' || requestedPlatform === 'win32' ? requestedPlatform : 'linux'
Object.assign(window.kunGui, { platform, homeDir: '/fixture', appEnvironment: 'development' })
document.documentElement.dataset.platform = platform
document.documentElement.dataset.desktopTitleBar = platform === 'darwin' ? 'mac-native' : 'custom'
useChatStore.setState({ route: 'settings', settingsSection: 'agentsHarnesses',
  workspaceRoot: '/fixture/workspace', activeThreadId: null, runtimeConnection: 'ready',
  threads: [], refreshThreads: async () => undefined,
  reloadUiSettings: async () => { if (navigationBusy) await new Promise<void>((resolve) => navigationWaiters.add(resolve)) },
  probeRuntime: async () => undefined, applyI18nFromSettings: async () => undefined,
  closeSettings: () => { opened = false; rerender?.() }, openCode: async () => undefined,
  openInitialSetup: () => undefined, openPlugins: () => undefined
})
const refresh = (): void => {
  useHarnessStore.setState({ rows: runtime.rows(), rowsLoadedAt: Date.now(), rowsLoading: false })
  rerender?.()
}
await i18n.changeLanguage('en')
Object.assign(window, { agentEnablementFixture: {
  async reset(): Promise<void> {
    // Unmount first so production cleanup cannot persist an old draft over reset data.
    flushSync(() => { opened = false; rerender?.() })
    await new Promise((resolve) => setTimeout(resolve, 0))
    runtime.reset(); host.calls.length = 0; host.setSettings(initial)
    opened = true; epoch += 1
    useHarnessStore.setState({ settingsHarnessId: 'pi', models: {}, providerGroups: {} })
    refresh()
  },
  setOutcome: runtime.setOutcome,
  resolvePending: runtime.resolvePending,
  selectAgent(id: string): void { useHarnessStore.setState({ settingsHarnessId: id }) },
  close(): void {
    document.querySelector<HTMLButtonElement>('.ds-settings-sidebar button[aria-label]')?.click()
  },
  restart(): void { runtime.restart(); refresh() },
  setNavigationBusy(busy: boolean): void {
    navigationBusy = busy
    if (!busy) { for (const resolve of navigationWaiters) resolve(); navigationWaiters.clear() }
  },
  reopen(): void { opened = true; useHarnessStore.setState({ settingsHarnessId: 'pi' }); refresh() },
  language: (language: string) => i18n.changeLanguage(language),
  theme(theme: 'light' | 'dark'): void {
    // Use the saved host state and its renderer settings event. SettingsView
    // applies data-theme itself, including after later saves and remounts.
    host.setSettings({ ...host.settings, theme })
  },
  snapshot: () => ({ calls: { tests: runtime.calls.tests, mutations: host.calls.filter((call) => call.name === 'setSettings').length },
    enabledProfiles: getKunRuntimeSettings(host.settings).harnesses.enabledProfiles,
    defaults: getKunRuntimeSettings(host.settings).harnesses.defaults })
} })
function Fixture() {
  const [, setVersion] = useState(0)
  rerender = () => setVersion((value) => value + 1)
  const rows = useHarnessStore((state) => state.rows)
  return <main className="flex h-screen min-w-0 flex-col bg-ds-main text-ds-ink">
    <div data-agent-smoke-picker className="shrink-0 p-3"><FloatingComposerHarnessPicker harnessId="kun" harnessLabel="Kun"
      rows={rows} loading={false} needsConfirm={() => false} onSelect={() => undefined} /></div>
    {opened ? <div className="min-h-0 flex-1"><SettingsView key={epoch} /></div> : <p>Settings closed</p>}
  </main>
}
useHarnessStore.setState({ rows: runtime.rows(), rowsLoadedAt: Date.now(), settingsHarnessId: 'pi' })
createRoot(document.getElementById('root')!).render(<Fixture />)
