import { join } from 'node:path'
import { displayName, safeJson, v1, xdgConfig } from './adapter-helpers.js'
import type { AgentAdapter, WiringContext } from './types.js'

/** Provider name in Zed; Zed also reads its key from the `KUN_API_KEY` environment variable. */
export const ZED_PROVIDER = 'Kun'

const zedConfigDir = (ctx: WiringContext): string => ctx.platform === 'win32'
  ? join(ctx.env.APPDATA?.trim() || join(ctx.home, 'AppData', 'Roaming'), 'Zed')
  : ctx.platform === 'darwin' ? join(ctx.home, '.config', 'zed') : join(xdgConfig(ctx), 'zed')

/**
 * Zed: an OpenAI-compatible provider in settings.json and the agent's default
 * model. Zed keeps provider keys in the system keychain (or `KUN_API_KEY`),
 * which Kun does not write, so the key is handed over once through the
 * clipboard and the user pastes it into Zed's agent settings.
 */
export const zed: AgentAdapter = {
  id: 'zed',
  name: 'Zed',
  protocol: 'chat',
  homepage: 'https://zed.dev/docs/ai/use-api-access',
  bins: ['zed'],
  files: (ctx) => ({ settings: join(zedConfigDir(ctx), 'settings.json') }),
  configDirs: (ctx) => [zedConfigDir(ctx)],
  efforts: [],
  restartRequired: false,
  keepsModelList: true,
  keyDelivery: 'clipboard',
  notice: 'manual-key',
  edits(ctx, target) {
    const file = this.files(ctx).settings!
    const provider = {
      api_url: v1(target.origin),
      available_models: target.models.map((model) => ({
        name: model.id,
        display_name: displayName(model),
        max_tokens: model.contextWindow ?? 128_000,
        ...(model.maxOutputTokens ? { max_output_tokens: model.maxOutputTokens } : {}),
        capabilities: { tools: true, images: model.images === true, parallel_tool_calls: false, prompt_cache_key: false }
      }))
    }
    return [
      { slot: { file, format: 'json', path: ['language_models', 'openai_compatible', ZED_PROVIDER] }, value: provider },
      { slot: { file, format: 'json', path: ['agent', 'default_model'] }, value: { provider: ZED_PROVIDER, model: target.model } }
    ]
  },
  inspect(ctx, read, origin) {
    const file = this.files(ctx).settings!
    const base = safeJson(read, file, ['language_models', 'openai_compatible', ZED_PROVIDER, 'api_url'])
    const selected = safeJson(read, file, ['agent', 'default_model']) as { provider?: unknown; model?: unknown } | undefined
    const model = selected?.provider === ZED_PROVIDER && typeof selected.model === 'string' ? selected.model : undefined
    return { pointsAtGateway: base === v1(origin), ...(model ? { model } : {}) }
  }
}
