import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve, sep } from 'node:path'
import {
  normalizeColabAccelerator,
  type ColabMetricPoint,
  type ColabSyncCandidate,
  type ColabWorkspaceRunConfig
} from '../../shared/colab/colab-types'

const ALWAYS_IGNORED = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.DS_Store',
  'dist',
  'build',
  'out',
  '.kun'
])

const ONE_GIB = 1024 * 1024 * 1024
const MAX_STAT_FILES_PER_CANDIDATE = 4_000
export const KUN_COLAB_CONFIG_FILENAME = 'kun.colab.json'

function parseIgnoreEntries(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => line.replace(/^\/+|\/+$/g, ''))
}

async function loadWorkspaceIgnoreSet(workspaceRoot: string): Promise<Set<string>> {
  const ignored = new Set(ALWAYS_IGNORED)
  for (const filename of ['.gitignore', '.kunignore']) {
    const path = join(workspaceRoot, filename)
    if (!existsSync(path)) continue
    try {
      const raw = await readFile(path, 'utf8')
      for (const pattern of parseIgnoreEntries(raw)) {
        if (!pattern.includes('*')) ignored.add(pattern)
      }
    } catch {
      // Ignore unreadable ignore file.
    }
  }
  return ignored
}

async function measureEntry(
  absPath: string,
  ignoredNames: Set<string>,
  budget = { count: 0, bytes: 0 }
): Promise<{ fileCount: number; totalBytes: number; isDirectory: boolean }> {
  const info = await stat(absPath)
  if (!info.isDirectory()) {
    return { fileCount: 1, totalBytes: info.size, isDirectory: false }
  }
  const walk = async (dir: string): Promise<void> => {
    if (budget.count >= MAX_STAT_FILES_PER_CANDIDATE) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (budget.count >= MAX_STAT_FILES_PER_CANDIDATE) break
      if (ignoredNames.has(entry.name)) continue
      const childPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(childPath)
      } else if (entry.isFile()) {
        try {
          const childStat = await stat(childPath)
          budget.count += 1
          budget.bytes += childStat.size
        } catch {
          // Ignore transient file errors.
        }
      }
    }
  }
  await walk(absPath)
  return { fileCount: budget.count, totalBytes: budget.bytes, isDirectory: true }
}

export async function inspectWorkspaceSyncCandidates(
  workspaceRoot: string
): Promise<{
  candidates: ColabSyncCandidate[]
  savedConfig: ColabWorkspaceRunConfig | null
}> {
  const root = workspaceRoot.trim()
  if (!root || !existsSync(root)) {
    return { candidates: [], savedConfig: null }
  }
  const savedConfig = await readWorkspaceColabConfig(root)
  const ignored = await loadWorkspaceIgnoreSet(root)
  let topEntries
  try {
    topEntries = await readdir(root, { withFileTypes: true })
  } catch {
    return { candidates: [], savedConfig }
  }

  const candidates: ColabSyncCandidate[] = []
  for (const entry of topEntries) {
    if (ignored.has(entry.name)) continue
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    if (!entry.isFile() && !entry.isDirectory()) continue
    try {
      const measured = await measureEntry(join(root, entry.name), ignored)
      if (measured.isDirectory && measured.fileCount === 0) continue
      const isRequirements =
        !measured.isDirectory &&
        (entry.name === 'requirements.txt' || entry.name === 'pyproject.toml')
      const suggestDriveMount = measured.totalBytes >= ONE_GIB
      const relativePath = measured.isDirectory ? `${entry.name}/` : entry.name
      const defaultSelected = savedConfig
        ? savedConfig.syncPaths.includes(relativePath) || savedConfig.syncPaths.includes(entry.name)
        : !suggestDriveMount
      candidates.push({
        relativePath,
        label: relativePath,
        isDirectory: measured.isDirectory,
        fileCount: measured.fileCount,
        totalBytes: measured.totalBytes,
        defaultSelected,
        ...(isRequirements ? { isRequirements: true } : {}),
        ...(suggestDriveMount ? { suggestDriveMount: true } : {})
      })
    } catch {
      continue
    }
  }

  candidates.sort((a, b) => {
    if (Boolean(a.isRequirements) !== Boolean(b.isRequirements)) {
      return a.isRequirements ? 1 : -1
    }
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? 1 : -1
    return a.relativePath.localeCompare(b.relativePath)
  })
  return { candidates: candidates.slice(0, 24), savedConfig }
}

export async function collectSyncFileList(
  workspaceRoot: string,
  syncPaths: readonly string[]
): Promise<Array<{ absPath: string; remoteRelPath: string; sizeBytes: number }>> {
  const ignored = await loadWorkspaceIgnoreSet(workspaceRoot)
  const files: Array<{ absPath: string; remoteRelPath: string; sizeBytes: number }> = []
  const seen = new Set<string>()

  const visit = async (absPath: string, relPosix: string): Promise<void> => {
    let info
    try {
      info = await stat(absPath)
    } catch {
      return
    }
    if (info.isFile()) {
      if (!seen.has(relPosix)) {
        seen.add(relPosix)
        files.push({ absPath, remoteRelPath: relPosix, sizeBytes: info.size })
      }
      return
    }
    if (!info.isDirectory()) return
    let entries
    try {
      entries = await readdir(absPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue
      await visit(join(absPath, entry.name), posix.join(relPosix, entry.name))
    }
  }

  for (const raw of syncPaths) {
    const cleaned = raw.trim().replace(/^\/+|\/+$/g, '').replaceAll('\\', '/')
    if (!cleaned || cleaned.includes('..')) continue
    await visit(join(workspaceRoot, cleaned), cleaned)
  }
  return files
}

export function sanitizeOutputLocalDir(raw?: string): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed || trimmed.includes('\0') || isAbsolute(trimmed)) return './outputs'
  const norm = trimmed.replaceAll('\\', '/')
  if (/^[a-zA-Z]:/.test(norm) || norm.split('/').some((seg) => seg === '..')) return './outputs'
  return trimmed
}

