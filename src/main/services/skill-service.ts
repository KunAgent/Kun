import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  COMMON_GLOBAL_SKILL_DIRS,
  COMMON_WORKSPACE_SKILL_DIRS,
  type CommonSkillDir
} from '../../shared/skill-dirs'
import { expandHomePath } from './workspace-service'

export type GuiSkillScope = 'project' | 'global'

export type GuiSkillSummary = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: GuiSkillScope
  legacy: boolean
}

export type GuiSkillListResult =
  | { ok: true; skills: GuiSkillSummary[]; validationErrors: Array<{ root: string; message: string }> }
  | { ok: false; message: string }

export type GuiSkillRoot = {
  path: string
  scope: GuiSkillScope
}

export type GuiSkillRootSource = 'common' | 'extra'

export type GuiSkillRootListItem = {
  /** Stable id: a common-directory id (e.g. `global-codex`) or the path for custom dirs. */
  id: string
  /** Value to push into `disabledDirs` to toggle this root off. */
  disableKey: string
  path: string
  scope: GuiSkillScope
  source: GuiSkillRootSource
  /** i18n key for common directories; absent for custom dirs. */
  labelKey?: string
  exists: boolean
  enabled: boolean
  skillCount: number
}

export type GuiSkillRootListResult =
  | { ok: true; roots: GuiSkillRootListItem[] }
  | { ok: false; message: string }

type SkillRootCandidate = {
  id: string
  disableKey: string
  path: string
  scope: GuiSkillScope
  source: GuiSkillRootSource
  labelKey?: string
}

/**
 * Enabled, on-disk skill roots passed to the Kun runtime. Builds the common
 * directory conventions (.agents/.claude/.codex/skills + global equivalents)
 * plus configured extra dirs, drops any the user toggled off, and appends
 * enabled Codex plugin caches. Precedence (earlier wins on duplicate skill
 * id): project commons → global commons → plugin caches → extra dirs.
 */
