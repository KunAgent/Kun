import type {
  AppSettingsV1,
  ClawImChannelV1,
  ClawImConversationV1,
  ModelProviderProfileV1
} from '../shared/app-settings'
import {
  DEFAULT_CLAW_MODEL,
  DEFAULT_MODEL_PROVIDER_ID,
  getKunRuntimeSettings,
  getModelProviderSettings,
  isComposerChatModelId,
  listNonTextModelIds,
  modelProfileSupportsTextChat,
  modelProviderModelProfile,
  normalizeModelProviderId
} from '../shared/app-settings'
import { runtimeErrorMessage } from './claw-runtime-helpers'

export function runtimeErrorCode(result: { body: string }): string {
  try {
    const parsed = JSON.parse(result.body) as Record<string, unknown>
    return typeof parsed.code === 'string' ? parsed.code.trim() : ''
  } catch {
    return ''
  }
}

export function isMissingThreadResult(result: { ok: boolean; status: number; body: string }): boolean {
  if (result.ok || result.status !== 404) return false
  const code = runtimeErrorCode(result)
  if (code) return code === 'not_found'
  const message = runtimeErrorMessage(result, '').toLowerCase()
  return message.includes('thread') && message.includes('not found')
}

export function imRuntimeStartError(
  settings: AppSettingsV1,
  result: { ok: boolean; status: number; body: string },
  fallback: string
): string {
  if (runtimeErrorCode(result) === 'thread_closing') {
    return isChineseLocale(settings)
      ? '当前会话正在关闭，请稍后重试。'
      : 'This conversation is closing. Please try again shortly.'
  }
  return runtimeErrorMessage(result, fallback)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function cdataText(value: string): string {
  return value.replace(/\]\]>/g, ']]]]><![CDATA[>')
}

export function buildImRuntimePrompt(prompt: string): string {
  return [
    '<kun_im_context>',
    '<channel>remote_im</channel>',
    '<interactive_gui_input_available>false</interactive_gui_input_available>',
    '<instruction>The user is on a remote IM channel and cannot answer GUI prompts. Do not ask for structured GUI input or wait for GUI confirmation. If information is missing, state your assumption and continue, or ask in the final reply so the user can answer in the next IM message.</instruction>',
    '</kun_im_context>',
    '',
    '<user_message><![CDATA[',
    cdataText(prompt),
    ']]></user_message>'
  ].join('\n')
}


export function isChineseLocale(settings: AppSettingsV1): boolean {
  return settings.locale.toLowerCase().startsWith('zh')
}

export function currentImModel(
  settings: AppSettingsV1,
  channel?: ClawImChannelV1,
  conversation?: ClawImConversationV1
): string {
  return conversation?.model?.trim() ||
    channel?.model?.trim() ||
    settings.claw.im.model.trim() ||
    DEFAULT_CLAW_MODEL
}

export function currentImProviderId(
  settings: AppSettingsV1,
  channel?: ClawImChannelV1,
  conversation?: ClawImConversationV1
): string {
  return conversation?.providerId?.trim() ||
    channel?.providerId?.trim() ||
    settings.claw.im.providerId?.trim() ||
    getKunRuntimeSettings(settings).providerId.trim() ||
    DEFAULT_MODEL_PROVIDER_ID
}

export function providerLabel(provider: ModelProviderProfileV1): string {
  const name = provider.name.trim()
  return name && name !== provider.id ? `${name} (${provider.id})` : provider.id
}

export function providerTextModels(settings: AppSettingsV1, provider: ModelProviderProfileV1): string[] {
  const nonTextModelIds = listNonTextModelIds(settings)
  const models: string[] = []
  for (const model of provider.models) {
    const trimmed = model.trim()
    if (!trimmed) continue
    if (!isComposerChatModelId(trimmed, nonTextModelIds)) continue
    if (!modelProfileSupportsTextChat(modelProviderModelProfile(provider, trimmed))) continue
    models.push(trimmed)
  }
  return models
}

export function findImProvider(settings: AppSettingsV1, value: string): ModelProviderProfileV1 | undefined {
  const query = value.trim()
  if (!query) return undefined
  const normalizedId = normalizeModelProviderId(query)
  const providers = getModelProviderSettings(settings).providers
  return providers.find((provider) => provider.id === normalizedId) ??
    providers.find((provider) => provider.id.toLowerCase() === query.toLowerCase()) ??
    providers.find((provider) => provider.name.trim().toLowerCase() === query.toLowerCase())
}

export function currentImProvider(
  settings: AppSettingsV1,
  channel?: ClawImChannelV1,
  conversation?: ClawImConversationV1
): ModelProviderProfileV1 {
  const providers = getModelProviderSettings(settings).providers
  const providerId = currentImProviderId(settings, channel, conversation)
  return providers.find((provider) => provider.id === providerId) ??
    providers.find((provider) => provider.id === DEFAULT_MODEL_PROVIDER_ID) ??
    providers[0]
}

