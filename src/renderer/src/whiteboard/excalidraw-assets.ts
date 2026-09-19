declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

export function ensureExcalidrawAssetPath(): void {
  if (typeof window === 'undefined') return
  if (window.EXCALIDRAW_ASSET_PATH) return
  window.EXCALIDRAW_ASSET_PATH = new URL('excalidraw/', window.location.href).href
}

export function excalidrawLangCode(language: string | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? 'en'
  if (normalized.startsWith('zh')) return 'zh-CN'
  if (normalized.startsWith('ja')) return 'ja-JP'
  if (normalized.startsWith('ko')) return 'ko-KR'
  if (normalized.startsWith('ru')) return 'ru-RU'
  if (normalized.startsWith('th')) return 'th-TH'
  if (normalized.startsWith('hi')) return 'hi-IN'
  return 'en'
}

export function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}
