import { ipcRenderer } from 'electron'
import type { KunGuiApi } from '../shared/kun-gui-api'

/** Sign-in, probing and model discovery for subscription-backed providers (Claude, Gemini, Cursor). */
export const subscriptionPreloadApi = {
  claudeSubscriptionStatus: () => ipcRenderer.invoke('claude-subscription:status'),
  claudeSubscriptionLogin: () => ipcRenderer.invoke('claude-subscription:login'),
  claudeSubscriptionProbe: (token, providerId) =>
    ipcRenderer.invoke('claude-subscription:probe', token, providerId),
  claudeSubscriptionModels: (token, providerId) =>
    ipcRenderer.invoke('claude-subscription:models', token, providerId),
  claudeSubscriptionModelCatalog: (token, providerId) =>
    ipcRenderer.invoke('claude-subscription:model-catalog', token, providerId),
  claudeSubscriptionSdkStatus: () => ipcRenderer.invoke('claude-subscription:sdk-status'),
  claudeSubscriptionSdkInstall: () => ipcRenderer.invoke('claude-subscription:sdk-install'),
  onClaudeSubscriptionSdkProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('claude-subscription:sdk-progress', wrapped)
    return () => ipcRenderer.removeListener('claude-subscription:sdk-progress', wrapped)
  },
  geminiSubscriptionCliStatus: () => ipcRenderer.invoke('gemini-subscription:cli-status'),
  geminiSubscriptionCliInstall: () => ipcRenderer.invoke('gemini-subscription:cli-install'),
  onGeminiSubscriptionCliProgress: (handler) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      payload: Parameters<typeof handler>[0]
    ) => handler(payload)
    ipcRenderer.on('gemini-subscription:cli-progress', wrapped)
    return () => ipcRenderer.removeListener('gemini-subscription:cli-progress', wrapped)
  },
  geminiSubscriptionModels: () => ipcRenderer.invoke('gemini-subscription:models'),
  geminiCliSubscriptionStatus: () => ipcRenderer.invoke('gemini-cli-subscription:status'),
  geminiCliSubscriptionModels: (providerId) => ipcRenderer.invoke('gemini-cli-subscription:models', providerId),
  cursorSubscriptionDiscover: (apiKey, providerId) =>
    ipcRenderer.invoke('cursor-subscription:discover', { apiKey, providerId })
} satisfies Partial<KunGuiApi>
