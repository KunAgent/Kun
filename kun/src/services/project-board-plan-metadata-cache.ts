import { readFile, stat } from 'node:fs/promises'

export type ProjectBoardPlanTaskMetadata = {
  sectionTitle: string
  description: string
}

export type ProjectBoardPlanMetadataLoad = {
  entries: Map<number, ProjectBoardPlanTaskMetadata>
  cacheHit: boolean
}

type CacheEntry = {
  mtimeMs: number
  size: number
  entries: Map<number, ProjectBoardPlanTaskMetadata>
}

export class ProjectBoardPlanMetadataCache {
  private readonly entries = new Map<string, CacheEntry>()
  private readonly inFlight = new Map<string, Promise<ProjectBoardPlanMetadataLoad>>()

  constructor(private readonly capacity = 128) {}

  async load(path: string): Promise<ProjectBoardPlanMetadataLoad> {
    const running = this.inFlight.get(path)
    if (running) return running
    const task = this.loadFresh(path).finally(() => {
      if (this.inFlight.get(path) === task) this.inFlight.delete(path)
    })
    this.inFlight.set(path, task)
    return task
  }

  private async loadFresh(path: string): Promise<ProjectBoardPlanMetadataLoad> {
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(path)
    } catch {
      this.entries.delete(path)
      return { entries: new Map(), cacheHit: false }
    }
    const cached = this.entries.get(path)
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      this.entries.delete(path)
      this.entries.set(path, cached)
      return { entries: cached.entries, cacheHit: true }
    }
    let markdown: string
    try {
      markdown = await readFile(path, 'utf8')
    } catch {
      return { entries: new Map(), cacheHit: false }
    }
    const entries = parsePlanTaskMetadata(markdown)
    this.entries.set(path, { mtimeMs: info.mtimeMs, size: info.size, entries })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) break
      this.entries.delete(oldest)
    }
    return { entries, cacheHit: false }
  }
}

export async function loadPlanMetadataConcurrently(
  paths: readonly string[],
  cache: ProjectBoardPlanMetadataCache,
  concurrency = 4
): Promise<{ metadata: Map<string, Map<number, ProjectBoardPlanTaskMetadata>>; cacheHits: number }> {
  const metadata = new Map<string, Map<number, ProjectBoardPlanTaskMetadata>>()
  let cacheHits = 0
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= paths.length) return
      const path = paths[index] as string
      const loaded = await cache.load(path)
      metadata.set(path, loaded.entries)
      if (loaded.cacheHit) cacheHits += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker))
  return { metadata, cacheHits }
}

export function parsePlanTaskMetadata(
  markdown: string
): Map<number, ProjectBoardPlanTaskMetadata> {
  const result = new Map<number, ProjectBoardPlanTaskMetadata>()
  const lines = markdown.split(/\r?\n/)
  let sectionTitle = ''
  let ordinal = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const heading = line.match(/^#{2,3}\s+(.+?)\s*$/)
    if (heading) sectionTitle = heading[1]?.trim() ?? ''
    if (!/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) continue
    let description = ''
    const taskIndent = line.match(/^\s*/)?.[0].length ?? 0
    for (let child = index + 1; child < lines.length; child += 1) {
      const candidate = lines[child] ?? ''
      if (!candidate.trim()) continue
      const indent = candidate.match(/^\s*/)?.[0].length ?? 0
      if (indent <= taskIndent || /^\s*[-*+]\s+\[[ xX]\]\s+/.test(candidate)) break
      description = candidate.trim().replace(/^[-*+]\s+/, '')
      break
    }
    result.set(ordinal++, { sectionTitle, description })
  }
  return result
}
