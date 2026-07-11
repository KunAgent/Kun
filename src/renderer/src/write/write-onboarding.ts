import {
  browserStorage,
  type BrowserStorageLike
} from '../lib/browser-storage'

const WRITE_ONBOARDING_STORAGE_KEY = 'kun.write.onboarding.v1'

export function readWriteOnboardingComplete(
  storage: BrowserStorageLike | null = browserStorage()
): boolean {
  try {
    return storage?.getItem(WRITE_ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeWriteOnboardingComplete(
  storage: BrowserStorageLike | null = browserStorage()
): void {
  try {
    storage?.setItem(WRITE_ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // Onboarding persistence is optional; writing must remain usable without storage.
  }
}
