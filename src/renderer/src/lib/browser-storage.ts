export type BrowserStorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem?: (key: string) => void
}

export type BrowserStorageMutation = {
  key: string
  value: string | null
}

type BrowserStorageMutationObserver = (mutation: BrowserStorageMutation) => void

let mutationObserver: BrowserStorageMutationObserver | null = null
const mutationListeners = new Set<BrowserStorageMutationObserver>()

export function subscribeBrowserStorageMutations(observer: BrowserStorageMutationObserver): () => void {
  mutationListeners.add(observer)
  return () => { mutationListeners.delete(observer) }
}

function observeMutation(mutation: BrowserStorageMutation): void {
  mutationObserver?.(mutation)
  mutationListeners.forEach((listener) => listener(mutation))
}

export function setBrowserStorageMutationObserver(
  observer: BrowserStorageMutationObserver | null
): void {
  mutationObserver = observer
}

function observedStorage(storage: BrowserStorageLike): BrowserStorageLike {
  if (!mutationObserver && !mutationListeners.size) return storage
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => {
      storage.setItem(key, value)
      observeMutation({ key, value })
    },
    ...(storage.removeItem
      ? {
          removeItem: (key: string) => {
            storage.removeItem?.(key)
            observeMutation({ key, value: null })
          }
        }
      : {})
  }
}

function isStorageLike(value: unknown): value is BrowserStorageLike {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as BrowserStorageLike).getItem === 'function' &&
    typeof (value as BrowserStorageLike).setItem === 'function'
  )
}

export function browserStorage(): BrowserStorageLike | null {
  try {
    if (typeof window !== 'undefined' && isStorageLike(window.localStorage)) {
      return observedStorage(window.localStorage)
    }
  } catch {
    return null
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    if (descriptor && 'value' in descriptor && isStorageLike(descriptor.value)) {
      return observedStorage(descriptor.value)
    }
  } catch {
    return null
  }

  return null
}

export function readBrowserStorageItem(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeBrowserStorageItem(key: string, value: string): void {
  try {
    browserStorage()?.setItem(key, value)
  } catch {
    /* ignore persistence failures */
  }
}

export function removeBrowserStorageItem(key: string): void {
  try {
    browserStorage()?.removeItem?.(key)
  } catch {
    /* ignore persistence failures */
  }
}
