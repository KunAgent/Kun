import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { MiniWindowOverlay } from '../../src/renderer/src/components/MiniWindowOverlay'
import { useWindowMiniMode } from '../../src/renderer/src/lib/use-window-mini-mode'

function Fixture() {
  const mini = useWindowMiniMode()
  const [input, setInput] = useState('')
  const [sent, setSent] = useState('')
  return <div className="fixture-app">
    {mini ? <MiniWindowOverlay /> : null}
    <div className="fixture-workbench">
      <div data-workbench-left-sidebar className="fixture-sidebar">Threads</div>
      <div className="ds-workbench-divider" />
      <main>
        <button onClick={() => window.kunGui.runDesktopCommand('toggleMini')}>Toggle mini</button>
        <div className="fixture-history" data-testid="history">
          {Array.from({ length: 30 }, (_, index) => <p key={index}>Conversation line {index + 1}</p>)}
        </div>
        <textarea aria-label="Message" value={input} onChange={(event) => setInput(event.target.value)} />
        <button onClick={() => setSent(input)}>Send</button>
        <output>{sent}</output>
      </main>
      <div data-workbench-right-panel className="fixture-sidebar">Preview</div>
    </div>
  </div>
}

void i18n.use(initReactI18next).init({
  lng: 'en', defaultNS: 'common', resources: { en: { common: {
    miniWindowRestore: 'Restore window', miniWindowDragHint: 'Drag this bar to move'
  } } }, interpolation: { escapeValue: false }
}).then(() => createRoot(document.getElementById('root')!).render(<Fixture />))
