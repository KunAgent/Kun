import {
  DEFAULT_DEEPSEEK_BASE_URL,
  getModelProviderProfile,
  modelProviderModelProfile,
  resolveKunRuntimeSettings,
  resolveProviderProxyUrl,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { GitCommitMessageResult } from '../../shared/git-commit'
import { resolveCodexResponsesRequestAuth } from '../codex-responses-lite'
import { execGit, gitFailure, isOutputOverflow } from './git-command'
import { gitRepositoryRoot } from './git-working-state'
import { oneShotModelRequest } from './one-shot-model-request'
import { routesTextThroughRuntime } from './runtime-model-requests'

const MAX_PATCH_CHARS = 30_000
const MAX_UNTRACKED_PREVIEWS = 20
const UNTRACKED_PREVIEW_LINES = 60
const GENERATION_TIMEOUT_MS = 60_000
const GENERATION_MAX_OUTPUT_TOKENS = 1_200

export const COMMIT_MESSAGE_SYSTEM_PROMPT = [
  'You write the git commit message for the changes shown.',
  'Rules:',
  '- First line: a summary of at most 72 characters in the imperative mood, without a trailing period.',
  '- When the recent commit subjects follow a convention (for example "feat(scope): ..."), follow it, and write in the same natural language they use. Use English when there are none.',
  '- When the change needs explaining, add one blank line and a short body wrapped at 72 characters that says what changed and why. Skip the body for small, obvious changes.',
  '- Describe only what the diff shows. Do not invent motivation or mention files you cannot see.',
  '- Reply with the commit message only: no quotes, code fences, headings or commentary.'
].join('\n')

export type CommitMessageContext = { branch: string | null; subjects: string[]; stat: string; patch: string }

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[diff truncated]` : text
}

/** A patch too big to buffer is described by its stat alone. */
async function boundedPatch(root: string, args: string[]): Promise<string> {
  try {
    return (await execGit(root, args, { maxBuffer: 32 * 1024 * 1024 })).stdout
  } catch (error) {
    if (isOutputOverflow(error)) return '[diff too large to include]'
    throw error
  }
}

/** The diff a commit would record: the index, or everything when the commit stages all first. */
export async function collectCommitMessageContext(
  workspaceRoot: string,
  stageAll: boolean
): Promise<CommitMessageContext | null> {
  const root = await gitRepositoryRoot(workspaceRoot)
  if (!root) return null
  const diff = ['-c', 'core.quotePath=false', 'diff', '--no-ext-diff', '--no-color', '-M']
  const hasHead = (await execGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { okCodes: [0, 1] })).code === 0
  const branch = (await execGit(root, ['branch', '--show-current'])).stdout.trim() || null
  const subjects = hasHead
    ? (await execGit(root, ['log', '-n', '12', '--format=%s'])).stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    : []
  const staged = (await execGit(root, ['diff', '--cached', '--quiet'], { okCodes: [0, 1] })).code === 1
  if (staged && !stageAll) {
    const [stat, patch] = await Promise.all([
      execGit(root, [...diff, '--cached', '--stat=120']),
      boundedPatch(root, [...diff, '--cached', '-U2'])
    ])
    return { branch, subjects, stat: stat.stdout.trim(), patch: clip(patch, MAX_PATCH_CHARS) }
  }
  const against = hasHead ? ['HEAD'] : []
  const [stat, patch, untracked] = await Promise.all([
    execGit(root, [...diff, '--stat=120', ...against]),
    boundedPatch(root, [...diff, '-U2', ...against]),
    execGit(root, ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'])
  ])
  const newFiles = untracked.stdout.split('\0').filter(Boolean)
  const previews: string[] = []
  for (const path of newFiles.slice(0, MAX_UNTRACKED_PREVIEWS)) {
    const show = await execGit(root, ['diff', '--no-index', '--no-color', '--', '/dev/null', path], { okCodes: [0, 1] })
      .catch(() => null)
    const lines = show?.stdout.split('\n') ?? []
    previews.push(lines.slice(0, UNTRACKED_PREVIEW_LINES + 5).join('\n'))
  }
  const statText = [stat.stdout.trim(), ...newFiles.map((path) => ` ${path} (new file)`)].filter(Boolean).join('\n')
  const patchText = [patch, ...previews].filter((part) => part.trim()).join('\n')
  return { branch, subjects, stat: statText, patch: clip(patchText, MAX_PATCH_CHARS) }
}

export function buildCommitMessageUserText(context: CommitMessageContext): string {
  return [
    context.branch ? `Branch: ${context.branch}` : '',
    context.subjects.length ? `Recent commit subjects:\n${context.subjects.map((subject) => `- ${subject}`).join('\n')}` : '',
    `Files changed:\n${context.stat}`,
    `Diff:\n${context.patch}`
  ].filter(Boolean).join('\n\n')
}

/** Strips what models wrap around a message: reasoning tags, fences, quotes, a label line. */
export function sanitizeCommitMessage(text: string): string {
  let message = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(message)
  if (fenced) message = fenced[1].trim()
  message = message.replace(/^(commit message|提交信息)\s*[:：]\s*/i, '').trim()
  if (/^(["'`])[\s\S]*\1$/.test(message) && message.length > 1) message = message.slice(1, -1).trim()
  return message
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Small model when one is set, else the conversation model, on the same provider path as other one-shot calls. */
function commitMessageModel(settings: AppSettingsV1): {
  providerId: string
  model: string
  apiKey: string
  baseUrl: string
  endpointFormat: ReturnType<typeof getModelProviderProfile>['endpointFormat']
  responsesMode?: 'lite'
} {
  const runtime = resolveKunRuntimeSettings(settings)
  const smallModel = runtime.smallModel?.trim() ?? ''
  const providerId = (smallModel ? runtime.smallModelProviderId?.trim() : '') || runtime.providerId.trim()
  const provider = getModelProviderProfile(settings, providerId)
  const model = smallModel || runtime.model.trim() || provider.models.map((item) => item.trim()).find(Boolean) || ''
  const profile = modelProviderModelProfile(provider, model)
  return {
    providerId: routesTextThroughRuntime() ? providerId || provider.id : provider.id,
    model,
    apiKey: provider.apiKey.trim() || runtime.apiKey.trim(),
    baseUrl: provider.baseUrl.trim() || runtime.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    endpointFormat: profile?.endpointFormat ?? provider.endpointFormat,
    responsesMode: profile?.responsesMode
  }
}

