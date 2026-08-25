import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { assertSupportedSettingsVersion } from './settings-store-foundation'

/**
 * 一次性把 “DeepSeek GUI” 时代的本地数据搬到 Kun 的新命名下。
 *
 * 设计约束(都来自“老版本必须无痛升级、还要能回滚”):
 *   1. 整目录 rename 而不是逐文件拷贝 —— userData 里有 Chromium 的
 *      Local Storage / IndexedDB / Partitions,半拷贝状态比不迁移更糟。
 *   2. 旧路径留符号链接(Windows 用 junction,无需管理员权限)。这样:
 *        - 设置 / kun sqlite 里残留的旧绝对路径仍然可以解析;
 *        - 用户回滚到老版本时,老版本透过链接复用同一份数据;
 *        - 老版本和新版本透过同一个 userData 抢同一把单实例锁,
 *          不会出现两个进程同时写一份 sqlite。
 *   3. 任何一步失败都要降级成“继续用旧路径”,绝不能让启动失败
 *      或让数据看起来消失。settings 里的路径只在对应目录确实搬走
 *      之后才重写(rewriteSafe 把关)。
 *
 * 这个模块刻意不 import electron,方便在 vitest 里直接注入临时目录测试。
 */

export type MigrationLogger = (message: string, detail?: unknown) => void

/** 旧版 userData 目录名。顺序即优先级:先匹配近期版本用的名字。 */
export const LEGACY_USER_DATA_DIR_NAMES = ['DeepSeek GUI', 'deepseek-gui'] as const

export const LEGACY_HOME_DATA_ROOT = '.deepseekgui'
export const NEW_HOME_DATA_ROOT = '.kun'

export type HomeDataMigrationMapping = {
  /** 相对 home 的旧路径段,如 ['.deepseekgui', 'kun'] */
  legacySegments: readonly string[]
  /** 相对 home 的新路径段,如 ['.kun', 'data'] */
  nextSegments: readonly string[]
}

/**
 * 家目录数据的搬迁映射。只搬这几个我们自己创建的已知目录;
 * 用户手工放进 ~/.deepseekgui 的其它内容原地保留,settings 里
 * 指向它们的路径也不会被重写。
 */
export const HOME_DATA_MIGRATION_MAPPINGS: readonly HomeDataMigrationMapping[] = [
  // kun 运行时数据(sqlite、线程、config.json)。新家叫 data,避免 ~/.kun/kun。
  { legacySegments: [LEGACY_HOME_DATA_ROOT, 'kun'], nextSegments: [NEW_HOME_DATA_ROOT, 'data'] },
  { legacySegments: [LEGACY_HOME_DATA_ROOT, 'default_workspace'], nextSegments: [NEW_HOME_DATA_ROOT, 'default_workspace'] },
  { legacySegments: [LEGACY_HOME_DATA_ROOT, 'claw'], nextSegments: [NEW_HOME_DATA_ROOT, 'claw'] },
  { legacySegments: [LEGACY_HOME_DATA_ROOT, 'write_workspace'], nextSegments: [NEW_HOME_DATA_ROOT, 'write_workspace'] }
] as const

export type HomeMappingOutcome =
  | 'migrated'
  | 'already-linked'
  | 'next-exists'
  | 'skipped-missing'
  | 'failed'

export type HomeDataMigrationResult = {
  mapping: HomeDataMigrationMapping
  legacyPath: string
  nextPath: string
  outcome: HomeMappingOutcome
  /** true = settings 中指向 legacyPath 的字符串可以安全改写成 nextPath。 */
  rewriteSafe: boolean
}

export type UserDataMigrationResult = {
  /** 迁移后应当使用的 userData 路径。 */
  userDataPath: string
  /** 本次启动真的把旧目录搬过来了。 */
  migrated: boolean
  /** rename 失败,需要 app.setPath('userData', userDataPath) 退回旧目录。 */
  usedLegacyFallback: boolean
}