export function resolveWorkspaceOutputLocalDir(
  workspaceRoot: string,
  outputLocalDir?: string
): string {
  const baseRoot = resolve(workspaceRoot.trim() || process.cwd())
  const safeRel = sanitizeOutputLocalDir(outputLocalDir)
  const candidate = resolve(baseRoot, safeRel)
  if (candidate !== baseRoot && !candidate.startsWith(baseRoot + sep)) {
    return join(baseRoot, 'outputs')
  }
  return candidate
}

export async function readWorkspaceColabConfig(
  workspaceRoot: string
): Promise<ColabWorkspaceRunConfig | null> {
  const filePath = join(workspaceRoot, KUN_COLAB_CONFIG_FILENAME)
  if (!existsSync(filePath)) return null
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Partial<ColabWorkspaceRunConfig>
    if (typeof raw.entryCommand !== 'string') return null
    return {
      entryCommand: raw.entryCommand,
      accelerator: normalizeColabAccelerator(raw.accelerator, 'T4'),
      ...(typeof raw.highMem === 'boolean' ? { highMem: raw.highMem } : {}),
      syncPaths: Array.isArray(raw.syncPaths)
        ? raw.syncPaths.filter((p): p is string => typeof p === 'string')
        : [],
      outputRemoteDir: typeof raw.outputRemoteDir === 'string' ? raw.outputRemoteDir : 'outputs/',
      outputLocalDir: sanitizeOutputLocalDir(
        typeof raw.outputLocalDir === 'string' ? raw.outputLocalDir : undefined
      ),
      maxRuntimeHours:
        typeof raw.maxRuntimeHours === 'number' && raw.maxRuntimeHours > 0
          ? raw.maxRuntimeHours
          : 3,
      autoStop: typeof raw.autoStop === 'boolean' ? raw.autoStop : true,
      ...(typeof raw.mountDrive === 'boolean' ? { mountDrive: raw.mountDrive } : {}),
      ...(raw.envVars && typeof raw.envVars === 'object' ? { envVars: raw.envVars } : {}),
      ...(typeof raw.setupScript === 'string' ? { setupScript: raw.setupScript } : {}),
      ...(typeof raw.metricPattern === 'string' ? { metricPattern: raw.metricPattern } : {})
    }
  } catch {
    return null
  }
}

export async function saveWorkspaceColabConfig(
  workspaceRoot: string,
  config: ColabWorkspaceRunConfig
): Promise<void> {
  await mkdir(workspaceRoot, { recursive: true })
  const filePath = join(workspaceRoot, KUN_COLAB_CONFIG_FILENAME)
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

const DEFAULT_METRIC_RE =
  /\b(train_loss|val_loss|eval_loss|loss|train_acc|val_acc|eval_acc|accuracy|acc|f1|ppl|lr)\s*[:=]\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi
const EPOCH_RE = /\bepoch\s*(\d+)\s*(?:\/\s*(\d+))?/i

export function parseTrainingStdoutLine(
  line: string,
  currentMetrics: Record<string, ColabMetricPoint[]>,
  customPattern?: string
): {
  updatedMetrics?: Record<string, ColabMetricPoint[]>
  progressSummary?: string
} {
  let updated: Record<string, ColabMetricPoint[]> | undefined
  const regex = customPattern ? new RegExp(customPattern, 'gi') : DEFAULT_METRIC_RE
  const matchedPairs: string[] = []
  for (const match of line.matchAll(regex)) {
    const key = match[1]?.toLowerCase()
    const num = Number(match[2])
    if (!key || !Number.isFinite(num)) continue
    if (!updated) updated = { ...currentMetrics }
    const series = [...(updated[key] ?? [])]
    series.push({ step: series.length + 1, value: num })
    updated[key] = series.slice(-200)
    matchedPairs.push(`${key} ${num}`)
  }

  const epochMatch = EPOCH_RE.exec(line)
  let progressSummary: string | undefined
  if (epochMatch && matchedPairs.length > 0) {
    const ep = epochMatch[2] ? `epoch ${epochMatch[1]} / ${epochMatch[2]}` : `epoch ${epochMatch[1]}`
    progressSummary = `${ep} · ${matchedPairs.slice(0, 3).join(' · ')}`
  } else if (matchedPairs.length > 0) {
    progressSummary = matchedPairs.slice(0, 3).join(' · ')
  } else if (epochMatch && epochMatch[2]) {
    progressSummary = `epoch ${epochMatch[1]} / ${epochMatch[2]}`
  }

  return { updatedMetrics: updated, progressSummary }
}