export async function generateGitCommitMessage(
  settings: AppSettingsV1,
  request: { workspaceRoot: string; stageAll?: boolean }
): Promise<GitCommitMessageResult> {
  let context: CommitMessageContext | null
  try {
    context = await collectCommitMessageContext(request.workspaceRoot, Boolean(request.stageAll))
  } catch (error) {
    return { ok: false, reason: 'error', message: gitFailure(error).message }
  }
  if (!context) return { ok: false, reason: 'error', message: 'No working directory selected.' }
  if (!context.stat.trim() && !context.patch.trim()) {
    return { ok: false, reason: 'nothing_to_describe', message: 'There are no changes to describe.' }
  }
  const model = commitMessageModel(settings)
  if (!model.model) return { ok: false, reason: 'model', message: 'No model is configured.' }
  if (!routesTextThroughRuntime() && !resolveCodexResponsesRequestAuth(model.baseUrl, model.apiKey).apiKey) {
    return { ok: false, reason: 'model', message: 'The model is missing an API key.' }
  }
  const result = await oneShotModelRequest({
    purpose: 'commit-message',
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    endpointFormat: model.endpointFormat,
    responsesMode: model.responsesMode,
    model: model.model,
    systemPrompt: COMMIT_MESSAGE_SYSTEM_PROMPT,
    userText: buildCommitMessageUserText(context),
    timeoutMs: GENERATION_TIMEOUT_MS,
    maxOutputTokens: GENERATION_MAX_OUTPUT_TOKENS,
    proxyUrl: routesTextThroughRuntime() ? undefined : resolveProviderProxyUrl(settings, model.providerId),
    providerId: model.providerId,
    presetSource: getModelProviderProfile(settings, model.providerId).presetSource?.presetId
  })
  if (!result.ok) return { ok: false, reason: 'model', message: result.message }
  const message = sanitizeCommitMessage(result.text)
  if (!message) return { ok: false, reason: 'model', message: 'The model returned an empty message.' }
  return { ok: true, message, model: model.model }
}
