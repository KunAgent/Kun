const protectedContents = new WeakSet<object>()

/** Main-only marker; never exposed through a renderer/preload API. */
export function markProtectedWindowContents(contents: object): void {
  protectedContents.add(contents)
}

export function isProtectedWindowContents(contents: object): boolean {
  return protectedContents.has(contents)
}