export function firstProviderModel(settings: AppSettingsV1, providerId: string): string {
  const provider = findImProvider(settings, providerId)
  return provider ? providerTextModels(settings, provider)[0] ?? DEFAULT_CLAW_MODEL : DEFAULT_CLAW_MODEL
}

export function validProviderModel(settings: AppSettingsV1, provider: ModelProviderProfileV1, model: string): string | undefined {
  const trimmed = model.trim()
  if (!trimmed || trimmed === DEFAULT_CLAW_MODEL) return undefined
  return providerTextModels(settings, provider).find((item) => item === trimmed)
}

export function settingsWithImModelProvider(
  settings: AppSettingsV1,
  providerId: string | undefined,
  model: string
): AppSettingsV1 {
  const trimmedProviderId = providerId?.trim()
  if (!trimmedProviderId) return settings
  const provider = findImProvider(settings, trimmedProviderId)
  const requestedModel = model.trim()
  const resolvedModel = requestedModel && requestedModel !== DEFAULT_CLAW_MODEL
    ? provider
      ? validProviderModel(settings, provider, requestedModel) ?? firstProviderModel(settings, trimmedProviderId)
      : requestedModel
    : firstProviderModel(settings, trimmedProviderId)
  return {
    ...settings,
    agents: {
      ...settings.agents,
      kun: {
        ...settings.agents.kun,
        providerId: trimmedProviderId,
        model: resolvedModel
      }
    }
  }
}

export function effectiveImRuntimeModel(settings: AppSettingsV1, requestedModel: string): string {
  const trimmed = requestedModel.trim()
  if (trimmed && trimmed.toLowerCase() !== DEFAULT_CLAW_MODEL) return trimmed
  return getKunRuntimeSettings(settings).model.trim() || trimmed || DEFAULT_CLAW_MODEL
}

export function imCommandHelpText(settings: AppSettingsV1): string {
  if (isChineseLocale(settings)) {
    return [
      'Claw IM 命令：',
      '- `/help`：查看命令帮助',
      '- `/new`：当前 IM 连接开启新话题',
      '- `/clear`：等同于 `/new`，当前 IM 连接开启新话题',
      '- `/stop`：停止当前 Kun 会话里正在运行的任务',
      '- `/pwd`：查看当前 Kun 会话工作目录本地路径',
      '- `/usage`：查看当前 Kun 会话 token 消耗、供应商和模型',
      '- `/list-skills`：查看当前 Kun 可用技能',
      '- `/list-mcp`：查看当前 Kun MCP 服务器',
      '- `/list-goal`：查看当前 Kun 会话目标',
      '- `/goal <目标>`：设置当前 Kun 会话目标',
      '- `/list-threads`：列出最近的 Kun 会话',
      '- `/current`：查看当前 IM 会话连接的 Kun 会话',
      '- `/switch <序号|thread id>`：切换当前 IM 会话到指定 Kun 会话',
      '- `/list-model`：查看所有可用文本模型',
      '- `/model <序号>`：按 `/list-model` 列出的序号切换当前 IM 连接模型',
      '命令前缀可以从 `/` 改成 `-`，例如 `-new`、`-list-threads`、`-switch 2`。'
    ].join('\n')
  }
  return [
    'Claw IM commands:',
    '- `/help`: show command help',
    '- `/new`: start a new topic for this IM connection',
    '- `/clear`: same as `/new`, start a new topic for this IM connection',
    '- `/stop`: stop the running task in the current Kun conversation',
    '- `/pwd`: show the local workspace path for the current Kun conversation',
    '- `/usage`: show token usage plus provider/model for the current Kun conversation',
    '- `/list-skills`: list available Kun skills',
    '- `/list-mcp`: list Kun MCP servers',
    '- `/list-goal`: show the current Kun conversation goal',
    '- `/goal <objective>`: set the current Kun conversation goal',
    '- `/list-threads`: list recent Kun conversations',
    '- `/current`: show the Kun conversation connected to this IM chat',
    '- `/switch <number|thread id>`: switch this IM chat to a Kun conversation',
    '- `/list-model`: list all available text models',
    '- `/model <number>`: switch this IM connection to a model listed by `/list-model`',
    'The command prefix can be changed from `/` to `-`, for example `-new`, `-list-threads`, or `-switch 2`.'
  ].join('\n')
}

