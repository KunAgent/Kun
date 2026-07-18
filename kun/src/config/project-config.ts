import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  stat,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  McpOAuthConfig,
  McpTransportKind
} from '../contracts/capabilities.js'

export const KUN_PROJECT_CONFIG_RELATIVE_PATH = '.kun/project.json'
export const KUN_PROJECT_CONFIG_VERSION = 1
export const MAX_KUN_PROJECT_CONFIG_BYTES = 256 * 1024
export const MAX_KUN_PROJECT_MCP_SERVERS = 32
export const MAX_KUN_PROJECT_SKILL_ROOTS = 32

const RelativeProjectPath = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine((value) => !isAbsolute(value), {
    message: 'project paths must be relative to the workspace'
  })

const BoundedStringRecord = z
  .record(z.string().min(1).max(256), z.string().max(16_384))
  .refine((record) => Object.keys(record).length <= 64, {
    message: 'record contains too many entries'
  })

export const KunProjectMcpServerConfig = z
  .object({
    enabled: z.boolean().default(true),
    transport: McpTransportKind,
    command: z.string().trim().min(1).max(4_096).optional(),
    args: z.array(z.string().max(16_384)).max(64).default([]),
    cwd: RelativeProjectPath.optional(),
    url: z.string().trim().min(1).max(16_384).optional(),
    headers: BoundedStringRecord.default({}),
    env: BoundedStringRecord.default({}),
    oauth: McpOAuthConfig.optional(),
    timeoutMs: z.number().int().positive().max(10 * 60_000).default(30_000)
  })
  .strict()
  .superRefine((server, ctx) => {
    if (server.transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'stdio MCP servers require command'
      })
    }
    if (server.transport !== 'stdio' && server.cwd) {
      ctx.addIssue({
        code: 'custom',
        path: ['cwd'],
        message: 'only stdio MCP servers may configure cwd'
      })
    }
    if ((server.transport === 'streamable-http' || server.transport === 'sse') && !server.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `${server.transport} MCP servers require url`
      })
    }
    if (server.url) {
      try {
        const parsed = new URL(server.url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          ctx.addIssue({
            code: 'custom',
            path: ['url'],
            message: 'MCP server url must use http or https'
          })
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP server url must be a valid URL'
        })
      }
    }
  })
export type KunProjectMcpServerConfig = z.infer<typeof KunProjectMcpServerConfig>

export const KunProjectConfigSchema = z
  .object({
    $schema: z.string().trim().min(1).max(4_096).optional(),
    version: z.literal(KUN_PROJECT_CONFIG_VERSION),
    mcp: z
      .object({
        servers: z
          .record(z.string().trim().min(1).max(128), KunProjectMcpServerConfig)
          .refine((servers) => Object.keys(servers).length <= MAX_KUN_PROJECT_MCP_SERVERS, {
            message: `project MCP config supports at most ${MAX_KUN_PROJECT_MCP_SERVERS} servers`
          })
          .default({})
      })
      .strict()
      .default({ servers: {} }),
    skills: z
      .object({
        enabled: z.boolean().default(true),
        includeConventional: z.boolean().default(true),
        roots: z.array(RelativeProjectPath).max(MAX_KUN_PROJECT_SKILL_ROOTS).default([]),
        disabledIds: z.array(z.string().trim().min(1).max(128)).max(256).default([])
      })
      .strict()
      .default({
        enabled: true,
        includeConventional: true,
        roots: [],
        disabledIds: []
      })
  })
  .strict()
export type KunProjectConfig = z.infer<typeof KunProjectConfigSchema>

export type ResolvedKunProjectConfig = {
  workspaceRoot: string
  path: string
  digest: string
  config: KunProjectConfig
  mcp: {
    servers: Record<string, KunProjectMcpServerConfig & { cwd?: string }>
  }
  skills: {
    enabled: boolean
    includeConventional: boolean
    roots: string[]
    disabledIds: string[]
  }
}

export type KunProjectConfigLoadResult =
  | {
      status: 'missing'
      workspaceRoot: string
      path: string
    }
  | {
      status: 'invalid'
      workspaceRoot: string
      path: string
      message: string
    }
  | ({ status: 'valid' } & ResolvedKunProjectConfig)

export type KunProjectConfigSource = {
  workspaceRoot: string
  path: string
  exists: boolean
  content: string
}

export function kunProjectConfigPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), '.kun', 'project.json')
}