export async function guiSkillRootsForRuntime(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Promise<GuiSkillRoot[]> {
  if (!settings && !workspaceRootOverride) return []
  const disabled = buildDisabledKeySet(settings)
  const candidates = buildSkillRootCandidates(settings, workspaceRootOverride).filter((candidate) => {
    if (isCandidateDisabled(candidate, disabled)) return false
    // Configured extra dirs are passed through even when absent (the user set
    // them deliberately and Kun tolerates missing roots); common conventions
    // are only included once they actually exist on disk.
    return candidate.source === 'extra' || existsSync(candidate.path)
  })
  const projectCommon = candidates.filter((c) => c.source === 'common' && c.scope === 'project')
  const globalCommon = candidates.filter((c) => c.source === 'common' && c.scope === 'global')
  const extra = candidates.filter((c) => c.source === 'extra')
  const pluginRoots = (await discoverCodexPluginSkillRoots())
    .filter((root) => existsSync(root))
    .filter((root) => !disabled.has(comparablePath(root)))
    .map((path) => ({ path, scope: 'global' as const }))

  return uniqueSkillRoots([
    ...projectCommon.map(toGuiSkillRoot),
    ...globalCommon.map(toGuiSkillRoot),
    ...pluginRoots,
    ...extra.map(toGuiSkillRoot)
  ])
}

/**
 * Full list of detected common skill directories + configured extra dirs for
 * the settings UI, including ones the user disabled or that do not exist yet,
 * annotated with skill counts and enabled state. Codex plugin caches are
 * always-on and intentionally excluded from this user-toggleable list.
 */
export async function listGuiSkillRoots(
  settings: AppSettingsV1,
  workspaceRootOverride?: string
): Promise<GuiSkillRootListResult> {
  try {
    const disabled = buildDisabledKeySet(settings)
    const candidates = collapseCandidatesForDisplay(
      buildSkillRootCandidates(settings, workspaceRootOverride)
    )
    const roots = await Promise.all(
      candidates.map(async (candidate): Promise<GuiSkillRootListItem> => {
        const exists = existsSync(candidate.path)
        const skillCount = exists ? await countSkillPackages(candidate.path) : 0
        return {
          id: candidate.id,
          disableKey: candidate.disableKey,
          path: candidate.path,
          scope: candidate.scope,
          source: candidate.source,
          ...(candidate.labelKey ? { labelKey: candidate.labelKey } : {}),
          exists,
          enabled: !isCandidateDisabled(candidate, disabled),
          skillCount
        }
      })
    )
    return { ok: true, roots }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

/**
 * Comparable paths of every GUI-managed candidate (common dirs + extra dirs),
 * regardless of enabled state. Lets the runtime config builder tell apart
 * roots it manages (and may need to drop when toggled off) from roots a user
 * added by hand to the Kun config file.
 */
export function guiSkillManagedComparablePaths(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): Set<string> {
  const paths = buildSkillRootCandidates(settings, workspaceRootOverride)
    .map((candidate) => comparablePath(candidate.path))
    .filter(Boolean)
  return new Set(paths)
}

function buildSkillRootCandidates(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): SkillRootCandidate[] {
  const workspaceRoots = collectWorkspaceRoots(settings, workspaceRootOverride)
  const home = homedir()
  const commonDir = (dir: CommonSkillDir, base: string): SkillRootCandidate => ({
    id: dir.id,
    disableKey: dir.id,
    path: normalizeSkillRootPath(join(base, dir.relativePath)),
    scope: dir.scope,
    source: 'common',
    labelKey: dir.labelKey
  })
  const projectCandidates = workspaceRoots.flatMap((workspaceRoot) =>
    COMMON_WORKSPACE_SKILL_DIRS.map((dir) => commonDir(dir, workspaceRoot))
  )
  const globalCandidates = COMMON_GLOBAL_SKILL_DIRS.map((dir) => commonDir(dir, home))
  const extraCandidates = uniqueStrings(
    [
      ...(settings?.claw.skills.extraDirs ?? []),
      ...(settings?.schedule.skills.extraDirs ?? [])
    ]
      .map(normalizeSkillRootPath)
      .filter(Boolean)
  ).map((path): SkillRootCandidate => ({
    id: path,
    disableKey: path,
    path,
    scope: scopeForConfiguredRoot(path, workspaceRoots),
    source: 'extra'
  }))

  return dedupeCandidatesByPath([...projectCandidates, ...globalCandidates, ...extraCandidates])
}

function collectWorkspaceRoots(
  settings: AppSettingsV1 | undefined,
  workspaceRootOverride?: string
): string[] {
  return uniqueStrings([
    workspaceRootOverride,
    settings?.workspaceRoot,
    settings?.claw.im.workspaceRoot,
    settings?.schedule.defaultWorkspaceRoot,
    ...(settings?.claw.channels.map((channel) => channel.workspaceRoot) ?? []),
    ...(settings?.claw.tasks.map((task) => task.workspaceRoot) ?? []),
    ...(settings?.schedule.tasks.map((task) => task.workspaceRoot) ?? [])
  ].map(normalizeSkillRootPath).filter(Boolean))
}

function buildDisabledKeySet(settings: AppSettingsV1 | undefined): Set<string> {
  const set = new Set<string>()
  for (const entry of [
    ...(settings?.claw.skills.disabledDirs ?? []),
    ...(settings?.schedule.skills.disabledDirs ?? [])
  ]) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    set.add(trimmed)
    set.add(comparablePath(trimmed))
  }
  return set
}

function isCandidateDisabled(candidate: SkillRootCandidate, disabled: Set<string>): boolean {
  return disabled.has(candidate.id) || disabled.has(comparablePath(candidate.path))
}

function toGuiSkillRoot(candidate: SkillRootCandidate): GuiSkillRoot {
  return { path: candidate.path, scope: candidate.scope }
}

function dedupeCandidatesByPath(candidates: SkillRootCandidate[]): SkillRootCandidate[] {
  const seen = new Set<string>()
  const out: SkillRootCandidate[] = []
  for (const candidate of candidates) {
    const key = comparablePath(candidate.path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

/**
 * Collapse per-workspace duplicates of the same common convention to a single
 * row for the settings list (the active workspace, listed first, wins). Custom
 * dirs and global dirs already have unique keys. Drops unresolved paths.
 */
function collapseCandidatesForDisplay(candidates: SkillRootCandidate[]): SkillRootCandidate[] {
  const seen = new Set<string>()
  const out: SkillRootCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate.path) continue
    const key = candidate.source === 'common' ? candidate.id : comparablePath(candidate.path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

async function countSkillPackages(root: string): Promise<number> {
  return (await packageCandidates(root).catch(() => [])).length
}

export async function listGuiSkills(
  settings: AppSettingsV1,
  workspaceRootOverride?: string
): Promise<GuiSkillListResult> {
  try {
    const roots = await guiSkillRootsForRuntime(settings, workspaceRootOverride)
    const skills: GuiSkillSummary[] = []
    const validationErrors: Array<{ root: string; message: string }> = []
    for (const root of roots) {
      const candidates = await packageCandidates(root.path).catch((error) => {
        validationErrors.push({ root: root.path, message: errorMessage(error) })
        return []
      })
      for (const candidate of candidates) {
        const loaded = await loadSkillSummary(candidate, root.scope).catch((error) => {
          validationErrors.push({ root: candidate, message: errorMessage(error) })
          return null
        })
        if (loaded) skills.push(loaded)
      }
    }
    return {
      ok: true,
      skills: dedupeSkills(skills),
      validationErrors
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

export function normalizeSkillRootPath(path: string | undefined): string {
  const trimmed = path?.trim() ?? ''
  if (!trimmed) return ''
  return resolve(expandHomePath(trimmed))
}

async function discoverCodexPluginSkillRoots(): Promise<string[]> {
  const roots: string[] = []
  await collectSkillRoots(join(homedir(), '.codex', 'plugins', 'cache'), roots, 0, 5)
  return roots
}

async function collectSkillRoots(root: string, roots: string[], depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth || !existsSync(root)) return
  if (basename(root) === 'skills' && skillRootHasPackages(root)) {
    roots.push(root)
    return
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => collectSkillRoots(join(root, entry.name), roots, depth + 1, maxDepth)))
}

function skillRootHasPackages(root: string): boolean {
  if (existsSync(join(root, 'SKILL.md')) || existsSync(join(root, 'skill.json'))) return true
  try {
    return readdirSync(root, { withFileTypes: true }).some((entry) =>
      entryIsDirectorySync(entry, join(root, entry.name)) &&
      (existsSync(join(root, entry.name, 'SKILL.md')) || existsSync(join(root, entry.name, 'skill.json')))
    )
  } catch {
    return false
  }
}

async function packageCandidates(root: string): Promise<string[]> {
  const candidates = new Set<string>()
  if (existsSync(join(root, 'skill.json')) || existsSync(join(root, 'SKILL.md'))) {
    candidates.add(root)
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const dir = join(root, entry.name)
    if (!(await entryIsDirectory(entry, dir))) continue
    if (existsSync(join(dir, 'skill.json')) || existsSync(join(dir, 'SKILL.md'))) {
      candidates.add(dir)
    }
  }
  return [...candidates]
}

/**
 * Whether a directory entry is — or resolves to — a directory. `readdir`/
 * `readdirSync` with `withFileTypes` describe the link itself, so a symlinked
 * skill package (e.g. the per-skill links `cc switch` drops into
 * `.claude/skills`) reports `isDirectory() === false` and would be skipped.
 * Follow such links via `stat` so those packages are still discovered. Also
 * covers filesystems that report an unknown `d_type`. (#320)
 */
async function entryIsDirectory(entry: Dirent, path: string): Promise<boolean> {
  if (entry.isDirectory()) return true
  if (entry.isFile()) return false
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function entryIsDirectorySync(entry: Dirent, path: string): boolean {
  if (entry.isDirectory()) return true
  if (entry.isFile()) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

async function loadSkillSummary(root: string, scope: GuiSkillScope): Promise<GuiSkillSummary | null> {
  const manifestPath = join(root, 'skill.json')
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    const name = stringValue(manifest.name) || titleFromSlug(basename(root))
    const entry = assertSafeEntryName(stringValue(manifest.entry) || 'SKILL.md', root)
    return {
      id: slug(stringValue(manifest.id) || name || basename(root)),
      name,
      ...(stringValue(manifest.description) ? { description: stringValue(manifest.description) } : {}),
      root,
      entryPath: join(root, entry),
      scope,
      legacy: false
    }
  }
  const entryPath = join(root, 'SKILL.md')
  if (!existsSync(entryPath)) return null
  const content = await readFile(entryPath, 'utf8')
  const frontmatter = readFrontmatter(content)
  const name = displaySkillName(frontmatter.name, basename(root))
  return {
    id: slug(frontmatter.id || basename(root)),
    name,
    ...(frontmatter.description ? { description: frontmatter.description } : {}),
    root,
    entryPath,
    scope,
    legacy: true
  }
}

/**
 * Guard against path traversal via a crafted `skill.json` `entry` field. The
 * entry is joined onto the skill root and read from disk, so a value like
 * `../../etc/passwd` or `nested/file` could escape the package directory. We
 * require a plain filename: no path separators (POSIX or Windows), no `..`,
 * and `basename(entry) === entry`. On violation we throw so the caller records
 * a validation error and skips the skill rather than reading outside root.
 */
function assertSafeEntryName(entry: string, root: string): string {
  const hasSeparator = entry.includes('/') || entry.includes('\\')
  if (!entry || hasSeparator || entry.includes('..') || basename(entry) !== entry) {
    throw new Error(`Unsafe skill entry "${entry}" in ${join(root, 'skill.json')}`)
  }
  return entry
}

function readFrontmatter(content: string): { id?: string; name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!match) return { description: firstMarkdownParagraph(content) }
  const yaml = match[1] ?? ''
  return {
    id: frontmatterString(yaml, 'id'),
    name: frontmatterString(yaml, 'name'),
    description: frontmatterString(yaml, 'description') || firstMarkdownParagraph(content.slice(match[0].length))
  }
}

function frontmatterString(yaml: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(yaml)
  return match ? stripQuotes(match[1] ?? '').trim() || undefined : undefined
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/^#+\s*/, '').trim())
    .find(Boolean)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function titleFromSlug(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function displaySkillName(frontmatterName: string | undefined, folderName: string): string {
  const value = frontmatterName?.trim() ?? ''
  if (!value) return titleFromSlug(folderName)
  return /^[a-z0-9][a-z0-9_-]*$/i.test(value) ? titleFromSlug(value) : value
}

function slug(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'skill'
}

function dedupeSkills(skills: GuiSkillSummary[]): GuiSkillSummary[] {
  const unique = new Map<string, GuiSkillSummary>()
  for (const skill of skills.sort(compareSkillSummary)) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill)
  }
  return [...unique.values()]
}

function compareSkillSummary(a: GuiSkillSummary, b: GuiSkillSummary): number {
  if (a.scope !== b.scope) return a.scope === 'project' ? -1 : 1
  return a.name.localeCompare(b.name)
}

function scopeForConfiguredRoot(path: string, workspaceRoots: string[]): GuiSkillScope {
  const comparable = comparablePath(path)
  return workspaceRoots.some((workspaceRoot) => {
    const workspace = comparablePath(workspaceRoot)
    return comparable === workspace || comparable.startsWith(`${workspace}/`)
  }) ? 'project' : 'global'
}

function uniqueSkillRoots(roots: GuiSkillRoot[]): GuiSkillRoot[] {
  const seen = new Set<string>()
  const out: GuiSkillRoot[] = []
  for (const root of roots) {
    const key = comparablePath(root.path)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(root)
  }
  return out
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function comparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
}

/** Public form of {@link comparablePath} so callers can match against {@link guiSkillManagedComparablePaths}. */
export function comparableSkillRootPath(path: string): string {
  return comparablePath(path)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