export function imModelListText(
  settings: AppSettingsV1,
  channel?: ClawImChannelV1,
  conversation?: ClawImConversationV1
): string {
  const current = currentImModelResolution(settings, channel, conversation)
  const currentProviderId = current.provider.id
  const currentModel = current.model
  const rows = listImModelOptions(settings).map((option, index) => {
    const { provider, model } = option
    const marker = provider.id === currentProviderId && model === currentModel ? '*' : '-'
    return `${marker} ${index + 1}. \`${model}\` · provider \`${provider.id}\``
  })
  if (isChineseLocale(settings)) {
    return [
      `当前供应商：\`${currentProviderId}\`。`,
      `当前模型：\`${currentModel}\`。`,
      ...(rows.length > 0
        ? ['可用模型：', ...rows, '切换模型：`/model <序号>`。']
        : ['还没有可用的文本模型，请先在设置里为供应商配置模型。'])
    ].join('\n')
  }
  return [
    `Current provider: \`${currentProviderId}\`.`,
    `Current model: \`${currentModel}\`.`,
    ...(rows.length > 0
      ? ['Available models:', ...rows, 'Switch model with `/model <number>`.']
      : ['No usable text models are available yet. Add models for a provider in Settings first.'])
  ].join('\n')
}

export type ImModelResolution = {
  provider: ModelProviderProfileV1
  model: string
}

export function listImModelOptions(settings: AppSettingsV1): ImModelResolution[] {
  return getModelProviderSettings(settings).providers.flatMap((provider) =>
    providerTextModels(settings, provider).map((model) => ({ provider, model }))
  )
}

export function resolveImModelByIndex(settings: AppSettingsV1, value: string): ImModelResolution | undefined {
  const raw = value.trim()
  if (!/^\d+$/.test(raw)) return undefined
  const index = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(index) || index < 1) return undefined
  return listImModelOptions(settings)[index - 1]
}

export function imModelCommandHint(settings: AppSettingsV1, value: string): string {
  const count = listImModelOptions(settings).length
  return imKunErrorText(settings, isChineseLocale(settings)
    ? `无效的模型序号 \`${value}\`。${count > 0 ? '发送 `/list-model` 查看可用序号。' : '还没有可用的文本模型。'}`
    : `Invalid model number \`${value}\`. ${count > 0 ? 'Send `/list-model` to see available numbers.' : 'No usable text models are available yet.'}`)
}

export function imModelChangedText(settings: AppSettingsV1, providerId: string, model: string): string {
  return isChineseLocale(settings)
    ? `Claw IM 模型已切换到 \`${model}\`，供应商为 \`${providerId}\`。`
    : `Claw IM model switched to \`${model}\` with provider \`${providerId}\`.`
}

export function currentImModelResolution(
  settings: AppSettingsV1,
  channel?: ClawImChannelV1,
  conversation?: ClawImConversationV1
): ImModelResolution {
  const provider = currentImProvider(settings, channel, conversation)
  const requestedModel = currentImModel(settings, channel, conversation)
  const model = validProviderModel(settings, provider, requestedModel) ?? firstProviderModel(settings, provider.id)
  return { provider, model }
}

export function imNewTopicText(settings: AppSettingsV1): string {
  return isChineseLocale(settings)
    ? '新话题已开启。下一条消息会创建新的本地会话。'
    : 'Started a new topic. The next message will create a fresh local conversation.'
}

export function imKunErrorText(_settings: AppSettingsV1, message: string): string {
  return imKunSystemText(message)
}

export function imKunSystemText(message: string): string {
  const trimmed = message.trim()
  if (trimmed.startsWith('[Kun]')) return trimmed
  if (trimmed.startsWith('Kun:')) return `[Kun] ${trimmed.slice('Kun:'.length).trim()}`
  return `[Kun] ${trimmed}`
}


export function imWelcomeText(settings: AppSettingsV1, channel?: ClawImChannelV1): string {
  const profile = channel?.agentProfile
  const name = profile?.name.trim() || channel?.label.trim() || 'Kun'
  const description = profile?.description.trim() ?? ''
  if (isChineseLocale(settings)) {
    return [
      `你好，我是 ${name}，通过 Kun 连接到这个对话的 AI 助手。`,
      ...(description ? [description] : []),
      '你可以直接发消息让我帮忙：回答问题、查资料、读写已连接电脑工作区里的文件、生成文档等，完成后我会在这里回复你。',
      imCommandHelpText(settings),
      '直接发一条消息就可以开始。'
    ].join('\n\n')
  }
  return [
    `Hi, I am ${name}, an AI assistant connected to this chat through Kun.`,
    ...(description ? [description] : []),
    'Send me a message and I will handle it on the connected computer: answering questions, research, reading and writing workspace files, generating documents — I reply here once done.',
    imCommandHelpText(settings),
    'Send any message to get started.'
  ].join('\n\n')
}
