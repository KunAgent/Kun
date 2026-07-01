import { readFile } from 'node:fs/promises'

export interface PublisherTrustStore {
  getPublisherKey(publisherId: string): string | undefined
  trustedPublisherIds(): string[]
}

export class InMemoryPublisherTrustStore implements PublisherTrustStore {
  private readonly keys: Map<string, string>

  constructor(keys: Record<string, string> = {}) {
    this.keys = new Map(
      Object.entries(keys)
        .filter(([id, pem]) => id.length > 0 && pem.length > 0)
    )
  }

  getPublisherKey(publisherId: string): string | undefined {
    if (!publisherId) return undefined
    return this.keys.get(publisherId)
  }

  trustedPublisherIds(): string[] {
    return [...this.keys.keys()]
  }
}

export async function loadPublisherTrustStore(filePath: string): Promise<PublisherTrustStore> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new InMemoryPublisherTrustStore()
    }
    const keys: Record<string, string> = {}
    for (const [id, pem] of Object.entries(parsed)) {
      if (typeof pem === 'string' && pem.trim()) keys[id] = pem
    }
    return new InMemoryPublisherTrustStore(keys)
  } catch {
    return new InMemoryPublisherTrustStore()
  }
}
