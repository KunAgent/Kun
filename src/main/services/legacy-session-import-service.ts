import { cp, mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  LegacySessionDetectResult,
  LegacySessionDetectedSource,
  LegacySessionImportSummary,
  LegacySessionSourceKind
} from '../../shared/kun-gui-api'

/**
 * 把“DeepSeek GUI”时代遗留的会话目录导入到当前 Kun 数据目录。
 *
 * 关键事实(决定了实现方式):
 *   - 新旧版本会话的磁盘格式完全一致:每个线程一个目录,内含
 *     metadata.jsonl / messages.jsonl / events.jsonl(早期还有 thread.json)。
 *   - HybridThreadStore 把 JSONL 文件当作权威来源、SQLite 只是可重建的索引;
 *     启动时的 backfill() 会扫描线程目录并把未入库的线程补进索引。
 *   因此“导入”本质上只是把线程目录拷进 {dataDir}/threads,再重启运行时
 *   触发 backfill 即可——无需任何格式转换。
 *
 * 设计约束:
 *   1. 绝不覆盖目标已存在的线程目录(按目录名/线程 ID 去重),保证幂等且非破坏性。
 *   2. 拷贝而非移动,旧数据原地保留作为兜底。
 *   3. 任何单个线程拷贝失败都被吞掉并计入 skipped,不让整个导入中断。
 *
 * 这个模块刻意不 import electron,方便在 vitest 里注入临时目录直接测试。
 */

const THREAD_DIR_MARKERS = ['metadata.jsonl', 'thread.json', 'messages.jsonl'] as const

export type LegacySessionSourceCandidate = {
  id: string
  kind: LegacySessionSourceKind
  /** 旧版线程目录的绝对路径,如 ~/.deepseekgui/kun/threads。 */
  path: string
}

export type LegacySessionImportLogger = (message: string, detail?: unknown) => void

/**
 * 自动检测的旧数据来源。顺序即展示优先级:先列近期版本(kun),
 * 再列更早的 coreagent 时代数据。两者磁盘格式相同。
 */
export function defaultLegacySourceCandidates(homeDir: string): LegacySessionSourceCandidate[] {
  return [
    { id: 'deepseekgui-kun', kind: 'kun', path: join(homeDir, '.deepseekgui', 'kun', 'threads') },
    {
      id: 'deepseekgui-coreagent',
      kind: 'coreagent',
      path: join(homeDir, '.deepseekgui', 'coreagent', 'threads')
    }
  ]
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

/** realpath 解析失败(路径不存在等)时回退到原路径,只用于同目录判定。 */
async function safeRealpath(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    return target
  }
}

/**
 * 列出 parent 下“看起来像线程目录”的子目录名。判定:目录名以 thr_ 开头,
 * 或目录内含已知线程标志文件(兼容自定义命名 / 更早格式)。
 */
async function listThreadDirNames(parent: string): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => null)
  if (!entries) return []
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('thr_')) {
      names.push(entry.name)
      continue
    }
    const dir = join(parent, entry.name)
    for (const marker of THREAD_DIR_MARKERS) {
      if (await pathExists(join(dir, marker))) {
        names.push(entry.name)
        break
      }
    }
  }
  return names
}

/**
 * 把用户手选的文件夹解析成真正的 threads 目录:既支持直接选中 threads 目录,
 * 也支持选中它的上级(如 .../kun),自动下探一层 threads。
 */
async function resolveSourceThreadsDir(picked: string): Promise<string> {
  if ((await listThreadDirNames(picked)).length > 0) return picked
  const nested = join(picked, 'threads')
  if ((await listThreadDirNames(nested)).length > 0) return nested
  return picked
}

/** 检测可导入的旧会话来源,以及其中有多少是目标里尚不存在的。 */
export async function detectLegacySessions(input: {
  destDataDir: string
  homeDir?: string
}): Promise<LegacySessionDetectResult> {
  const homeDir = input.homeDir ?? homedir()
  const destDir = join(input.destDataDir, 'threads')
  const destReal = await safeRealpath(destDir)
  const existing = new Set(await listThreadDirNames(destDir))

  const sources: LegacySessionDetectedSource[] = []
  for (const candidate of defaultLegacySourceCandidates(homeDir)) {
    if (!(await pathExists(candidate.path))) continue
    // 已经是当前数据目录本身(老版本启动迁移留下的符号链接)——无需再导入。
    if ((await safeRealpath(candidate.path)) === destReal) continue
    const names = await listThreadDirNames(candidate.path)
    if (names.length === 0) continue
    const newCount = names.reduce((count, name) => (existing.has(name) ? count : count + 1), 0)
    sources.push({
      id: candidate.id,
      kind: candidate.kind,
      path: candidate.path,
      threadCount: names.length,
      newCount
    })
  }
  return { destDir, sources }
}

/**
 * 执行导入。sourceDir 为空 = 导入所有自动检测到的默认来源;否则只导入用户
 * 手选的目录。已存在的线程目录一律跳过(skipped),不覆盖。
 */
export async function importLegacySessions(input: {
  destDataDir: string
  homeDir?: string
  sourceDir?: string
  log?: LegacySessionImportLogger
}): Promise<LegacySessionImportSummary> {
  const homeDir = input.homeDir ?? homedir()
  const destDir = join(input.destDataDir, 'threads')
  await mkdir(destDir, { recursive: true })
  const destReal = await safeRealpath(destDir)

  const sourceDirs: string[] = []
  const picked = input.sourceDir?.trim()
  if (picked) {
    sourceDirs.push(await resolveSourceThreadsDir(picked))
  } else {
    for (const candidate of defaultLegacySourceCandidates(homeDir)) {
      if (await pathExists(candidate.path)) sourceDirs.push(candidate.path)
    }
  }

  const summary: LegacySessionImportSummary = {
    destDir,
    total: 0,
    imported: 0,
    skipped: 0,
    sources: []
  }

  for (const sourceDir of sourceDirs) {
    // 跳过指向目标本身的来源,避免把目录拷进自己。
    if ((await safeRealpath(sourceDir)) === destReal) continue
    const names = await listThreadDirNames(sourceDir)
    let imported = 0
    let skipped = 0
    for (const name of names) {
      const target = join(destDir, name)
      if (await pathExists(target)) {
        skipped += 1
        continue
      }
      try {
        await cp(join(sourceDir, name), target, {
          recursive: true,
          preserveTimestamps: true,
          errorOnExist: false
        })
        imported += 1
      } catch (error) {
        input.log?.('legacy-session-import: failed to copy thread', {
          name,
          sourceDir,
          message: error instanceof Error ? error.message : String(error)
        })
        skipped += 1
      }
    }
    summary.sources.push({ path: sourceDir, total: names.length, imported, skipped })
    summary.total += names.length
    summary.imported += imported
    summary.skipped += skipped
  }

  return summary
}
