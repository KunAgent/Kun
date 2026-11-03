import { create } from 'zustand'

/**
 * A URL another surface (the terminal) asked the preview panel to show. The
 * workbench prefers it over the latest URL detected in the conversation and
 * opens the preview tab when a request arrives.
 */
export const DEV_PREVIEW_OPEN_URL_EVENT = 'kun:dev-preview-open-url'

type DevPreviewRequestState = {
  url: string | null
  seq: number
}

export const useDevPreviewRequestStore = create<DevPreviewRequestState>(() => ({ url: null, seq: 0 }))

export function requestDevPreviewUrl(url: string): void {
  useDevPreviewRequestStore.setState((state) => ({ url, seq: state.seq + 1 }))
  window.dispatchEvent(new CustomEvent<string>(DEV_PREVIEW_OPEN_URL_EVENT, { detail: url }))
}
