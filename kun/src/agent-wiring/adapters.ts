import { join } from 'node:path'
import { getDotenv } from './edit/dotenv.js'
import { getTomlTable, getTomlTopLevel } from './edit/toml.js'
import { displayName, safeJson, v1, xdgConfig, xhighEffort } from './adapter-helpers.js'
import { EXTRA_AGENT_ADAPTERS } from './adapters-extra.js'
import type { AgentAdapter, WiringContext, WiringEdit } from './types.js'

/**
 * Agents Kun can wire to its gateway. Each adapter names only the keys Kun
 * owns; everything else in the agent's config is the user's.
 */
const claudeCode: AgentAdapter = {
  id: 'claude-code',
  name: 'Claude Code',
  protocol: 'anthropic',
  homepage: 'https://docs.anthropic.com/en/docs/claude-code',
  bins: ['claude'],
  files: (ctx) => ({ settings: join(ctx.env.CLAUDE_CONFIG_DIR?.trim() || join(ctx.home, '.claude'), 'settings.json') }),
  configDirs: (ctx) => [ctx.env.CLAUDE_CONFIG_DIR?.trim() || join(ctx.home, '.claude')],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  restartRequired: true,
  keepsModelList: false,
  edits(ctx, target) {
    const file = this.files(ctx).settings!
    const json = (path: string[], value: unknown): WiringEdit => ({ slot: { file, format: 'json', path }, value })
    const small = target.smallModel ?? target.model
    const edits: WiringEdit[] = [
      json(['env', 'ANTHROPIC_BASE_URL'], target.origin),
      json(['env', 'ANTHROPIC_AUTH_TOKEN'], target.key),
      // A key or helper of the user's own would be sent beside the gateway key.
      json(['env', 'ANTHROPIC_API_KEY'], undefined),
      json(['apiKeyHelper'], undefined),
      // ANTHROPIC_MODEL outranks /model, so it would pin the session.
      json(['env', 'ANTHROPIC_MODEL'], undefined),
      json(['model'], target.model),
      json(['env', 'ANTHROPIC_DEFAULT_OPUS_MODEL'], target.model),
      json(['env', 'ANTHROPIC_DEFAULT_SONNET_MODEL'], target.model),
      json(['env', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'], small),
      json(['env', 'ANTHROPIC_SMALL_FAST_MODEL'], small)
    ]
    if (target.effort) {
      // settings.json cannot hold `max`; the environment variable can, and outranks /effort.
      const max = target.effort === 'max'
      edits.push(json(['effortLevel'], max || target.effort === 'auto' ? undefined : target.effort),
        json(['env', 'CLAUDE_CODE_EFFORT_LEVEL'], max ? 'max' : undefined))
    }
    return edits
  },
  inspect(ctx, read, origin) {
    const file = this.files(ctx).settings!
    const base = safeJson(read, file, ['env', 'ANTHROPIC_BASE_URL'])
    const model = safeJson(read, file, ['model'])
    const key = safeJson(read, file, ['env', 'ANTHROPIC_AUTH_TOKEN'])
    return { pointsAtGateway: base === origin, ...(typeof model === 'string' ? { model } : {}), ...(typeof key === 'string' ? { key } : {}) }
  }
}

const codex: AgentAdapter = {
  id: 'codex',
  name: 'Codex',
  protocol: 'responses',
  homepage: 'https://developers.openai.com/codex',
  bins: ['codex'],
  files: (ctx) => ({ config: join(ctx.env.CODEX_HOME?.trim() || join(ctx.home, '.codex'), 'config.toml') }),
  configDirs: (ctx) => [ctx.env.CODEX_HOME?.trim() || join(ctx.home, '.codex')],
  efforts: ['low', 'medium', 'high', 'max'],
  restartRequired: true,
  keepsModelList: false,
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const model = target.models.find((entry) => entry.id === target.model)
    const edits: WiringEdit[] = [
      { slot: { file, format: 'toml-table', table: 'model_providers.kun' }, value: {
        name: 'Kun', base_url: v1(target.origin), wire_api: 'responses', experimental_bearer_token: target.key
      } },
      { slot: { file, format: 'toml-key', key: 'model_provider' }, value: 'kun' },
      { slot: { file, format: 'toml-key', key: 'model' }, value: target.model },
      { slot: { file, format: 'toml-key', key: 'model_context_window' }, value: model?.contextWindow }
    ]
    if (target.effort) edits.push({ slot: { file, format: 'toml-key', key: 'model_reasoning_effort' }, value: xhighEffort(target.effort) })
    return edits
  },
  inspect(ctx, read) {
    try {
      const text = read(this.files(ctx).config!)
      const provider = getTomlTopLevel(text, 'model_provider')
      const model = getTomlTopLevel(text, 'model')
      const table = getTomlTable(text, 'model_providers.kun')
      return { pointsAtGateway: provider === 'kun' && Boolean(table?.base_url),
        ...(typeof model === 'string' ? { model } : {}),
        ...(typeof table?.experimental_bearer_token === 'string' ? { key: table.experimental_bearer_token } : {}) }
    } catch { return { pointsAtGateway: false } }
  }
}

const openCode: AgentAdapter = {
  id: 'opencode',
  name: 'OpenCode',
  protocol: 'chat',
  homepage: 'https://opencode.ai/docs',
  bins: ['opencode'],
  files: (ctx) => ({ config: join(xdgConfig(ctx), 'opencode', 'opencode.json') }),
  configDirs: (ctx) => [join(xdgConfig(ctx), 'opencode')],
  efforts: [],
  restartRequired: true,
  keepsModelList: true,
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const models = Object.fromEntries(target.models.map((model) => [model.id, {
      name: displayName(model),
      ...(model.contextWindow || model.maxOutputTokens ? { limit: {
        ...(model.contextWindow ? { context: model.contextWindow } : {}),
        ...(model.maxOutputTokens ? { output: model.maxOutputTokens } : {}) } } : {}),
      ...(model.images ? { attachment: true } : {}),
      ...(model.reasoning ? { reasoning: true } : {})
    }]))
    return [
      { slot: { file, format: 'json', path: ['provider', 'kun'] }, value: {
        npm: '@ai-sdk/openai-compatible', name: 'Kun', options: { baseURL: v1(target.origin), apiKey: target.key }, models
      } },
      { slot: { file, format: 'json', path: ['model'] }, value: `kun/${target.model}` },
      { slot: { file, format: 'json', path: ['small_model'] }, value: target.smallModel ? `kun/${target.smallModel}` : undefined }
    ]
  },
  inspect(ctx, read, origin) {
    const file = this.files(ctx).config!
    const base = safeJson(read, file, ['provider', 'kun', 'options', 'baseURL'])
    const model = safeJson(read, file, ['model'])
    const key = safeJson(read, file, ['provider', 'kun', 'options', 'apiKey'])
    return { pointsAtGateway: base === v1(origin) && typeof model === 'string' && model.startsWith('kun/'),
      ...(typeof model === 'string' && model.startsWith('kun/') ? { model: model.slice(4) } : {}),
      ...(typeof key === 'string' ? { key } : {}) }
  }
}

