// 必须是第一个 import:把旧品牌前缀的 localStorage 键拷贝到新前缀,
// 后面的 store 模块在 import 阶段就会读这些键。
import './lib/legacy-local-storage-migration'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './index.css'
import './styles/base-shell.css'
import './styles/startup-gate.css'
import './styles/settings-layout.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import './styles/write-rich-editor.css'
import './styles/workflow-canvas.css'
import './styles/graph-workbench.css'
import './styles/neutral-polish.css'
import './styles/provider-quota-panel.css'
import { applyCursorSpotlight } from './lib/apply-theme'
import { installCursorSpotlightTracking } from './lib/cursor-spotlight'
import { installDataMigrationRendererRpc } from './data-migration/renderer-state-rpc'
import { resolveDesktopTitleBarMode } from '@shared/desktop-title-bar'
import { StartupGate } from './StartupGate'
import {
  installProviderMutationFlushHandler,
  registerProviderMutationFlushOperations
} from './components/provider-mutation-flush'

document.documentElement.dataset.platform = window.kunGui?.platform ?? 'unknown'
document.documentElement.dataset.desktopTitleBar = window.kunGui?.desktopTitleBarMode
  ?? resolveDesktopTitleBarMode(window.kunGui?.platform ?? 'unknown', false)
applyCursorSpotlight(true)
installCursorSpotlightTracking()
const storageRelocationMode = new URLSearchParams(window.location.search).get('storageRelocation') === '1'
const runtimeMigrationRecoveryMode = new URLSearchParams(window.location.search).get('runtimeMigrationRecovery') === '1'
if (!storageRelocationMode && !runtimeMigrationRecoveryMode) installDataMigrationRendererRpc()
installProviderMutationFlushHandler()

// The renderer owns exactly one React root for the whole app lifecycle.
// Startup phases, boot views, and the workbench all render through StartupGate.
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing root element')
const reactRoot = ReactDOM.createRoot(rootElement)

void bootstrap().catch((error: unknown) => {
  // The i18n chunk (or anything else awaited before the first render) failed,
  // so React never mounted. Render a minimal non-React error view with retry.
  renderBootstrapFailure(rootElement, error)
})

async function bootstrap(): Promise<void> {
  await import('./i18n')
  reactRoot.render(
    <React.StrictMode>
      <StartupGate
        storageRelocationMode={storageRelocationMode}
        runtimeMigrationRecoveryMode={runtimeMigrationRecoveryMode}
      />
    </React.StrictMode>
  )
}

function renderBootstrapFailure(target: HTMLElement, error: unknown): void {
  const message = error instanceof Error && error.message ? error.message : String(error)
  const view = document.createElement('main')
  view.style.cssText =
    'min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#f7f7f8;color:#1f2329;font-family:system-ui,sans-serif;padding:2rem;'

  const card = document.createElement('section')
  card.style.cssText =
    'max-width:28rem;display:flex;flex-direction:column;align-items:center;gap:1rem;' +
    'border:1px solid #e2e3e6;border-radius:1rem;background:#ffffff;padding:2rem;text-align:center;'

  const title = document.createElement('h1')
  title.textContent = 'Failed to start Kun'
  title.style.cssText = 'font-size:1rem;font-weight:600;margin:0;'

  const detail = document.createElement('p')
  detail.textContent = message
  detail.style.cssText = 'font-size:0.8125rem;color:#6b7280;word-break:break-word;margin:0;'

  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = 'Retry'
  retry.style.cssText =
    'min-height:2.25rem;padding:0.5rem 1rem;border-radius:9999px;border:none;' +
    'background:#1f2329;color:#ffffff;font-size:0.8125rem;font-weight:500;cursor:pointer;'
  retry.addEventListener('click', () => window.location.reload())

  card.append(title, detail, retry)
  view.append(card)
  target.replaceChildren(view)
}
