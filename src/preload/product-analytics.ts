import { ipcRenderer } from 'electron'
import type { ProductAnalyticsApi } from '../shared/product-analytics'
import { ANALYTICS_CHANNELS as channels } from '../shared/product-analytics-channels'
export const productAnalyticsApi: ProductAnalyticsApi = {
  getState: () => ipcRenderer.invoke(channels.state),
  setEnabled: enabled => ipcRenderer.invoke(channels.consent, enabled),
  track: (input, epoch) => ipcRenderer.invoke(channels.track, { event: input, epoch }),
  guidance: () => ipcRenderer.invoke(channels.guidance)
}
