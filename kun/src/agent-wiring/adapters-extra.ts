import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { displayName, safeJson, safeYaml, v1, xdgConfig } from './adapter-helpers.js'
import { getTomlTable, getTomlTopLevel, listTomlTables, tomlTableName } from './edit/toml.js'
import { readFileText } from './engine.js'
import type { AgentAdapter, GatewayModelInfo, WiringContext, WiringEdit } from './types.js'

/**
 * Second batch of agents: Goose, Continue, Aider and Kimi Code. Formats follow
 * each agent's documented config; anything outside Kun's keys stays the user's.
 */
const KUN = 'kun'
export const OWNED_SUFFIX = ' [Kun]'

const gooseConfigDir = (ctx: WiringContext): string => ctx.platform === 'win32'
  ? join(ctx.env.APPDATA?.trim() || join(ctx.home, 'AppData', 'Roaming'), 'Block', 'goose', 'config')
  : join(xdgConfig(ctx), 'goose')

/** Goose: GOOSE_PROVIDER/GOOSE_MODEL in config.yaml plus a declarative provider file Kun owns. */
const goose: AgentAdapter = {
  id: 'goose',
  name: 'Goose',
  protocol: 'chat',
  homepage: 'https://block.github.io/goose/',
  bins: ['goose'],
  files: (ctx) => ({ config: join(gooseConfigDir(ctx), 'config.yaml'), provider: join(gooseConfigDir(ctx), 'custom_providers', `${KUN}.json`) }),
  configDirs: (ctx) => [gooseConfigDir(ctx)],
  efforts: [],
  restartRequired: true,
  keepsModelList: true,
  edits(ctx, target) {
    const files = this.files(ctx)
    const provider: Record<string, unknown> = {
      name: KUN, engine: 'openai', display_name: 'Kun', description: 'Models served by the Kun local gateway',
      api_key_env: '', base_url: v1(target.origin), headers: { Authorization: `Bearer ${target.key}` },
      requires_auth: false, skip_canonical_filtering: true,
      models: target.models.map((model) => ({ name: model.id, ...(model.contextWindow ? { context_limit: model.contextWindow } : {}),
        reasoning: model.reasoning === true })),
      // Goose refuses a provider whose static list is empty.
      ...(target.models.length ? { dynamic_models: false } : {})
    }
    return [
      ...Object.entries(provider).map(([key, value]): WiringEdit => ({ slot: { file: files.provider!, format: 'json', path: [key] }, value })),
      { slot: { file: files.config!, format: 'yaml', path: ['GOOSE_PROVIDER'] }, value: KUN },
      { slot: { file: files.config!, format: 'yaml', path: ['GOOSE_MODEL'] }, value: target.model }
    ]
  },
  inspect(ctx, read, origin) {
    const files = this.files(ctx)
    const provider = safeYaml(read, files.config!, ['GOOSE_PROVIDER'])
    const model = safeYaml(read, files.config!, ['GOOSE_MODEL'])
    const base = safeJson(read, files.provider!, ['base_url'])
    const header = safeJson(read, files.provider!, ['headers', 'Authorization'])
    return { pointsAtGateway: provider === KUN && base === v1(origin),
      ...(typeof model === 'string' ? { model } : {}),
      ...(typeof header === 'string' && header.startsWith('Bearer ') ? { key: header.slice(7) } : {}) }
  }
}

const ownsNamed = (item: unknown): boolean => {
  const name = (item as { name?: unknown } | null)?.name
  return typeof name === 'string' && name.endsWith(OWNED_SUFFIX)
}

/** Continue: tagged entries in config.yaml's `models` list; the user picks one in Continue. */
const continueDev: AgentAdapter = {
  id: 'continue',
  name: 'Continue',
  protocol: 'chat',
  homepage: 'https://docs.continue.dev/',
  bins: ['cn'],
  files: (ctx) => ({ config: join(ctx.env.CONTINUE_GLOBAL_DIR?.trim() || join(ctx.home, '.continue'), 'config.yaml') }),
  configDirs: (ctx) => [ctx.env.CONTINUE_GLOBAL_DIR?.trim() || join(ctx.home, '.continue')],
  efforts: [],
  restartRequired: false,
  keepsModelList: true,
  pickInAgent: true,
  ownsArrayItem: ownsNamed,
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const ordered = [...target.models].sort((left, right) => Number(right.id === target.model) - Number(left.id === target.model))
    const edits: WiringEdit[] = []
    // A config Kun creates still needs the fields Continue validates.
    if (!existsSync(file)) {
      edits.push({ slot: { file, format: 'yaml', path: ['name'] }, value: 'Kun' },
        { slot: { file, format: 'yaml', path: ['version'] }, value: '1.0.0' },
        { slot: { file, format: 'yaml', path: ['schema'] }, value: 'v1' })
    }
    edits.push({ slot: { file, format: 'yaml', path: ['models'] }, ownedArray: {
      items: ordered.map((model) => ({ name: `${displayName(model)}${OWNED_SUFFIX}`, provider: 'openai', model: model.id,
        apiBase: v1(target.origin), apiKey: target.key, roles: ['chat', 'edit', 'apply'],
        capabilities: ['tool_use', ...(model.images ? ['image_input'] : [])],
        ...(model.contextWindow || model.maxOutputTokens ? { defaultCompletionOptions: {
          ...(model.contextWindow ? { contextLength: model.contextWindow } : {}),
          ...(model.maxOutputTokens ? { maxTokens: model.maxOutputTokens } : {}) } } : {}) })),
      owns: ownsNamed
    } })
    return edits
  },
  inspect(ctx, read, origin) {
    const models = safeYaml(read, this.files(ctx).config!, ['models'])
    const ours = Array.isArray(models) ? models.filter((entry) => ownsNamed(entry) && (entry as { apiBase?: unknown }).apiBase === v1(origin)) : []
    const first = ours[0] as { model?: unknown; apiKey?: unknown } | undefined
    return { pointsAtGateway: ours.length > 0, ...(typeof first?.model === 'string' ? { model: first.model } : {}),
      ...(typeof first?.apiKey === 'string' ? { key: first.apiKey } : {}) }
  }
}