export type LegacyDataMigrationResult = {
  userData: UserDataMigrationResult
  home: HomeDataMigrationResult[]
  settingsRewritten: boolean
}

/** 迁移完成后写进新 userData 的标记文件,只用于排障。 */
export const USER_DATA_MIGRATION_MARKER = '.migrated-from-deepseek-gui.json'

const SETTINGS_FILE_NAME_NEW = 'kun-settings.json'
const SETTINGS_FILE_NAME_LEGACY = 'deepseek-gui-settings.json'

type PathState = 'missing' | 'symlink' | 'dir' | 'other'

function pathState(path: string): PathState {
  try {
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) return 'symlink'
    if (stats.isDirectory()) return 'dir'
    return 'other'
  } catch {
    return 'missing'
  }
}

function noopLog(): void {}

function removeEmptyDirIfPresent(path: string, log: MigrationLogger): boolean {
  if (pathState(path) !== 'dir') return false
  let entries: string[]
  try {
    entries = readdirSync(path)
  } catch {
    return false
  }
  if (entries.length > 0) return false
  try {
    rmdirSync(path)
    return true
  } catch (error) {
    log('legacy-migration: could not remove empty new dir', {
      path,
      message: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

/**
 * 在 legacyPath 留一个指向 targetPath 的目录链接。
 * Windows 上用 junction:普通用户就能创建,且对目录语义等价。
 */
function tryLinkLegacyPath(legacyPath: string, targetPath: string, log: MigrationLogger): boolean {
  try {
    symlinkSync(targetPath, legacyPath, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch (error) {
    log('legacy-migration: failed to create compatibility link', {
      legacyPath,
      targetPath,
      message: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

export function migrateLegacyUserDataDir(input: {
  /** electron app.getPath('userData') —— 已经是新名字(…/Kun)。 */
  userDataPath: string
  legacyDirNames?: readonly string[]
  log?: MigrationLogger
}): UserDataMigrationResult {
  const log = input.log ?? noopLog
  const newPath = input.userDataPath
  const appDataDir = dirname(newPath)
  const newDirName = basename(newPath)
  const legacyNames = (input.legacyDirNames ?? LEGACY_USER_DATA_DIR_NAMES).filter(
    (name) => name !== newDirName
  )

  const keepNew: UserDataMigrationResult = { userDataPath: newPath, migrated: false, usedLegacyFallback: false }

  const newState = pathState(newPath)
  if (newState === 'dir') {
    let entries: string[]
    try {
      entries = readdirSync(newPath)
    } catch {
      return keepNew
    }
    if (entries.length > 0) return keepNew
    // 空目录可能是早先某次启动留下的壳,移掉后允许迁移真正的数据进来。
    try {
      rmdirSync(newPath)
    } catch (error) {
      log('legacy-migration: could not remove empty new userData dir', {
        newPath,
        message: error instanceof Error ? error.message : String(error)
      })
      return keepNew
    }
  } else if (newState !== 'missing') {
    // symlink / 文件:用户自己布置过,尊重现状。
    return keepNew
  }

  for (const legacyName of legacyNames) {
    const legacyPath = join(appDataDir, legacyName)
    if (pathState(legacyPath) !== 'dir') continue

    try {
      renameSync(legacyPath, newPath)
    } catch (error) {
      // 最常见原因:老版本还在运行(Windows 文件锁)。退回旧目录,
      // 一切照旧工作,下次启动再尝试迁移。
      log('legacy-migration: rename of legacy userData failed; staying on legacy dir', {
        legacyPath,
        newPath,
        message: error instanceof Error ? error.message : String(error)
      })
      return { userDataPath: legacyPath, migrated: false, usedLegacyFallback: true }
    }

    try {
      writeFileSync(
        join(newPath, USER_DATA_MIGRATION_MARKER),
        JSON.stringify({ from: legacyPath, at: new Date().toISOString() }, null, 2),
        'utf8'
      )
    } catch {
      // 标记文件只是排障辅助,写失败不影响迁移结果。
    }

    tryLinkLegacyPath(legacyPath, newPath, log)
    log('legacy-migration: migrated userData dir', { from: legacyPath, to: newPath })
    return { userDataPath: newPath, migrated: true, usedLegacyFallback: false }
  }

  return keepNew
}

export function migrateLegacyHomeDataDirs(input: {
  homeDir: string
  mappings?: readonly HomeDataMigrationMapping[]
  log?: MigrationLogger
}): HomeDataMigrationResult[] {
  const log = input.log ?? noopLog
  const mappings = input.mappings ?? HOME_DATA_MIGRATION_MAPPINGS
  const results: HomeDataMigrationResult[] = []

  for (const mapping of mappings) {
    const legacyPath = join(input.homeDir, ...mapping.legacySegments)
    const nextPath = join(input.homeDir, ...mapping.nextSegments)
    const base = { mapping, legacyPath, nextPath }

    const legacyState = pathState(legacyPath)
    if (legacyState === 'symlink') {
      // 之前某次启动已经搬过并留了链接。
      results.push({ ...base, outcome: 'already-linked', rewriteSafe: true })
      continue
    }
    if (legacyState === 'missing' || legacyState === 'other') {
      // 没有旧数据要搬;旧路径即便残留在 settings 里,重写后也只是
      // 让后续 mkdir 落到新位置,不会丢任何东西。
      results.push({ ...base, outcome: 'skipped-missing', rewriteSafe: true })
      continue
    }

    if (pathState(nextPath) === 'dir') {
      removeEmptyDirIfPresent(nextPath, log)
    }

    if (pathState(nextPath) !== 'missing') {
      // 新旧同时存在,无法判断哪份是权威数据,原地都保留。
      // settings 里指向旧路径的字符串保持原样,数据继续可用。
      log('legacy-migration: both legacy and new home dir exist; leaving both untouched', base)
      results.push({ ...base, outcome: 'next-exists', rewriteSafe: false })
      continue
    }

    try {
      mkdirSync(dirname(nextPath), { recursive: true })
      renameSync(legacyPath, nextPath)
    } catch (error) {
      log('legacy-migration: failed to move legacy home dir; keeping legacy path', {
        ...base,
        message: error instanceof Error ? error.message : String(error)
      })
      results.push({ ...base, outcome: 'failed', rewriteSafe: false })
      continue
    }

    if (!tryLinkLegacyPath(legacyPath, nextPath, log)) {
      // 链接建不起来时优先保证旧绝对路径(kun sqlite 里的线程 cwd、
      // 同步出去的 config.json 等)继续有效:把目录搬回去,本机放弃改名。
      try {
        renameSync(nextPath, legacyPath)
        results.push({ ...base, outcome: 'failed', rewriteSafe: false })
        continue
      } catch (error) {
        // 搬不回去:数据已经在新位置,只能靠 settings 重写把引用修正过来。
        log('legacy-migration: could not restore legacy dir after link failure', {
          ...base,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }

    log('legacy-migration: migrated home data dir', { from: legacyPath, to: nextPath })
    results.push({ ...base, outcome: 'migrated', rewriteSafe: true })
  }

  const legacyRoot = join(input.homeDir, LEGACY_HOME_DATA_ROOT)
  if (results.some((r) => r.outcome === 'migrated') && pathState(legacyRoot) === 'dir') {
    try {
      writeFileSync(
        join(legacyRoot, 'MIGRATED.txt'),
        `This data has moved to ~/${NEW_HOME_DATA_ROOT}. The remaining entries are\n` +
          'compatibility links kept so older app versions and stored absolute\n' +
          'paths keep working. Safe to delete once you no longer run the old\n' +
          'DeepSeek GUI builds.\n',
        'utf8'
      )
    } catch {
      // 说明文件写失败无关紧要。
    }
  }

  return results
}

type ReplacementPair = { from: string; to: string }

function addReplacementPair(pairs: ReplacementPair[], from: string, to: string): void {
  if (!from || pairs.some((pair) => pair.from === from && pair.to === to)) return
  pairs.push({ from, to })
}

function buildReplacementPairs(homeDir: string, mappings: readonly HomeDataMigrationMapping[]): ReplacementPair[] {
  const pairs: ReplacementPair[] = []
  for (const mapping of mappings) {
    const legacyAbs = join(homeDir, ...mapping.legacySegments)
    const nextAbs = join(homeDir, ...mapping.nextSegments)
    addReplacementPair(pairs, legacyAbs, nextAbs)
    addReplacementPair(pairs, legacyAbs.replace(/\\/g, '/'), nextAbs.replace(/\\/g, '/'))
    addReplacementPair(pairs, legacyAbs.replace(/\//g, '\\'), nextAbs.replace(/\//g, '\\'))
    // settings 里也可能存的是 ~ 前缀形式(例如 dataDir 的默认值)。
    addReplacementPair(pairs, `~/${mapping.legacySegments.join('/')}`, `~/${mapping.nextSegments.join('/')}`)
    addReplacementPair(pairs, `~\\${mapping.legacySegments.join('\\')}`, `~\\${mapping.nextSegments.join('\\')}`)
  }
  return pairs
}

function rewriteStringValue(value: string, pairs: readonly ReplacementPair[]): string {
  for (const pair of pairs) {
    if (value === pair.from) return pair.to
    if (value.startsWith(pair.from)) {
      const boundary = value.charAt(pair.from.length)
      if (boundary === '/' || boundary === '\\') {
        return pair.to + value.slice(pair.from.length)
      }
    }
  }
  return value
}

function rewriteDeep(value: unknown, pairs: readonly ReplacementPair[]): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    const next = rewriteStringValue(value, pairs)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const result = rewriteDeep(item, pairs)
      changed = changed || result.changed
      return result.value
    })
    return { value: changed ? next : value, changed }
  }
  if (typeof value === 'object' && value !== null) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteDeep(item, pairs)
      changed = changed || result.changed
      next[key] = result.value
    }
    return { value: changed ? next : value, changed }
  }
  return { value, changed: false }
}

/**
 * Read-only startup preflight for the non-Runtime home mappings. It returns
 * true only when the subsequent migration can mutate a directory or rewrite
 * an existing settings document. Permanent compatibility links alone are a
 * completed state and must not restart the Manager on every launch.
 */
export function legacyHomeDataMigrationRequiresExclusiveAccess(input: {
  userDataPath: string
  homeDir: string
  mappings?: readonly HomeDataMigrationMapping[]
}): boolean {
  const mappings = input.mappings ?? HOME_DATA_MIGRATION_MAPPINGS
  const rewriteSafe: HomeDataMigrationMapping[] = []
  for (const mapping of mappings) {
    const legacyPath = join(input.homeDir, ...mapping.legacySegments)
    const nextPath = join(input.homeDir, ...mapping.nextSegments)
    const legacyState = pathState(legacyPath)
    if (legacyState === 'symlink' || legacyState === 'missing' || legacyState === 'other') {
      rewriteSafe.push(mapping)
      continue
    }
    const nextState = pathState(nextPath)
    if (nextState === 'missing') return true
    if (nextState === 'dir') {
      try {
        if (readdirSync(nextPath).length === 0) return true
      } catch {
        // The mutating path also fails closed when the directory is unreadable.
      }
    }
  }
  if (rewriteSafe.length === 0) return false

  const pairs = buildReplacementPairs(input.homeDir, rewriteSafe)
  for (const settingsPath of [
    join(input.userDataPath, SETTINGS_FILE_NAME_NEW),
    join(input.userDataPath, SETTINGS_FILE_NAME_LEGACY)
  ]) {
    const state = pathState(settingsPath)
    if (state !== 'other' && state !== 'symlink') continue
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown
      assertSupportedSettingsVersion(parsed, settingsPath)
      if (rewriteDeep(parsed, pairs).changed) return true
    } catch {
      // Invalid or unreadable settings are left to the settings-store recovery path.
    }
  }
  return false
}

/**
 * 把 settings JSON 里指向已迁移目录的旧路径(绝对路径和 ~ 形式)改写
 * 成新路径。只处理传入的 rewriteSafe 映射;解析失败时不动文件,交给
 * settings-store 既有的 invalid-backup 流程。
 */
export function rewriteLegacyPathsInSettingsFile(input: {
  userDataPath: string
  homeDir: string
  mappings: readonly HomeDataMigrationMapping[]
  log?: MigrationLogger
}): boolean {
  const log = input.log ?? noopLog
  if (input.mappings.length === 0) return false

  const candidates = [
    join(input.userDataPath, SETTINGS_FILE_NAME_NEW),
    join(input.userDataPath, SETTINGS_FILE_NAME_LEGACY)
  ]
  const pairs = buildReplacementPairs(input.homeDir, input.mappings)

  let rewrote = false
  for (const settingsPath of candidates) {
    // lstat 对常规文件返回 'other';missing/dir 跳过,符号链接跟随读取。
    const state = pathState(settingsPath)
    if (state !== 'other' && state !== 'symlink') continue

    let raw: string
    try {
      raw = readFileSync(settingsPath, 'utf8')
    } catch {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      log('legacy-migration: settings file is not valid JSON; skipping path rewrite', { settingsPath })
      continue
    }

    try {
      assertSupportedSettingsVersion(parsed, settingsPath)
    } catch (error) {
      log('legacy-migration: settings schema is newer than this build; skipping path rewrite', {
        settingsPath,
        message: error instanceof Error ? error.message : String(error)
      })
      continue
    }

    const result = rewriteDeep(parsed, pairs)
    if (!result.changed) continue

    try {
      const tmpPath = `${settingsPath}.migration-tmp`
      writeFileSync(tmpPath, JSON.stringify(result.value, null, 2), 'utf8')
      renameSync(tmpPath, settingsPath)
      rewrote = true
      log('legacy-migration: rewrote legacy paths in settings file', { settingsPath })
    } catch (error) {
      log('legacy-migration: failed to write rewritten settings file', {
        settingsPath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  return rewrote
}

/**
 * 启动期一次性迁移入口。必须在 requestSingleInstanceLock() 和一切读写
 * userData 的代码之前调用;内部任何失败都被吞掉并降级,绝不抛出。
 */
export function runLegacyKunDataMigration(input: {
  /** electron 的 app.getPath('userData'),即新命名目录。 */
  userDataPath: string
  homeDir: string
  log?: MigrationLogger
}): LegacyDataMigrationResult {
  const log = input.log ?? noopLog

  let userData: UserDataMigrationResult = {
    userDataPath: input.userDataPath,
    migrated: false,
    usedLegacyFallback: false
  }
  try {
    userData = migrateLegacyUserDataDir({ userDataPath: input.userDataPath, log })
  } catch (error) {
    log('legacy-migration: unexpected userData migration failure', {
      message: error instanceof Error ? error.message : String(error)
    })
  }

  let home: HomeDataMigrationResult[] = []
  try {
    home = migrateLegacyHomeDataDirs({ homeDir: input.homeDir, log })
  } catch (error) {
    log('legacy-migration: unexpected home migration failure', {
      message: error instanceof Error ? error.message : String(error)
    })
  }

  let settingsRewritten = false
  try {
    settingsRewritten = rewriteLegacyPathsInSettingsFile({
      userDataPath: userData.userDataPath,
      homeDir: input.homeDir,
      mappings: home.filter((entry) => entry.rewriteSafe).map((entry) => entry.mapping),
      log
    })
  } catch (error) {
    log('legacy-migration: unexpected settings rewrite failure', {
      message: error instanceof Error ? error.message : String(error)
    })
  }

  return { userData, home, settingsRewritten }
}
