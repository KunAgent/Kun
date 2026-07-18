// 必须是第一个 import:把旧品牌前缀的 localStorage 键拷贝到新前缀,
// 后面的 store 模块在 import 阶段就会读这些键。
import './lib/legacy-local-storage-migration'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './index.css'
import './styles/base-shell.css'
import './styles/surfaces-write.css'
import './styles/markdown-code.css'
import './styles/write-editor.css'
import './styles/write-rich-editor.css'
import './styles/workflow-canvas.css'
import App from './App'
import './i18n'
import { applyCursorSpotlight } from './lib/apply-theme'
import { installCursorSpotlightTracking } from './lib/cursor-spotlight'
import { installDataMigrationRendererRpc } from './data-migration/renderer-state-rpc'

document.documentElement.dataset.platform = window.kunGui?.platform ?? 'unknown'
applyCursorSpotlight(true)
installCursorSpotlightTracking()
installDataMigrationRendererRpc()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
