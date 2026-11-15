import type { TurnReasoningEffort } from '../../contracts/turns.js'

const ANTIGRAVITY_MODEL_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/i
const ANTIGRAVITY_MODEL_ID_MAX_LENGTH = 128

export function normalizeAntigravityModel(model: string | undefined): string {
  if (model?.trim() === 'default') return 'default'
  const normalized = model?.trim().replace(/^models\//, '').replace(/-(?:low|medium|high)$/i, '')
  if (
    !normalized
    || normalized.length > ANTIGRAVITY_MODEL_ID_MAX_LENGTH
    || !ANTIGRAVITY_MODEL_ID_PATTERN.test(normalized)
  ) {
    throw new Error(`Invalid Antigravity model id: ${model?.trim() || '(empty)'}`)
  }
  return normalized
}

export function normalizeAntigravityEffort(
  effort: TurnReasoningEffort | undefined
): 'low' | 'medium' | 'high' {
  if (effort === 'low') return 'low'
  if (effort === 'high' || effort === 'max') return 'high'
  return 'medium'
}

export function buildAntigravityArgs(input: {
  prompt: string
  nativeSessionId?: string
  model?: string
  effort?: TurnReasoningEffort
  timeoutMs: number
  planMode: boolean
  approvalPolicy: string
  sandboxMode: string
  additionalDirectories?: readonly string[]
}): string[] {
  const prompt = input.prompt.startsWith('-') ? `Current request:\n${input.prompt}` : input.prompt
  const extraDirs = (input.additionalDirectories ?? [])
    .map((dir) => dir.trim())
    .filter(Boolean)
  const args = [
    '--print',
    prompt,
    '--output-format', 'stream-json',
    ...(input.nativeSessionId ? ['--conversation', input.nativeSessionId] : []),
    ...(input.model === 'default' ? [] : ['--model', normalizeAntigravityModel(input.model)]),
    '--effort', normalizeAntigravityEffort(input.effort),
    '--print-timeout', `${Math.max(1, Math.ceil(input.timeoutMs / 1000))}s`,
    ...extraDirs.flatMap((dir) => ['--add-dir', dir])
  ]
  const denyMutation =
    input.planMode ||
    input.approvalPolicy !== 'auto' ||
    input.sandboxMode === 'read-only' ||
    input.sandboxMode === 'external-sandbox'
  if (denyMutation) {
    args.push('--mode', 'plan', '--sandbox')
  } else if (input.approvalPolicy === 'auto') {
    args.push('--dangerously-skip-permissions')
    if (input.sandboxMode !== 'danger-full-access') args.push('--sandbox')
  } else if (input.sandboxMode !== 'danger-full-access') {
    // Headless Antigravity cannot surface Kun's interactive approval gate. Preserve the
    // requested sandbox and let the official CLI soft-deny interactive actions.
    args.push('--sandbox')
  }
  return args
}
