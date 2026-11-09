import { ipcRenderer } from 'electron'
import { DESKTOP_INDICATOR_CHANNEL, DESKTOP_INDICATOR_STATUS } from '../shared/desktop-indicator-channels'
ipcRenderer.on(DESKTOP_INDICATOR_STATUS, (_event, value: unknown) => {
  if (!value || typeof value !== 'object') return
  const state = value as { peer?: unknown; display?: unknown; mode?: unknown; zh?: unknown }
  if (typeof state.peer !== 'string' || state.peer.length > 128 || typeof state.display !== 'string' || state.display.length > 80 || !['view', 'control'].includes(String(state.mode))) return
  const title = document.getElementById('status'), button = document.getElementById('end')
  if (title) title.textContent = `Kun · ${state.display} · ${state.peer.slice(0, 8)} · ${state.mode === 'control' ? state.zh ? '正在控制' : 'Control' : state.zh ? '正在查看' : 'View'}`
  if (button) button.textContent = state.zh ? '结束远控' : 'End session'
})
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('end')?.addEventListener('click', () => ipcRenderer.send(DESKTOP_INDICATOR_CHANNEL))
})
