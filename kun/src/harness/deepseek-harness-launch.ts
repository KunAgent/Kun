import { lstat, mkdtemp, open, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEEPSEEK_HARNESS_ID } from './deepseek-harness-definition.js'

/**
 * Privacy policy for the reviewed dsh-v0.2.0-rc.2 composition. The environment
 * opt-out only covers OTel, not DeepSeek's independent session-log upload.
 * Upstream applies --patch overlays after profile AND home-level patches.
 */
export const DEEPSEEK_HARNESS_PRIVACY_PATCH = [
  '# Kun-managed DeepSeek Harness privacy policy. Must be the final overlay.',
  ...['session-log-deepseek', 'session-telemetry-otel', 'otel', 'hmr'].flatMap((id) =>
    [`- id: ${id}`, '  disabled: true']),
  ''
].join('\n')

const STOCK_ACP_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app']
const MAX_CONFIG_BYTES = 64 * 1024
let privacyPatch: Promise<string> | undefined

export type DeepSeekHarnessLaunch = {
  harnessId?: string
  command: string
  args?: readonly string[]
  env?: Record<string, string>
  secretEnv?: Record<string, string>
  credentialEnv?: Record<string, string>
}

export function isDeepSeekHarnessLaunch(input: Pick<DeepSeekHarnessLaunch, 'harnessId' | 'command'>): boolean {
  return input.harnessId === DEEPSEEK_HARNESS_ID ||
    /(?:^|[/\\])dsh(?:\.cmd|\.exe|\.bat)?$/i.test(input.command)
}

function unsafeComposition(): Error {
  return new Error('DeepSeek Harness Preview requires the stock ACP profile without custom bundles, plugins, or patches. Use an unmodified ACP profile and retry.')
}

async function metadata(path: string) {
  try { return await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw unsafeComposition()
  }
}

async function readConfig(path: string): Promise<string | undefined> {
  const stat = await metadata(path)
  if (!stat) return undefined
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CONFIG_BYTES) throw unsafeComposition()
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_CONFIG_BYTES) throw unsafeComposition()
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally { await file.close() }
}

/** Never evaluate YAML/JS or load plugins just to decide whether it is safe. */
function emptyPatch(value: string | undefined): boolean {
  if (value === undefined) return true
  const content = value.split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter(Boolean).join('')
  return content === '' || content === '[]'
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Id-based disable patches cannot constrain arbitrary plugin code or a second
 * exporter inserted under another id. This Preview accepts only the pinned
 * stock bundles and empty user layers; custom composition fails before spawn.
 * Credentials/settings stay in the native DSH home and are never read here.
 */
export async function validateDeepSeekHarnessProfile(home: string): Promise<void> {
  const profile = join(home, 'profiles', 'acp')
  for (const directory of [home, join(home, 'profiles'), profile]) {
    const stat = await metadata(directory)
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw unsafeComposition()
  }
  if (await metadata(join(profile, 'node_modules'))) throw unsafeComposition()
  for (const path of [join(home, 'cordis.patch.yml'), join(profile, 'cordis.patch.yml')]) {
    if (!emptyPatch(await readConfig(path))) throw unsafeComposition()
  }
  const source = await readConfig(join(profile, 'package.json'))
  if (source === undefined) return // Upstream creates the stock profile on first launch.
  let manifest: unknown
  try { manifest = JSON.parse(source) } catch { throw unsafeComposition() }
  if (!record(manifest) || !record(manifest.dsh) || !record(manifest.dsh.profile)) throw unsafeComposition()
  if (JSON.stringify(manifest.dsh.profile.bundles) !== JSON.stringify(STOCK_ACP_BUNDLES)) throw unsafeComposition()
  if (Object.keys(manifest.dsh).some((key) => key !== 'profile') ||
      Object.keys(manifest.dsh.profile).some((key) => key !== 'bundles')) throw unsafeComposition()
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'scripts', 'imports', 'exports']) {
    if (manifest[key] !== undefined && (!record(manifest[key]) || Object.keys(manifest[key]).length > 0)) throw unsafeComposition()
  }
}

async function policyPath(): Promise<string> {
  privacyPatch ??= (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-dsh-privacy-'))
    const path = join(directory, 'privacy.patch.yml')
    await writeFile(path, DEEPSEEK_HARNESS_PRIVACY_PATCH, { mode: 0o600, flag: 'wx' })
    return path
  })().catch((error) => { privacyPatch = undefined; throw error })
  return privacyPatch
}

function forcePrivacyEnv(env: Record<string, string> = {}, home: string): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) =>
      !['DSH_HOME', 'DSH_TELEMETRY_DISABLED', 'DSH_TELEMETRY_MODE'].includes(key.toUpperCase()))),
    DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED'
  }
}

/** Apply before version detection, initialize, model probes, and turn launch. */
export async function prepareDeepSeekHarnessLaunch<T extends DeepSeekHarnessLaunch>(
  input: T,
  deps: { baseEnv?: Record<string, string | undefined> } = {}
): Promise<T> {
  if (!isDeepSeekHarnessLaunch(input)) return input
  const env = Object.fromEntries(Object.entries({ ...(deps.baseEnv ?? process.env), ...input.env, ...input.secretEnv, ...input.credentialEnv })
    .map(([key, value]) => [key.toUpperCase(), value]))
  // Node preload hooks can execute arbitrary code before the privacy policy.
  if (Object.entries(env).some(([key, value]) => key.toUpperCase() === 'NODE_OPTIONS' && value?.trim())) {
    throw unsafeComposition()
  }
  const homeValue = env.DSH_HOME?.trim()
  const expanded = !homeValue ? join(homedir(), '.dsh')
    : homeValue === '~' ? homedir()
      : /^~[/\\]/.test(homeValue) ? join(homedir(), homeValue.slice(2)) : homeValue
  // An absolute DSH_HOME gives probes and real workspace launches the same profile.
  const home = resolve(expanded)
  await validateDeepSeekHarnessProfile(home)
  const patch = await policyPath()
  const args = [...input.args ?? []]
  // Calling the helper twice is harmless; arbitrary caller overlays are not.
  if (args.at(-2) === '--patch' && args.at(-1) === patch) args.splice(-2)
  const versionProbe = args.length === 1 && ['--version', '-V'].includes(args[0]!)
  const stockProfile = (args.length === 1 && args[0] === 'acp') ||
    (args.length === 2 && args[0] === '--profile' && args[1] === 'acp')
  if (!versionProbe && !stockProfile) throw unsafeComposition()
  return {
    ...input,
    args: [...args, '--patch', patch],
    env: forcePrivacyEnv(input.env, home),
    // Both are applied after plain env by the process host. Neither can opt in.
    ...(input.secretEnv ? { secretEnv: forcePrivacyEnv(input.secretEnv, home) } : {}),
    ...(input.credentialEnv ? { credentialEnv: forcePrivacyEnv(input.credentialEnv, home) } : {})
  }
}
