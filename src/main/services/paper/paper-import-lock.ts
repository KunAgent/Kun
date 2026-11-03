/** Serialize allocation/dedupe within one destination, including PDF and BibTeX imports. */
const imports = new Map<string, Promise<void>>()

export async function withPaperImportLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = imports.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  imports.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (imports.get(key) === current) imports.delete(key)
  }
}