const piDir = (ctx: WiringContext): string => ctx.env.PI_CODING_AGENT_DIR?.trim() || join(ctx.home, '.pi', 'agent')

const pi: AgentAdapter = {
  id: 'pi',
  name: 'Pi',
  protocol: 'chat',
  homepage: 'https://github.com/earendil-works/pi',
  bins: ['pi'],
  files: (ctx) => ({ models: join(piDir(ctx), 'models.json'), settings: join(piDir(ctx), 'settings.json') }),
  configDirs: (ctx) => [piDir(ctx)],
  efforts: ['off', 'low', 'medium', 'high', 'max'],
  restartRequired: true,
  keepsModelList: true,
  edits(ctx, target) {
    const files = this.files(ctx)
    const edits: WiringEdit[] = [
      { slot: { file: files.models!, format: 'json', path: ['providers', 'kun'] }, value: {
        baseUrl: v1(target.origin), api: 'openai-completions', apiKey: target.key,
        models: target.models.map((model) => ({ id: model.id, name: displayName(model),
          ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
          input: model.images ? ['text', 'image'] : ['text'],
          ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
          ...(model.maxOutputTokens ? { maxTokens: model.maxOutputTokens } : {}) }))
      } },
      { slot: { file: files.settings!, format: 'json', path: ['defaultProvider'] }, value: 'kun' },
      { slot: { file: files.settings!, format: 'json', path: ['defaultModel'] }, value: target.model }
    ]
    if (target.effort) edits.push({ slot: { file: files.settings!, format: 'json', path: ['defaultThinkingLevel'] }, value: xhighEffort(target.effort) })
    return edits
  },
  inspect(ctx, read, origin) {
    const files = this.files(ctx)
    const base = safeJson(read, files.models!, ['providers', 'kun', 'baseUrl'])
    const provider = safeJson(read, files.settings!, ['defaultProvider'])
    const model = safeJson(read, files.settings!, ['defaultModel'])
    const key = safeJson(read, files.models!, ['providers', 'kun', 'apiKey'])
    return { pointsAtGateway: base === v1(origin) && provider === 'kun', ...(typeof model === 'string' ? { model } : {}),
      ...(typeof key === 'string' ? { key } : {}) }
  }
}

const geminiCli: AgentAdapter = {
  id: 'gemini-cli',
  name: 'Gemini CLI',
  protocol: 'gemini',
  homepage: 'https://github.com/google-gemini/gemini-cli',
  bins: ['gemini'],
  // Gemini CLI skips ~/.gemini/.env in folders the user has not trusted; it then
  // fails with a missing-key error rather than sending the key to Google.
  notice: 'trusted-folders',
  files: (ctx) => ({ settings: join(ctx.home, '.gemini', 'settings.json'), env: join(ctx.home, '.gemini', '.env') }),
  configDirs: (ctx) => [join(ctx.home, '.gemini')],
  efforts: [],
  restartRequired: true,
  keepsModelList: false,
  edits(ctx, target) {
    const files = this.files(ctx)
    return [
      { slot: { file: files.settings!, format: 'json', path: ['security', 'auth', 'selectedType'] }, value: 'gemini-api-key' },
      { slot: { file: files.settings!, format: 'json', path: ['model', 'name'] }, value: target.model },
      { slot: { file: files.env!, format: 'dotenv', key: 'GEMINI_API_KEY' }, value: target.key },
      { slot: { file: files.env!, format: 'dotenv', key: 'GOOGLE_GEMINI_BASE_URL' }, value: target.origin }
    ]
  },
  inspect(ctx, read, origin) {
    const files = this.files(ctx)
    const env = read(files.env!)
    const model = safeJson(read, files.settings!, ['model', 'name'])
    const key = getDotenv(env, 'GEMINI_API_KEY')
    return { pointsAtGateway: getDotenv(env, 'GOOGLE_GEMINI_BASE_URL') === origin,
      ...(typeof model === 'string' ? { model } : {}), ...(key ? { key } : {}) }
  }
}

