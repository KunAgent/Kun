let appQuitting = false

export function markAppQuitting(): void {
  appQuitting = true
}

export function isAppQuitting(): boolean {
  return appQuitting
}

export function resetAppQuittingForTests(): void {
  appQuitting = false
}
