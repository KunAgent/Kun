import { readFile } from 'node:fs/promises'
import { stdin as processStdin } from 'node:process'
import {
  TurnReasoningEffortSchema,
  TurnServiceTierSchema,
  type TurnReasoningEffort,
  type TurnServiceTier
} from '../contracts/turns.js'
import type { ServeOptions } from './cli-options.js'
import { ServeExitCode } from './serve.js'
import { optionProvided, positionals, stringFlag } from './agent-cli-args.js'

export const MAX_RUN_PROMPT_BYTES = 2 * 1024 * 1024

export type RunInvocationResult =
  | {
      ok: true
      prompt: string
      options: ServeOptions
      reasoningEffort?: TurnReasoningEffort
      serviceTier?: TurnServiceTier
    }
  | { ok: false; message: string; exitCode: number }

export async function resolveRunInvocation(
  argv: readonly string[],
  options: ServeOptions,
  stdin?: NodeJS.ReadableStream
): Promise<RunInvocationResult> {
  const controls = parseRunControls(argv, options)
  if (!controls.ok) return controls
  const prompt = await resolveRunPrompt(argv, stdin)
  if (!prompt.ok) return prompt
  return { ...controls, prompt: prompt.prompt }
}

function parseRunControls(
  argv: readonly string[],
  options: ServeOptions
): Omit<Extract<RunInvocationResult, { ok: true }>, 'prompt'> | Extract<RunInvocationResult, { ok: false }> {
  const reasoningValue = stringFlag(argv, ['reasoning-effort'])?.trim()
  const reasoning = reasoningValue ? TurnReasoningEffortSchema.safeParse(reasoningValue) : undefined
  if (reasoning && !reasoning.success) {
    return usageError(`invalid reasoning effort: ${reasoningValue}`)
  }
  const tierValue = stringFlag(argv, ['service-tier'])?.trim()
  const tier = tierValue ? TurnServiceTierSchema.safeParse(tierValue) : undefined
  if (tier && !tier.success) return usageError(`invalid service tier: ${tierValue}`)
  const limits = [
    ['max-steps', 'maxSteps'],
    ['max-wall-time-ms', 'maxWallTimeMs'],
    ['max-tool-calls-per-step', 'maxToolCallsPerStep']
  ] as const
  const overrides: Partial<Record<(typeof limits)[number][1], number>> = {}
  for (const [flag, key] of limits) {
    const value = stringFlag(argv, [flag])
    if (value === undefined) continue
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return usageError(`--${flag} must be a positive integer`)
    }
    overrides[key] = parsed
  }
  return {
    ok: true,
    options: Object.keys(overrides).length
      ? {
          ...options,
          runtime: {
            ...options.runtime,
            turnLimits: { ...options.runtime?.turnLimits, ...overrides }
          }
        }
      : options,
    ...(reasoning?.success ? { reasoningEffort: reasoning.data } : {}),
    ...(tier?.success ? { serviceTier: tier.data } : {})
  }
}

async function resolveRunPrompt(
  argv: readonly string[],
  stdin?: NodeJS.ReadableStream
): Promise<{ ok: true; prompt: string } | Extract<RunInvocationResult, { ok: false }>> {
  const promptFileProvided = optionProvided(argv, 'prompt-file')
  const promptFile = stringFlag(argv, ['prompt-file'])
  const explicitPrompt = stringFlag(argv, ['prompt', 'p'])
  const positionalPrompt = positionals(argv).join(' ').trim()
  if (promptFileProvided && (!promptFile || (promptFile.startsWith('-') && promptFile !== '-'))) {
    return usageError('missing value for --prompt-file')
  }
  if (promptFile && (explicitPrompt !== undefined || positionalPrompt)) {
    return usageError('--prompt-file is mutually exclusive with --prompt and positional prompts')
  }
  if (!promptFile) {
    const prompt = explicitPrompt ?? positionalPrompt
    return prompt?.trim() ? { ok: true, prompt } : usageError('missing prompt')
  }
  try {
    const bytes = promptFile === '-'
      ? await readBoundedStream(stdin ?? processStdin, MAX_RUN_PROMPT_BYTES)
      : await readBoundedFile(promptFile, MAX_RUN_PROMPT_BYTES)
    const prompt = decodeUtf8(bytes)
    return prompt.trim() ? { ok: true, prompt } : usageError('prompt file is empty')
  } catch (error) {
    return {
      ok: false,
      exitCode: ServeExitCode.config,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function readBoundedFile(path: string, limit: number): Promise<Buffer> {
  const bytes = await readFile(path)
  assertPromptSize(bytes.byteLength, limit)
  return bytes
}

async function readBoundedStream(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of stream) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    assertPromptSize(size, limit)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

function assertPromptSize(size: number, limit: number): void {
  if (size > limit) throw new Error(`prompt exceeds ${limit} bytes`)
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('prompt file must contain valid UTF-8')
  }
}

function usageError(message: string): Extract<RunInvocationResult, { ok: false }> {
  return { ok: false, message, exitCode: ServeExitCode.usage }
}
