/**
 * [INPUT]: 依赖 dataDir、已批准 Workspace 根目录、node:fs realpath 和 atomic-write 保存 runId 映射
 * [OUTPUT]: 对外提供串行 ResearchRunIndex、抗符号链接逃逸的 Workspace 授权解析和持久化 run 自动恢复判定
 * [POS]: research/runtime 的安全持久化定位索引，让获批 Workspace 中的 run 在并发创建和 Runtime 重启后仍可被重新发现
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { mkdir, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import type { ResearchRun } from '../core/types.js'

export class ResearchRunIndex {
  private readonly rootByRunId = new Map<string, string>()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly dataDir: string) {}

  async load(): Promise<Record<string, string>> {
    const raw = await readFile(this.path(), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    if (!raw.trim()) return {}
    try {
      const value = JSON.parse(raw) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      for (const [runId, root] of Object.entries(value)) {
        if (typeof root !== 'string' || !root.trim()) continue
        this.rootByRunId.set(runId, normalizeRoot(root))
      }
      return Object.fromEntries(this.rootByRunId)
    } catch {
      return {}
    }
  }

  set(runId: string, workspaceRoot: string): void {
    this.rootByRunId.set(runId, normalizeRoot(workspaceRoot))
  }

  async setAndWrite(runId: string, workspaceRoot: string): Promise<void> {
    this.set(runId, workspaceRoot)
    await this.write()
  }

  async write(): Promise<void> {
    const operation = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const snapshot = Object.fromEntries(this.rootByRunId)
        await atomicWriteFile(this.path(), `${JSON.stringify(snapshot, null, 2)}\n`)
      })
    this.writeChain = operation
    await operation
  }

  private path(): string {
    return join(this.dataDir, 'research-run-index.json')
  }
}

export function shouldAutoResumePersistedRun(run: ResearchRun): boolean {
  if (!run.approval?.approvedByUser) return false
  if (['done', 'failed', 'cancelled', 'research_unavailable', 'scoping', 'awaiting_brief_confirm'].includes(run.status)) return false
  const updatedAt = Date.parse(run.updatedAt)
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= Math.max(15 * 60_000, run.budget.timeoutMs * 2)
}

export async function resolveResearchWorkspaceRoot(
  dataDir: string,
  workspaceRoot: string | undefined,
  allowedWorkspaceRoots: readonly string[] = []
): Promise<string> {
  const defaultRoot = resolve(dataDir, 'research-runs')
  await mkdir(defaultRoot, { recursive: true })
  const approvedRoots = new Set<string>([await realpath(defaultRoot)])
  for (const root of allowedWorkspaceRoots) {
    const trimmed = root.trim()
    if (!trimmed) continue
    const canonical = await realpath(resolve(trimmed)).catch(() => null)
    if (canonical) approvedRoots.add(normalizeRoot(canonical))
  }
  const requested = workspaceRoot?.trim()
  if (!requested) return normalizeRoot(await realpath(defaultRoot))
  const canonicalRequested = await realpath(resolve(requested)).catch(() => null)
  if (!canonicalRequested || !approvedRoots.has(normalizeRoot(canonicalRequested))) {
    throw new Error(`research_workspace_not_allowed: ${requested}`)
  }
  return normalizeRoot(canonicalRequested)
}

function normalizeRoot(value: string): string {
  return resolve(value.trim()).replace(/[\\/]+$/g, '')
}