export function kunProjectConfigDigest(config: KunProjectConfig): string {
  return createHash('sha256')
    .update(stableJson(config))
    .digest('hex')
}

export async function parseAndResolveKunProjectConfig(
  workspaceRoot: string,
  value: unknown,
  path = kunProjectConfigPath(workspaceRoot)
): Promise<ResolvedKunProjectConfig> {
  const resolvedWorkspaceRoot = await resolveRealWorkspaceRoot(workspaceRoot)
  const parsed = KunProjectConfigSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(projectConfigValidationMessage(value, parsed.error.issues))
  }
  const config = parsed.data
  const skillRoots = config.skills.enabled
    ? await Promise.all(config.skills.roots.map((root) =>
        resolveContainedProjectDirectory(resolvedWorkspaceRoot, root, 'Skill root')
      ))
    : []
  const servers: ResolvedKunProjectConfig['mcp']['servers'] = {}
  for (const [serverId, server] of Object.entries(config.mcp.servers)) {
    const cwd = server.transport === 'stdio'
      ? server.cwd
        ? await resolveContainedProjectDirectory(resolvedWorkspaceRoot, server.cwd, `MCP server ${serverId} cwd`)
        : resolvedWorkspaceRoot
      : undefined
    servers[serverId] = {
      ...server,
      ...(cwd ? { cwd } : {})
    }
  }
  return {
    workspaceRoot: resolvedWorkspaceRoot,
    path,
    digest: kunProjectConfigDigest(config),
    config,
    mcp: { servers },
    skills: {
      enabled: config.skills.enabled,
      includeConventional: config.skills.includeConventional,
      roots: skillRoots,
      disabledIds: [...config.skills.disabledIds]
    }
  }
}

export async function loadKunProjectConfig(
  workspaceRoot: string
): Promise<KunProjectConfigLoadResult> {
  let resolvedWorkspaceRoot: string
  try {
    resolvedWorkspaceRoot = await resolveRealWorkspaceRoot(workspaceRoot)
  } catch (error) {
    return {
      status: 'invalid',
      workspaceRoot: resolve(workspaceRoot),
      path: kunProjectConfigPath(workspaceRoot),
      message: errorMessage(error)
    }
  }
  const path = kunProjectConfigPath(resolvedWorkspaceRoot)
  let resolvedPath: string
  try {
    resolvedPath = await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing', workspaceRoot: resolvedWorkspaceRoot, path }
    }
    return {
      status: 'invalid',
      workspaceRoot: resolvedWorkspaceRoot,
      path,
      message: errorMessage(error)
    }
  }
  if (!isSameOrInside(resolvedWorkspaceRoot, resolvedPath)) {
    return {
      status: 'invalid',
      workspaceRoot: resolvedWorkspaceRoot,
      path,
      message: 'project config resolves outside the workspace'
    }
  }
  try {
    const text = await readBoundedRegularFile(resolvedPath, MAX_KUN_PROJECT_CONFIG_BYTES)
    const value = JSON.parse(text) as unknown
    const resolved = await parseAndResolveKunProjectConfig(resolvedWorkspaceRoot, value, path)
    return { status: 'valid', ...resolved }
  } catch (error) {
    return {
      status: 'invalid',
      workspaceRoot: resolvedWorkspaceRoot,
      path,
      message: errorMessage(error)
    }
  }
}

export async function readKunProjectConfigSource(
  workspaceRoot: string
): Promise<KunProjectConfigSource> {
  const resolvedWorkspaceRoot = await resolveRealWorkspaceRoot(workspaceRoot)
  const path = kunProjectConfigPath(resolvedWorkspaceRoot)
  let resolvedPath: string
  try {
    resolvedPath = await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        workspaceRoot: resolvedWorkspaceRoot,
        path,
        exists: false,
        content: ''
      }
    }
    throw error
  }
  if (!isSameOrInside(resolvedWorkspaceRoot, resolvedPath)) {
    throw new Error('project config resolves outside the workspace')
  }
  return {
    workspaceRoot: resolvedWorkspaceRoot,
    path,
    exists: true,
    content: await readBoundedRegularFile(resolvedPath, MAX_KUN_PROJECT_CONFIG_BYTES)
  }
}

