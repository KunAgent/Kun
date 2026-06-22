export type ImportedSkillManifest = {
  id?: string
  name: string
  description?: string
  version: string
  entry: string
  triggers: {
    commands: string[]
    promptPatterns: string[]
    fileTypes: string[]
  }
  allowedTools: string[]
  assets: string[]
  priority: number
}

export type ParsedGitHubSkillUrl = {
  owner: string
  repo: string
  mode: 'repo' | 'tree' | 'blob'
  branch?: string
  path: string
  rawRefPath?: string
}

export type SkillFrontmatter = {
  id?: string
  name?: string
  description?: string
  version?: string
  tools?: string[]
}

export type ParsedSkillFrontmatter = {
  frontmatter: SkillFrontmatter
  body: string
}

export type BuiltKunSkill = {
  manifest: ImportedSkillManifest
  entryContent: string
  dirName: string
}

export type ImportedSkill = BuiltKunSkill & {
  sourcePath: string
  sourceUrl: string
}

type GitHubFetcher = (url: string, init?: RequestInit) => Promise<Response>

type GitHubContentFile = {
  type: 'file'
  name: string
  path: string
  download_url: string | null
}

type GitHubContentDir = {
  type: 'dir'
  name: string
  path: string
}

type GitHubContentEntry = GitHubContentFile | GitHubContentDir

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])

/**
 * The only host we will fetch raw skill file contents from. `download_url`
 * comes back inside the GitHub Contents API JSON and is normally a
 * `raw.githubusercontent.com` link, but a tampered/MITM'd response could point
 * it anywhere — so we never trust it blindly. Anything off this allowlist is
 * discarded in favor of the URL we construct ourselves (SSRF guard).
 */
const RAW_GITHUB_HOST = 'raw.githubusercontent.com'

/**
 * Whether a `download_url` from the GitHub Contents API is safe to fetch:
 * a well-formed https URL whose host is exactly raw.githubusercontent.com.
 */
function isTrustedDownloadUrl(downloadUrl: string | null | undefined): boolean {
  if (!downloadUrl) return false
  let parsed: URL
  try {
    parsed = new URL(downloadUrl)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === RAW_GITHUB_HOST
}

const TOOL_ALIAS_MAP: Record<string, string> = {
  bash: 'bash',
  shell: 'bash',
  command: 'bash',
  commands: 'bash',
  read: 'read',
  readfile: 'read',
  cat: 'read',
  open: 'read',
  ls: 'ls',
  listfiles: 'ls',
  dir: 'ls',
  grep: 'grep',
  search: 'grep',
  find: 'find',
  glob: 'find',
  edit: 'edit',
  patch: 'edit',
  write: 'write',
  writefile: 'write',
  todowrite: 'todo_write',
  todoread: 'todo_read',
  webfetch: 'web_fetch',
  websearch: 'web_search'
}

export function parseGitHubSkillUrl(input: string): ParsedGitHubSkillUrl | null {
  const raw = input.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return null
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const owner = segments[0] ?? ''
  const repo = (segments[1] ?? '').replace(/\.git$/i, '')
  if (!owner || !repo) return null
  if (segments.length === 2) {
    return { owner, repo, mode: 'repo', path: '' }
  }
  const mode = segments[2]
  if (mode !== 'tree' && mode !== 'blob') return null
  const rawRefPath = segments.slice(3).join('/')
  const branch = segments[3]
  const path = segments.slice(4).join('/')
  return {
    owner,
    repo,
    mode,
    branch,
    path,
    rawRefPath
  }
}

export function parseSkillFrontmatter(content: string): ParsedSkillFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content)
  if (!match) {
    return { frontmatter: {}, body: content.trim() }
  }
  const yaml = match[1] ?? ''
  const body = content.slice(match[0].length).trim()
  return {
    frontmatter: parseFrontmatterYaml(yaml),
    body
  }
}

export function mapAllowedTools(rawTools: string[]): string[] {
  const mapped = rawTools
    .map((tool) => {
      const normalized = normalizeToolKey(tool)
      return TOOL_ALIAS_MAP[normalized] ?? normalized
    })
    .filter(Boolean)
  return [...new Set(mapped)]
}

export function buildKunSkill(
  parsed: ParsedSkillFrontmatter,
  meta: {
    defaultName: string
    suggestedDirName?: string
    usedDirNames?: Set<string>
  }
): BuiltKunSkill {
  const name = (parsed.frontmatter.name?.trim() || meta.defaultName.trim() || 'Imported Skill')
  const description = parsed.frontmatter.description?.trim() || firstMarkdownParagraph(parsed.body)
  const dirBase = slug(meta.suggestedDirName || parsed.frontmatter.id || name)
  const dirName = uniqueSlug(dirBase || 'imported-skill', meta.usedDirNames)
  const allowedTools = mapAllowedTools(parsed.frontmatter.tools ?? [])
  const entryContent = parsed.body.trim() || `# ${name}\n`
  const manifest: ImportedSkillManifest = {
    id: slug(parsed.frontmatter.id || name) || dirName,
    name,
    ...(description ? { description } : {}),
    version: parsed.frontmatter.version?.trim() || '0.0.0',
    entry: 'SKILL.md',
    triggers: {
      commands: [],
      promptPatterns: [],
      fileTypes: []
    },
    allowedTools,
    assets: [],
    priority: 0
  }
  return { manifest, entryContent, dirName }
}