/** Aider: its home `.aider.conf.yml` options; a repo-level file still takes precedence. */
const aider: AgentAdapter = {
  id: 'aider',
  name: 'Aider',
  protocol: 'chat',
  homepage: 'https://aider.chat/docs/config/aider_conf.html',
  bins: ['aider'],
  files: (ctx) => ({ config: join(ctx.home, '.aider.conf.yml') }),
  configDirs: (ctx) => [join(ctx.home, '.aider')],
  efforts: ['low', 'medium', 'high'],
  restartRequired: true,
  keepsModelList: false,
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const option = (key: string, value: unknown): WiringEdit => ({ slot: { file, format: 'yaml', path: [key] }, value })
    return [
      option('openai-api-base', v1(target.origin)),
      option('openai-api-key', target.key),
      option('model', `openai/${target.model}`),
      option('weak-model', target.smallModel ? `openai/${target.smallModel}` : undefined),
      ...(target.effort ? [option('reasoning-effort', ['low', 'medium', 'high'].includes(target.effort) ? target.effort : undefined)] : [])
    ]
  },
  inspect(ctx, read, origin) {
    const file = this.files(ctx).config!
    const base = safeYaml(read, file, ['openai-api-base'])
    const model = safeYaml(read, file, ['model'])
    const key = safeYaml(read, file, ['openai-api-key'])
    return { pointsAtGateway: base === v1(origin) && typeof model === 'string' && model.startsWith('openai/'),
      ...(typeof model === 'string' && model.startsWith('openai/') ? { model: model.slice(7) } : {}),
      ...(typeof key === 'string' ? { key } : {}) }
  }
}

function kimiDir(ctx: WiringContext): string {
  const explicit = ctx.env.KIMI_CODE_HOME?.trim()
  if (explicit) return explicit
  const code = join(ctx.home, '.kimi-code')
  if (existsSync(code)) return code
  const legacy = ctx.env.KIMI_SHARE_DIR?.trim() || join(ctx.home, '.kimi')
  return existsSync(legacy) ? legacy : code
}

function kimiModelTable(model: GatewayModelInfo): Record<string, string | number | string[]> {
  const levels = (model.reasoningLevels ?? []).filter((level) => level !== 'none' && level !== 'off')
  return {
    provider: KUN, model: model.id, max_context_size: model.contextWindow ?? 128_000,
    capabilities: [...(model.reasoning ? ['thinking'] : []), ...(model.images ? ['image_in'] : []), 'tool_use'],
    ...(levels.length ? { support_efforts: levels } : {}),
    ...(levels.includes('high') ? { default_effort: 'high' } : {})
  }
}

/** Kimi Code: a `[providers.kun]` table, one `[models."kun/<id>"]` table per model, and default_model. */
const kimi: AgentAdapter = {
  id: 'kimi',
  name: 'Kimi Code',
  protocol: 'chat',
  homepage: 'https://github.com/MoonshotAI/kimi-cli',
  bins: ['kimi'],
  files: (ctx) => ({ config: join(kimiDir(ctx), 'config.toml') }),
  configDirs: (ctx) => [kimiDir(ctx)],
  efforts: [],
  restartRequired: true,
  keepsModelList: true,
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const wanted = new Set(target.models.map((model) => `${KUN}/${model.id}`))
    // Tables for models the gateway no longer serves are removed on sync.
    const stale = listTomlTables(readFileText(file)).filter((parts) => parts.length === 2 && parts[0] === 'models' &&
      parts[1]!.startsWith(`${KUN}/`) && !wanted.has(parts[1]!))
    return [
      { slot: { file, format: 'toml-table', table: `providers.${KUN}` }, value: { type: 'kimi', base_url: v1(target.origin), api_key: target.key } },
      ...target.models.map((model): WiringEdit => ({ slot: { file, format: 'toml-table', table: tomlTableName(['models', `${KUN}/${model.id}`]) },
        value: kimiModelTable(model) })),
      ...stale.map((parts): WiringEdit => ({ slot: { file, format: 'toml-table', table: tomlTableName(parts) }, value: undefined })),
      { slot: { file, format: 'toml-key', key: 'default_model' }, value: `${KUN}/${target.model}` }
    ]
  },
  inspect(ctx, read, origin) {
    try {
      const text = read(this.files(ctx).config!)
      const provider = getTomlTable(text, `providers.${KUN}`)
      const model = getTomlTopLevel(text, 'default_model')
      return { pointsAtGateway: provider?.base_url === v1(origin) && typeof model === 'string' && model.startsWith(`${KUN}/`),
        ...(typeof model === 'string' && model.startsWith(`${KUN}/`) ? { model: model.slice(KUN.length + 1) } : {}),
        ...(typeof provider?.api_key === 'string' ? { key: provider.api_key } : {}) }
    } catch { return { pointsAtGateway: false } }
  }
}

export const EXTRA_AGENT_ADAPTERS: readonly AgentAdapter[] = [goose, continueDev, aider, kimi]
