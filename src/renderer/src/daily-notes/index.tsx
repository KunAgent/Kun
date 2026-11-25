import { createRoot } from 'react-dom/client'
import type { DailyNotesApi } from '@shared/daily-notes'
import { DailyNotesView } from './view'
import './notes.css'

declare global {
  interface Window { kunDailyNotes: DailyNotesApi }
}

createRoot(document.getElementById('root')!).render(<DailyNotesView api={window.kunDailyNotes} />)