export async function importSkillsFromGitHub(
  url: string,
  fetcher: GitHubFetcher = fetch
): Promise<ImportedSkill[]> {
  const parsed = parseGitHubSkillUrl(url)
  if (!parsed) throw new Error('Enter a valid GitHub repository, tree, or blob URL.')
  const target = await resolveGitHubTarget(parsed, fetcher)
  const files = await loadMarkdownFiles(parsed, target, fetcher)
  if (files.length === 0) {
    throw new Error('No markdown skill files were found at the selected GitHub location.')
  }
  const usedDirNames = new Set<string>()
  return files.map((file) => {
    const built = buildKunSkill(parseSkillFrontmatter(file.content), {
      defaultName: titleCase(file.name.replace(/\.md$/i, '')),
      suggestedDirName: suggestedDirNameFromFile(file.path, file.name),
      usedDirNames
    })
    return {
      ...built,
      sourcePath: file.path,
      sourceUrl: file.url
    }
  })
}

function suggestedDirNameFromFile(path: string, name: string): string {
  if (/^skill\.md$/i.test(name)) {
    const segments = path.split('/').filter(Boolean)
    return segments.at(-2) || name.replace(/\.md$/i, '')
  }
  return name.replace(/\.md$/i, '')
}

function parseFrontmatterYaml(yaml: string): SkillFrontmatter {
  const frontmatter: SkillFrontmatter = {}
  const lines = yaml.split(/\r?\n/)
  let activeListKey: keyof SkillFrontmatter | null = null
  for (const line of lines) {
    const listMatch = activeListKey ? /^\s*-\s*(.+?)\s*$/.exec(line) : null
    if (listMatch && activeListKey === 'tools') {
      const current = frontmatter.tools
      const next = stripQuotes(listMatch[1] ?? '').trim()
      if (!next) continue
      if (Array.isArray(current)) {
        current.push(next)
      } else {
        frontmatter.tools = [next]
      }
      continue
    }
    const keyMatch = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (!keyMatch) continue
    const key = keyMatch[1]?.toLowerCase() ?? ''
    const value = keyMatch[2] ?? ''
    activeListKey = null
    if (key === 'tools') {
      if (!value) {
        activeListKey = 'tools'
        frontmatter.tools = []
      } else {
        frontmatter.tools = parseInlineArray(value)
      }
      continue
    }
    if (key === 'name') frontmatter.name = stripQuotes(value).trim() || undefined
    if (key === 'description') frontmatter.description = stripQuotes(value).trim() || undefined
    if (key === 'version') frontmatter.version = stripQuotes(value).trim() || undefined
    if (key === 'id') frontmatter.id = stripQuotes(value).trim() || undefined
  }
  return frontmatter
}