const crush: AgentAdapter = {
  id: 'crush',
  name: 'Crush',
  protocol: 'chat',
  homepage: 'https://github.com/charmbracelet/crush',
  bins: ['crush'],
  files: (ctx) => ({ config: join(xdgConfig(ctx), 'crush', 'crush.json') }),
  configDirs: (ctx) => [join(xdgConfig(ctx), 'crush')],
  efforts: ['low', 'medium', 'high'],
  restartRequired: true,
  keepsModelList: true,
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const selection = (model: string) => ({ model, provider: 'kun',
      ...(target.effort && ['low', 'medium', 'high'].includes(target.effort) ? { reasoning_effort: target.effort } : {}) })
    return [
      { slot: { file, format: 'json', path: ['providers', 'kun'] }, value: {
        name: 'Kun', type: 'openai', base_url: v1(target.origin), api_key: target.key,
        models: target.models.map((model) => ({ id: model.id, name: displayName(model),
          ...(model.contextWindow ? { context_window: model.contextWindow } : {}),
          ...(model.maxOutputTokens ? { default_max_tokens: model.maxOutputTokens } : {}),
          ...(model.reasoning ? { can_reason: true } : {}),
          ...(model.images ? { supports_attachments: true } : {}) }))
      } },
      { slot: { file, format: 'json', path: ['models', 'large'] }, value: selection(target.model) },
      { slot: { file, format: 'json', path: ['models', 'small'] }, value: selection(target.smallModel ?? target.model) }
    ]
  },
  inspect(ctx, read, origin) {
    const file = this.files(ctx).config!
    const base = safeJson(read, file, ['providers', 'kun', 'base_url'])
    const large = safeJson(read, file, ['models', 'large']) as { model?: unknown; provider?: unknown } | undefined
    const key = safeJson(read, file, ['providers', 'kun', 'api_key'])
    return { pointsAtGateway: base === v1(origin) && large?.provider === 'kun',
      ...(typeof large?.model === 'string' ? { model: large.model } : {}), ...(typeof key === 'string' ? { key } : {}) }
  }
}

export const DROID_SUFFIX = ' [Kun]'

const droid: AgentAdapter = {
  id: 'droid',
  name: 'Droid',
  protocol: 'chat',
  homepage: 'https://docs.factory.ai/cli',
  bins: ['droid'],
  files: (ctx) => ({ config: join(ctx.home, '.factory', 'config.json') }),
  configDirs: (ctx) => [join(ctx.home, '.factory')],
  efforts: [],
  restartRequired: true,
  keepsModelList: true,
  pickInAgent: true,
  ownsArrayItem: (item) => ownsDroidEntry(item),
  edits(ctx, target) {
    const file = this.files(ctx).config!
    const origin = v1(target.origin)
    return [{ slot: { file, format: 'json', path: ['custom_models'] }, ownedArray: {
      items: target.models.map((model) => ({ model_display_name: `${displayName(model)}${DROID_SUFFIX}`, model: model.id,
        base_url: origin, api_key: target.key, provider: 'generic-chat-completion-api',
        max_tokens: model.maxOutputTokens ?? 32_000 })),
      owns: (item) => ownsDroidEntry(item)
    } }]
  },
  inspect(ctx, read, origin) {
    const entries = safeJson(read, this.files(ctx).config!, ['custom_models'])
    const ours = Array.isArray(entries) ? entries.filter((entry) => ownsDroidEntry(entry) &&
      (entry as { base_url?: unknown }).base_url === v1(origin)) : []
    const key = (ours[0] as { api_key?: unknown } | undefined)?.api_key
    return { pointsAtGateway: ours.length > 0, ...(typeof key === 'string' ? { key } : {}) }
  }
}

export function ownsDroidEntry(item: unknown): boolean {
  const name = (item as { model_display_name?: unknown } | null)?.model_display_name
  return typeof name === 'string' && name.endsWith(DROID_SUFFIX)
}

export const AGENT_ADAPTERS: readonly AgentAdapter[] = [claudeCode, codex, openCode, pi, geminiCli, crush, droid, ...EXTRA_AGENT_ADAPTERS]

export function agentAdapter(id: string): AgentAdapter | undefined {
  return AGENT_ADAPTERS.find((adapter) => adapter.id === id)
}
