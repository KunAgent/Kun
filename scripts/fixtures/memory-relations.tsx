import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import en from '../../src/renderer/src/locales/en/common'
import zh from '../../src/renderer/src/locales/zh/common'
import enSettings from '../../src/renderer/src/locales/en/settings'
import zhSettings from '../../src/renderer/src/locales/zh/settings'
import { MemoryRelationsPanel } from '../../src/renderer/src/components/memory/MemoryRelationsPanel'
import { MemoryWorkingContextPanel } from '../../src/renderer/src/components/memory/MemoryWorkingContextPanel'
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
  const [automatic, setAutomatic] = useState(false)
  return <main className="relation-fixture">
    <header className="mb-5 space-y-2">
      <h1 className="text-xl font-semibold text-ds-ink">Memory relations</h1>
      <p className="text-sm text-ds-muted">Isolated component + store fixture. Synthetic provider; no user data.</p>
    </header>
    <MemoryRelationsPanel memory={memory} t={t} />
    <section className="mt-6 border-t border-ds-border-muted pt-4">
      <h2 className="mb-3 text-lg font-semibold text-ds-ink">{t('memoryContextTitle')}</h2>
      <label className="mb-3 flex gap-2 text-sm text-ds-ink">
        <input type="checkbox" checked={automatic} onChange={async (event) => {
          const enabled = event.target.checked
          setAutomatic(enabled)
          await (window as any).__relationConfigure(enabled)
        }} />{t('memoryContextEnable')}
      </label>
      <MemoryWorkingContextPanel enabled automaticEnabled={automatic} t={t} />
    </section>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
