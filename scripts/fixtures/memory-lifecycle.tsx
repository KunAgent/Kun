import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../../src/renderer/src/locales/en/common'
import zh from '../../src/renderer/src/locales/zh/common'
import { InjectedMemoryMetaChip } from '../../src/renderer/src/components/chat/injected-memory-meta-chip'
import { InjectedMemoryLookupProvider } from '../../src/renderer/src/components/chat/injected-memory-lookup'
import { AgentMemoryPanel } from '../../src/renderer/src/components/rooms/AgentMemoryPanel'
import { ProjectKnowledgePanel } from '../../src/renderer/src/components/memory/ProjectKnowledgePanel'
import { RoomMemoryReceipt } from '../../src/renderer/src/components/rooms/RoomMemoryReceipt'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'
import '../../src/renderer/src/styles/markdown-code.css'
import '../../src/renderer/src/styles/neutral-polish.css'
import '../../src/renderer/src/components/rooms/rooms.css'
import '../../src/renderer/src/components/rooms/rooms-runs.css'
import '../../src/renderer/src/components/rooms/agents.css'

const fixture = (window as any).memoryFixture = {
  calls: [] as unknown[], missingKeys: [] as string[],
  language: (language: string) => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language
    return i18next.changeLanguage(language)
  },
  changed: () => window.dispatchEvent(new Event('memory-fixture-change'))
}
const runtimeRequest = async (path: string, method = 'GET', body?: string) => {
  const result = await (window as any).__memoryFixtureTransport(path, method, body)
  fixture.calls.push({ path, method, body, status: result.status })
  if (result.ok && method !== 'GET') fixture.changed()
  return result
}
const api = async (path: string, method = 'GET', body?: unknown) => {
  const result = await runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
  const value = JSON.parse(result.body)
  if (!result.ok) throw new Error(value.error?.message ?? 'Fixture request failed')
  return value
}
fixture.api = api
;(window as any).kunGui = { runtimeRequest,
  exportMemoryMarkdown: async (payload: unknown) => { fixture.calls.push({ export: payload }); return { ok: false, canceled: true } }
}
const metadata = await api('/__fixture/bootstrap')
fixture.metadata = metadata
await i18next.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en', defaultNS: 'common', saveMissing: true,
  missingKeyHandler: (_languages, namespace, key) => fixture.missingKeys.push(`${namespace}:${key}`),
  resources: { en: { common: en }, zh: { common: zh } }
})
// Same chip utilities as message-timeline-bubble-support; production Tailwind compiles these.
const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint'
function Fixture() {
  const [projects, setProjects] = useState([metadata.project])
  const refreshProjects = async () => {
    setProjects((await api('/v1/memory?project=' + encodeURIComponent(metadata.projectRoot))).memories)
  }
  return <main className="rooms-workspace memory-fixture-shell ds-no-drag">
    <header className="memory-fixture-header"><small>ISOLATED NATIVE COMPONENT / STORE FIXTURE</small><h1>Memory workbench</h1>
      <p>Production controls and styles with temporary synthetic conversations. No app accounts or user data.</p></header>
    <AgentMemoryPanel agentId={metadata.agentId} active onSource={() => undefined} />
    <section aria-label="Conversation memory usage" className="memory-fixture-conversation">
      <InjectedMemoryLookupProvider workspaceRoot={metadata.projectRoot}>
        <InjectedMemoryMetaChip memoryIds={[metadata.projectId]} meta={{ injectedMemorySummaries: [{ id: metadata.projectId, content: 'The earlier recorded test command.' }] }} chipClass={chipClass} />
      </InjectedMemoryLookupProvider>
    </section>
    <RoomMemoryReceipt context={{ memoryReceipt: metadata.receipt }} />
    <ProjectKnowledgePanel records={projects} create={async (input) => {
      await api('/v1/memory', 'POST', input); await refreshProjects(); return true
    }} update={async (id, input) => {
      await api('/v1/memory/' + encodeURIComponent(id) + '?project=' + encodeURIComponent(metadata.projectRoot), 'PATCH', input)
      await refreshProjects(); return true
    }} />
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
