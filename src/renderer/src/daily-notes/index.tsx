import { createRoot } from 'react-dom/client'
import type { DailyNotesApi } from '@shared/daily-notes'
import { DailyNotesView } from './view'
import './notes.css'

declare global {
  interface Window { kunDailyNotes: DailyNotesApi }
}

document.documentElement.classList.add('daily-notes-standalone')
// The main process hides the native title bar on macOS; the header reserves room for the traffic lights.
if (navigator.userAgent.includes('Macintosh')) document.documentElement.dataset.platform = 'mac'

createRoot(document.getElementById('root')!).render(<DailyNotesView api={window.kunDailyNotes} />)