function parseInlineArray(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => stripQuotes(item).trim())
      .filter(Boolean)
  }
  return [stripQuotes(trimmed).trim()].filter(Boolean)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function normalizeToolKey(tool: string): string {
  return tool.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function uniqueSlug(base: string, used?: Set<string>): string {
  if (!used) return base
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  const next = `${base}-${index}`
  used.add(next)
  return next
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  const normalized = markdown
    .replace(/^#.*$/gm, '')
    .split(/\n\s*\n/)
    .map((section) => section.replace(/\s+/g, ' ').trim())
    .find(Boolean)
  return normalized || undefined
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

async function resolveGitHubTarget(
  parsed: ParsedGitHubSkillUrl,
  fetcher: GitHubFetcher
): Promise<{ ref: string; entry: GitHubContentEntry | GitHubContentEntry[] }> {
  if (parsed.mode === 'repo') {
    return resolveContentsWithFallback(parsed.owner, parsed.repo, '', [parsed.branch, 'main', 'master'], fetcher)
  }
  const rawRefPath = parsed.rawRefPath?.split('/').filter(Boolean) ?? []
  if (rawRefPath.length === 0) {
    throw new Error('The GitHub URL is missing a branch or file path.')
  }
  const candidates = parsed.mode === 'blob'
    ? blobCandidates(rawRefPath)
    : treeCandidates(rawRefPath)
  let lastMissing = ''
  for (const candidate of candidates) {
    const resolved = await fetchContents(parsed.owner, parsed.repo, candidate.path, candidate.ref, fetcher)
    if (resolved.kind === 'ok') {
      return { ref: candidate.ref, entry: resolved.entry }
    }
    if (resolved.kind === 'missing') lastMissing = resolved.message
  }
  const fallbacks = parsed.branch ? [parsed.branch, 'main', 'master'] : ['main', 'master']
  return resolveContentsWithFallback(parsed.owner, parsed.repo, parsed.path, fallbacks, fetcher, lastMissing)
}

async function resolveContentsWithFallback(
  owner: string,
  repo: string,
  path: string,
  refs: Array<string | undefined>,
  fetcher: GitHubFetcher,
  lastMissing = ''
): Promise<{ ref: string; entry: GitHubContentEntry | GitHubContentEntry[] }> {
  const tried = new Set<string>()
  for (const ref of refs) {
    const trimmed = ref?.trim()
    if (!trimmed || tried.has(trimmed)) continue
    tried.add(trimmed)
    const resolved = await fetchContents(owner, repo, path, trimmed, fetcher)
    if (resolved.kind === 'ok') return { ref: trimmed, entry: resolved.entry }
    if (resolved.kind === 'missing') lastMissing = resolved.message
  }
  throw new Error(lastMissing || 'The GitHub path could not be resolved on the requested branches.')
}

function blobCandidates(segments: string[]): Array<{ ref: string; path: string }> {
  const out: Array<{ ref: string; path: string }> = []
  for (let index = 1; index < segments.length; index += 1) {
    out.push({
      ref: segments.slice(0, index).join('/'),
      path: segments.slice(index).join('/')
    })
  }
  return out
}

function treeCandidates(segments: string[]): Array<{ ref: string; path: string }> {
  const out: Array<{ ref: string; path: string }> = []
  for (let index = 1; index <= segments.length; index += 1) {
    out.push({
      ref: segments.slice(0, index).join('/'),
      path: segments.slice(index).join('/')
    })
  }
  return out
}

async function fetchContents(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  fetcher: GitHubFetcher
): Promise<
  | { kind: 'ok'; entry: GitHubContentEntry | GitHubContentEntry[] }
  | { kind: 'missing'; message: string }
> {
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`
  const response = await fetcher(
    `${base}${encodedPath ? `/${encodedPath}` : ''}?ref=${encodeURIComponent(ref)}`,
    { headers: { Accept: 'application/vnd.github+json' } }
  )
  if (response.status === 404) {
    return {
      kind: 'missing',
      message: `No GitHub content found for "${owner}/${repo}" at "${path || '/'}" on ref "${ref}".`
    }
  }
  if (!response.ok) {
    throw new Error(await describeHttpError(response, `GitHub contents lookup failed (${response.status})`))
  }
  return {
    kind: 'ok',
    entry: await response.json() as GitHubContentEntry | GitHubContentEntry[]
  }
}

async function loadMarkdownFiles(
  parsed: ParsedGitHubSkillUrl,
  entry: { ref: string; entry: GitHubContentEntry | GitHubContentEntry[] },
  fetcher: GitHubFetcher
): Promise<Array<{ name: string; path: string; url: string; content: string }>> {
  if (Array.isArray(entry.entry)) {
    const markdownFiles = entry.entry.filter((item): item is GitHubContentFile =>
      item.type === 'file' && /\.md$/i.test(item.name)
    )
    const loaded = await Promise.all(markdownFiles.map(async (file) => ({
      name: file.name,
      path: file.path,
      url: file.download_url || githubBlobUrl(parsed.owner, parsed.repo, entry.ref, file.path),
      content: await fetchTextFile(file.download_url, parsed.owner, parsed.repo, entry.ref, file.path, fetcher)
    })))
    return loaded
  }
  if (entry.entry.type !== 'file' || !/\.md$/i.test(entry.entry.name)) {
    return []
  }
  return [{
    name: entry.entry.name,
    path: entry.entry.path,
    url: entry.entry.download_url || githubBlobUrl(parsed.owner, parsed.repo, entry.ref, entry.entry.path),
    content: await fetchTextFile(entry.entry.download_url, parsed.owner, parsed.repo, entry.ref, entry.entry.path, fetcher)
  }]
}

async function fetchTextFile(
  downloadUrl: string | null,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  fetcher: GitHubFetcher
): Promise<string> {
  // Only follow download_url if it points at raw.githubusercontent.com; a
  // tampered Contents API response could otherwise redirect this fetch to an
  // attacker-controlled host (SSRF). Fall back to the URL we build ourselves.
  const url = isTrustedDownloadUrl(downloadUrl)
    ? (downloadUrl as string)
    : githubRawUrl(owner, repo, ref, path)
  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(await describeHttpError(response, `Failed to download GitHub file "${path}"`))
  }
  return (await response.text()).replace(/\r\n/g, '\n')
}

function githubRawUrl(owner: string, repo: string, ref: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodedPath}`
}

function githubBlobUrl(owner: string, repo: string, ref: string, path: string): string {
  return `https://github.com/${owner}/${repo}/blob/${ref}/${path}`
}

async function describeHttpError(response: Response, fallback: string): Promise<string> {
  try {
    const json = await response.json() as { message?: string }
    return json.message ? `${fallback}: ${json.message}` : fallback
  } catch {
    const text = await response.text().catch(() => '')
    return text ? `${fallback}: ${text}` : fallback
  }
}
