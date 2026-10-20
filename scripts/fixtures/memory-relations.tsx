import React from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import en from '../../src/renderer/src/locales/en/common'
import zh from '../../src/renderer/src/locales/zh/common'
import enSettings from '../../src/renderer/src/locales/en/settings'
import zhSettings from '../../src/renderer/src/locales/zh/settings'
import { MemoryRelationsPanel } from '../../src/renderer/src/components/memory/MemoryRelationsPanel'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'
import '../../src/renderer/src/styles/neutral-polish.css'

const fixture = (window as any).relationFixture = {
  missingKeys: [] as string[],
  language: (language: string) => i18next.changeLanguage(language)
}
;(window as any).kunGui = {
  runtimeRequest: (path: string, method: string, body: string) =>
    (window as any).__relationTransport(path, method, body)
}
await i18next.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en', defaultNS: 'common', saveMissing: true,
  missingKeyHandler: (_languages, namespace, key) => fixture.missingKeys.push(`${namespace}:${key}`),
  resources: { en: { common: en, settings: enSettings }, zh: { common: zh, settings: zhSettings } }
})
const memory = await (window as any).__relationSource()
function Fixture() {
  const { t } = useTranslation('settings')
  return <main className="relation-fixture">
    <header className="mb-5 space-y-2">
      <h1 className="text-xl font-semibold text-ds-ink">Memory relations</h1>
      <p className="text-sm text-ds-muted">Isolated component + store fixture. Synthetic provider; no user data.</p>
    </header>
    <MemoryRelationsPanel memory={memory} t={t} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