export async function validateKunProjectConfigText(
  workspaceRoot: string,
  content: string
): Promise<ResolvedKunProjectConfig> {
  if (Buffer.byteLength(content, 'utf8') > MAX_KUN_PROJECT_CONFIG_BYTES) {
    throw new Error(`project config exceeds ${MAX_KUN_PROJECT_CONFIG_BYTES} byte limit`)
  }
  let value: unknown
  try {
    value = JSON.parse(content) as unknown
  } catch (error) {
    throw new Error(`project config must be JSON: ${errorMessage(error)}`)
  }
  return parseAndResolveKunProjectConfig(workspaceRoot, value)
}

export async function writeKunProjectConfig(
  workspaceRoot: string,
  content: string
): Promise<ResolvedKunProjectConfig> {
  const validated = await validateKunProjectConfigText(workspaceRoot, content)
  const configDir = join(validated.workspaceRoot, '.kun')
  await ensureContainedProjectConfigDirectory(validated.workspaceRoot, configDir)
  const target = join(configDir, 'project.json')
  try {
    const targetStat = await lstat(target)
    if (targetStat.isSymbolicLink()) throw new Error('project config file must not be a symbolic link')
    if (!targetStat.isFile()) throw new Error('project config path must be a regular file')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const temporary = join(configDir, `.project.json.${process.pid}.${randomUUID()}.tmp`)
  let handle: FileHandle | undefined
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, target)
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
  }
  return { ...validated, path: target }
}

export async function ensureKunProjectConfigDirectory(
  workspaceRoot: string
): Promise<string> {
  const resolvedWorkspaceRoot = await resolveRealWorkspaceRoot(workspaceRoot)
  const configDir = join(resolvedWorkspaceRoot, '.kun')
  await ensureContainedProjectConfigDirectory(resolvedWorkspaceRoot, configDir)
  return await realpath(configDir)
}

async function resolveRealWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const trimmed = workspaceRoot.trim()
  if (!trimmed || !isAbsolute(trimmed)) {
    throw new Error('workspace root must be an absolute path')
  }
  const resolved = await realpath(trimmed)
  const workspaceStat = await stat(resolved)
  if (!workspaceStat.isDirectory()) throw new Error('workspace root must be a directory')
  return resolved
}

async function resolveContainedProjectDirectory(
  workspaceRoot: string,
  relativePath: string,
  label: string
): Promise<string> {
  if (isAbsolute(relativePath)) throw new Error(`${label} must be relative to the workspace`)
  const lexical = resolve(workspaceRoot, relativePath)
  if (!isSameOrInside(workspaceRoot, lexical)) {
    throw new Error(`${label} escapes the workspace: ${relativePath}`)
  }
  const resolvedPath = await realpath(lexical).catch((error) => {
    throw new Error(`${label} does not resolve to an existing directory: ${relativePath} (${errorMessage(error)})`)
  })
  if (!isSameOrInside(workspaceRoot, resolvedPath)) {
    throw new Error(`${label} resolves outside the workspace: ${relativePath}`)
  }
  if (!(await stat(resolvedPath)).isDirectory()) {
    throw new Error(`${label} must resolve to a directory: ${relativePath}`)
  }
  return resolvedPath
}

async function ensureContainedProjectConfigDirectory(
  workspaceRoot: string,
  configDir: string
): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const resolvedDir = await realpath(configDir)
  if (!isSameOrInside(workspaceRoot, resolvedDir)) {
    throw new Error('project config directory resolves outside the workspace')
  }
  if (!(await stat(resolvedDir)).isDirectory()) {
    throw new Error('project config directory must be a directory')
  }
}

async function readBoundedRegularFile(path: string, maxBytes: number): Promise<string> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, constants.O_RDONLY)
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) throw new Error('project config must be a regular file')
    if (fileStat.size > maxBytes) throw new Error(`project config exceeds ${maxBytes} byte limit`)
    const buffer = Buffer.allocUnsafe(maxBytes + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > maxBytes) throw new Error(`project config exceeds ${maxBytes} byte limit`)
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    if (handle) await handle.close().catch(() => undefined)
  }
}

function projectConfigValidationMessage(
  value: unknown,
  issues: readonly z.core.$ZodIssue[]
): string {
  if (isObject(value) && value.version !== undefined && value.version !== KUN_PROJECT_CONFIG_VERSION) {
    return `unsupported project config version: ${String(value.version)}`
  }
  return `invalid project config: ${issues.map((issue) => {
    const path = issue.path.length ? `${issue.path.join('.')}: ` : ''
    return `${path}${issue.message}`
  }).join('; ')}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isSameOrInside(parent: string, target: string): boolean {
  const rel = relative(parent, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
